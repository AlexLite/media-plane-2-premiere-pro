import type { ReviewScope, SequenceBinding } from "./domain";
import { FreeFrameClient } from "./freeframe-client";
import { PlaneClient } from "./plane-client";

export interface ActiveReviewSession { assetId: string; scopes: ReadonlySet<ReviewScope>; freeframe: FreeFrameClient; expiresAt: number; contextKey: string }

function reviewContextKey(binding: SequenceBinding): string {
  return [binding.baseUrl, binding.workspaceSlug, binding.projectId, binding.workItemId].join("\u0000");
}

export class ReviewSessionManager {
  private active?: ActiveReviewSession;
  private trustedRoot?: string;
  private contextKey?: string;
  constructor(private readonly plane: PlaneClient, private readonly now = () => Date.now()) {}
  private discardActive(): void { this.active?.freeframe.clearSession(); this.active = undefined; }
  clear(): void { this.discardActive(); this.trustedRoot = undefined; this.contextKey = undefined; }
  async get(binding: SequenceBinding): Promise<ActiveReviewSession | undefined> {
    const contextKey = reviewContextKey(binding);
    if (this.contextKey && this.contextKey !== contextKey) this.clear();
    this.contextKey = contextKey;
    if (this.active && this.active.contextKey === contextKey && this.active.expiresAt - this.now() > 5_000) return this.active;
    this.discardActive();

    const state = await this.plane.getReviewSession(binding.workspaceSlug, binding.projectId, binding.workItemId);
    if (!state.linked) { this.trustedRoot = undefined; return undefined; }
    const freeframe = new FreeFrameClient(state.session.freeframe_api_url);
    if (this.trustedRoot && freeframe.root !== this.trustedRoot) throw new Error("Plane returned a different FreeFrame API endpoint for the bound review context");
    const exchanged = await freeframe.exchange(state.session.integration_token, { projectId: binding.projectId, issueId: binding.workItemId });
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
}
