import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compatibleVideoAssets,
  createVideoAssetAndLink,
  linkAssetAndConfirm,
  loadAssetReview,
  unlinkAssetAndConfirm,
} from "../src/asset-workflow";
import type { LinkedReview, ReviewAsset, SequenceBinding } from "../src/domain";
import { PlaneError } from "../src/plane-client";
import { ReviewSessionManager } from "../src/review-session";

const ids = {
  workspace: "11111111-1111-4111-8111-111111111111",
  project: "22222222-2222-4222-8222-222222222222",
  issue: "33333333-3333-4333-8333-333333333333",
  asset: "44444444-4444-4444-8444-444444444444",
  shadowUser: "55555555-5555-4555-8555-555555555555",
  planeUser: "66666666-6666-4666-8666-666666666666",
} as const;
const binding: SequenceBinding = {
  projectGuid: "premiere-project",
  sequenceId: "premiere-sequence",
  baseUrl: "https://plane.test",
  workspaceSlug: "workspace",
  projectId: ids.project,
  workItemId: ids.issue,
};
const asset: ReviewAsset = {
  id: ids.asset,
  name: "Campaign cut",
  asset_type: "video",
  description: null,
  status: "active",
  thumbnail_url: null,
};
const linkedSession: LinkedReview = {
  linked: true,
  session: {
    asset_id: ids.asset,
    integration_token: "plane-integration-token",
    expires_in: 300,
    can_manage: true,
    freeframe_api_url: "https://freeframe.test/api",
  },
};
const exchangeFixture = {
  access_token: "memory-only",
  token_type: "bearer",
  expires_in: 300,
  user: { id: ids.shadowUser, plane_user_id: ids.planeUser, email: "editor@example.test", name: "Editor" },
  context: { workspace_id: ids.workspace, project_id: ids.project, issue_id: ids.issue },
  scopes: ["review:read", "review:comment", "review:upload", "review:manage"],
};
const bootstrapFixture = {
  context: { workspace_id: ids.workspace, project_id: ids.project, issue_id: ids.issue },
  asset,
  versions: [],
  permissions: { read: true, comment: true, upload: true, manage: true },
};

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => body === undefined ? "" : JSON.stringify(body) };
}

afterEach(() => vi.unstubAllGlobals());

describe("authoritative asset workflow", () => {
  it("preserves the controlled unlinked response and management capability", async () => {
    const plane = { getReviewSession: vi.fn().mockResolvedValue({ linked: false, can_manage: false }) };
    const sessions = { clear: vi.fn() };
    await expect(loadAssetReview(binding, plane as any, sessions as any)).resolves.toEqual({ linked: false, canManage: false });
    expect(sessions.clear).toHaveBeenCalledOnce();
  });

  it("loads a linked asset only after the Plane session and FreeFrame bootstrap agree", async () => {
    const plane = { getReviewSession: vi.fn().mockResolvedValue(linkedSession) };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(exchangeFixture))
      .mockResolvedValueOnce(response(bootstrapFixture)));
    const state = await loadAssetReview(binding, plane as any, new ReviewSessionManager(plane as any));
    expect(state).toEqual({ linked: true, asset, versions: [], permissions: bootstrapFixture.permissions });
  });

  it("fails closed when bootstrap permissions do not match the scoped session", async () => {
    const plane = { getReviewSession: vi.fn().mockResolvedValue(linkedSession) };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(exchangeFixture))
      .mockResolvedValueOnce(response({ ...bootstrapFixture, permissions: { ...bootstrapFixture.permissions, manage: false } })));
    await expect(loadAssetReview(binding, plane as any, new ReviewSessionManager(plane as any))).rejects.toThrow("permissions do not match");
  });

  it("fails closed when FreeFrame confirms a different asset", async () => {
    const plane = { getReviewSession: vi.fn().mockResolvedValue(linkedSession) };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(exchangeFixture))
      .mockResolvedValueOnce(response({ ...bootstrapFixture, asset: { ...asset, id: "77777777-7777-4777-8777-777777777777" } })));
    await expect(loadAssetReview(binding, plane as any, new ReviewSessionManager(plane as any))).rejects.toThrow("mismatched review asset");
  });

  it("keeps a Plane asset-link conflict visible and does not attempt confirmation", async () => {
    const plane = {
      linkAsset: vi.fn().mockRejectedValue(new PlaneError("Plane request failed", 409, { error: "already linked" })),
      getReviewSession: vi.fn(),
    };
    const sessions = { clear: vi.fn() };
    await expect(linkAssetAndConfirm(binding, plane as any, sessions as any, asset)).rejects.toMatchObject({ status: 409 });
    expect(plane.getReviewSession).not.toHaveBeenCalled();
    expect(sessions.clear).not.toHaveBeenCalled();
  });

  it("links only after Plane and FreeFrame both confirm the exact asset", async () => {
    const plane = {
      linkAsset: vi.fn().mockResolvedValue(ids.asset),
      getReviewSession: vi.fn().mockResolvedValue(linkedSession),
    };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(exchangeFixture))
      .mockResolvedValueOnce(response(bootstrapFixture)));
    const state = await linkAssetAndConfirm(binding, plane as any, new ReviewSessionManager(plane as any), asset);
    expect(state.asset.id).toBe(ids.asset);
    expect(plane.linkAsset).toHaveBeenCalledWith("workspace", ids.project, ids.issue, ids.asset);
  });

  it("creates a video asset through Plane before linking and confirming it", async () => {
    const plane = {
      createAsset: vi.fn().mockResolvedValue(asset),
      linkAsset: vi.fn().mockResolvedValue(ids.asset),
      getReviewSession: vi.fn().mockResolvedValue(linkedSession),
    };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(exchangeFixture))
      .mockResolvedValueOnce(response(bootstrapFixture)));
    const state = await createVideoAssetAndLink(binding, plane as any, new ReviewSessionManager(plane as any), "Campaign cut");
    expect(state.asset.id).toBe(ids.asset);
    expect(plane.createAsset).toHaveBeenCalledWith("workspace", ids.project, ids.issue, "Campaign cut");
  });

  it("gates remote unlink before any network request when review:manage is absent", async () => {
    const plane = { unlinkAsset: vi.fn() };
    const current = { linked: true as const, asset, versions: [], permissions: { read: true, comment: true, upload: true, manage: false } };
    await expect(unlinkAssetAndConfirm(binding, plane as any, { clear: vi.fn() } as any, current)).rejects.toThrow("cannot manage");
    expect(plane.unlinkAsset).not.toHaveBeenCalled();
  });

  it("does not report unlink success until Plane returns the controlled unlinked state", async () => {
    const plane = {
      unlinkAsset: vi.fn().mockResolvedValue(undefined),
      getReviewSession: vi.fn().mockResolvedValue({ linked: false, can_manage: true }),
    };
    const current = { linked: true as const, asset, versions: [], permissions: bootstrapFixture.permissions };
    await expect(unlinkAssetAndConfirm(binding, plane as any, new ReviewSessionManager(plane as any), current)).resolves.toEqual({ linked: false, canManage: true });
    expect(plane.unlinkAsset).toHaveBeenCalledOnce();
  });

  it("shows only compatible video assets from the Plane-proxied catalog", () => {
    expect(compatibleVideoAssets([asset, { ...asset, id: "77777777-7777-4777-8777-777777777777", asset_type: "image" }])).toEqual([asset]);
  });
});
