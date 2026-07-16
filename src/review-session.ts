import type { ReviewScope, SequenceBinding } from "./domain";
import { FreeFrameClient } from "./freeframe-client";
import { PlaneClient } from "./plane-client";

export interface ActiveReviewSession { assetId: string; scopes: ReadonlySet<ReviewScope>; freeframe: FreeFrameClient; expiresAt: number }

export class ReviewSessionManager {
  private active?: ActiveReviewSession;
  constructor(private readonly plane: PlaneClient, private readonly now = () => Date.now()) {}
  clear(): void { this.active?.freeframe.clearSession(); this.active = undefined; }
  async get(binding: SequenceBinding): Promise<ActiveReviewSession | undefined> {
    if (this.active && this.active.expiresAt - this.now() > 5_000) return this.active;
    this.clear();
    const state = await this.plane.getReviewSession(binding.workspaceSlug, binding.projectId, binding.workItemId);
    if (!state.linked) return undefined;
    const apiUrl = state.session.freeframe_api_url;
    if (!apiUrl) throw new Error("Plane review session does not provide a trusted FreeFrame API URL");
    const freeframe = new FreeFrameClient(apiUrl);
    const exchanged = await freeframe.exchange(state.session.integration_token);
    this.active = { assetId: state.session.asset_id, scopes: new Set(exchanged.scopes), freeframe, expiresAt: this.now() + Math.min(state.session.expires_in, exchanged.expires_in) * 1000 };
    return this.active;
  }
}
