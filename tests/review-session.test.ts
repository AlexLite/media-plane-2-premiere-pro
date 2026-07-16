import { describe, expect, it, vi } from "vitest";
import { ReviewSessionManager } from "../src/review-session";

const binding = { projectGuid: "pg", sequenceId: "s", baseUrl: "https://plane.test", workspaceSlug: "ws", projectId: "p", workItemId: "i" };
describe("review session", () => {
  it("fails closed when Plane does not discover the FreeFrame URL", async () => {
    const plane = { getReviewSession: vi.fn().mockResolvedValue({ linked: true, session: { asset_id: "a", integration_token: "t", expires_in: 300, can_manage: false } }) };
    await expect(new ReviewSessionManager(plane as any).get(binding)).rejects.toThrow("trusted FreeFrame API URL");
  });
  it("renews through Plane after expiry and keeps the FreeFrame token in memory", async () => {
    let now = 1_000;
    const plane = { getReviewSession: vi.fn().mockResolvedValue({ linked: true, session: { asset_id: "a", integration_token: "short", expires_in: 10, can_manage: false, freeframe_api_url: "https://freeframe.test" } }) };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ access_token: "memory-only", expires_in: 10, scopes: ["review:read"] }) }));
    const manager = new ReviewSessionManager(plane as any, () => now);
    await manager.get(binding); await manager.get(binding);
    expect(plane.getReviewSession).toHaveBeenCalledTimes(1);
    now = 7_000; await manager.get(binding);
    expect(plane.getReviewSession).toHaveBeenCalledTimes(2);
  });
});
