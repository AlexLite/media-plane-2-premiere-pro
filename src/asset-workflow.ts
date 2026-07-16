import type { ReviewAsset, ReviewPermissions, ReviewVersion, SequenceBinding } from "./domain";
import { capabilities } from "./permissions";
import { PlaneClient } from "./plane-client";
import { ReviewSessionManager } from "./review-session";

export interface UnlinkedAssetState { linked: false; canManage: boolean }
export interface LinkedAssetState {
  linked: true;
  asset: ReviewAsset;
  versions: ReviewVersion[];
  permissions: ReviewPermissions;
}
export type AssetReviewState = UnlinkedAssetState | LinkedAssetState;

function permissionsMatch(left: ReviewPermissions, right: ReviewPermissions): boolean {
  return left.read === right.read && left.comment === right.comment && left.upload === right.upload && left.manage === right.manage;
}

export function compatibleVideoAssets(assets: ReviewAsset[]): ReviewAsset[] {
  return assets.filter(asset => asset.asset_type === "video");
}

export async function loadAssetReview(
  binding: SequenceBinding,
  plane: PlaneClient,
  sessions: ReviewSessionManager,
): Promise<AssetReviewState> {
  const state = await plane.getReviewSession(binding.workspaceSlug, binding.projectId, binding.workItemId);
  if (!state.linked) {
    sessions.clear();
    return { linked: false, canManage: state.can_manage };
  }

  try {
    const active = await sessions.getFromState(binding, state);
    if (!active || active.assetId !== state.session.asset_id) throw new Error("The Plane review link could not be confirmed");
    const bootstrap = await active.freeframe.bootstrap(active.assetId, { projectId: binding.projectId, issueId: binding.workItemId });
    if (bootstrap.asset.asset_type !== "video") throw new Error("The linked FreeFrame asset is not compatible with Premiere video review");
    const expectedPermissions = capabilities(active.scopes);
    if (!permissionsMatch(bootstrap.permissions, expectedPermissions)) throw new Error("FreeFrame permissions do not match the scoped review session");
    return { linked: true, asset: bootstrap.asset, versions: bootstrap.versions, permissions: bootstrap.permissions };
  } catch (error) {
    sessions.clear();
    throw error;
  }
}

export async function linkAssetAndConfirm(
  binding: SequenceBinding,
  plane: PlaneClient,
  sessions: ReviewSessionManager,
  asset: ReviewAsset,
): Promise<LinkedAssetState> {
  if (asset.asset_type !== "video") throw new Error("Only video assets can be linked to a Premiere sequence");
  const confirmedAssetId = await plane.linkAsset(binding.workspaceSlug, binding.projectId, binding.workItemId, asset.id);
  if (confirmedAssetId !== asset.id) throw new Error("Plane confirmed a different FreeFrame asset");
  sessions.clear();
  const state = await loadAssetReview(binding, plane, sessions);
  if (!state.linked || state.asset.id !== asset.id) throw new Error("The Plane and FreeFrame asset link could not be confirmed");
  return state;
}

export async function createVideoAssetAndLink(
  binding: SequenceBinding,
  plane: PlaneClient,
  sessions: ReviewSessionManager,
  name: string,
): Promise<LinkedAssetState> {
  const asset = await plane.createAsset(binding.workspaceSlug, binding.projectId, binding.workItemId, name);
  if (asset.asset_type !== "video") throw new Error("Plane created an incompatible FreeFrame asset");
  return linkAssetAndConfirm(binding, plane, sessions, asset);
}

export async function unlinkAssetAndConfirm(
  binding: SequenceBinding,
  plane: PlaneClient,
  sessions: ReviewSessionManager,
  current: LinkedAssetState,
): Promise<UnlinkedAssetState> {
  if (!current.permissions.manage) throw new Error("The scoped review session cannot manage the asset link");
  await plane.unlinkAsset(binding.workspaceSlug, binding.projectId, binding.workItemId);
  sessions.clear();
  const state = await loadAssetReview(binding, plane, sessions);
  if (state.linked) throw new Error("Plane still reports the FreeFrame asset as linked");
  return state;
}
