import type { ReviewScope, ReviewSessionState, SequenceBinding } from "./domain";
import { FreeFrameClient } from "./freeframe-client";
import { PlaneClient } from "./plane-client";
import { OperationGeneration } from "./operation-generation";

export interface ActiveReviewSession { assetId: string; scopes: ReadonlySet<ReviewScope>; freeframe: FreeFrameClient; expiresAt: number; contextKey: string }

function reviewContextKey(binding: SequenceBinding): string {
  return [binding.baseUrl, binding.workspaceSlug, binding.projectId, binding.workItemId].join("\u0000");
}

export class ReviewSessionManager {
  private active?: ActiveReviewSession;
  private trustedRoot?: string;
  private contextKey?: string;
  private readonly operations = new OperationGeneration();
  constructor(private readonly plane: PlaneClient, private readonly now = () => Date.now()) {}
  private discardActive(): void { this.active?.freeframe.clearSession(); this.active = undefined; }
  clear(): void { this.operations.invalidate(); this.discardActive(); this.trustedRoot = undefined; this.contextKey = undefined; }

  private prepareContext(binding: SequenceBinding): { contextKey: string; generation: number } {
    const contextKey = reviewContextKey(binding);
    if (this.contextKey && this.contextKey !== contextKey) this.clear();
    this.contextKey = contextKey;
    return { contextKey, generation: this.operations.begin() };
  }

  private async activate(binding: SequenceBinding, state: ReviewSessionState, contextKey: string, generation: number): Promise<ActiveReviewSession | undefined> {
    this.operations.assertCurrent(generation);
    this.discardActive();
    if (!state.linked) { this.trustedRoot = undefined; return undefined; }
    const freeframe = new FreeFrameClient(state.session.freeframe_api_url);
    if (this.trustedRoot && freeframe.root !== this.trustedRoot) throw new Error("Plane returned a different FreeFrame API endpoint for the bound review context");
    const exchanged = await freeframe.exchange(state.session.integration_token, { projectId: binding.projectId, issueId: binding.workItemId });
    this.operations.assertCurrent(generation);
    if (this.contextKey !== contextKey) throw new DOMException("Review context changed", "AbortError");
    const scopes = new Set(exchanged.scopes);
    if (!scopes.has("review:read")) throw new Error("FreeFrame session does not grant review:read");
    if (state.session.can_manage !== scopes.has("review:manage")) throw new Error("Plane and FreeFrame management permissions do not match");
    this.trustedRoot = freeframe.root;
    this.active = {
      assetId: state.session.asset_id,
      scopes,
      freeframe,
      expiresAt: this.now() + Math.min(state.session.expires_in, exchanged.expires_in) * 1000,
      contextKey,
    };
    return this.active;
  }

  async get(binding: SequenceBinding): Promise<ActiveReviewSession | undefined> {
    const { contextKey, generation } = this.prepareContext(binding);
    if (this.active && this.active.contextKey === contextKey && this.active.expiresAt - this.now() > 5_000) return this.active;
    const state = await this.plane.getReviewSession(binding.workspaceSlug, binding.projectId, binding.workItemId);
    this.operations.assertCurrent(generation);
    return this.activate(binding, state, contextKey, generation);
  }

  async getFromState(binding: SequenceBinding, state: ReviewSessionState): Promise<ActiveReviewSession | undefined> {
    const { contextKey, generation } = this.prepareContext(binding);
    return this.activate(binding, state, contextKey, generation);
  }
}
