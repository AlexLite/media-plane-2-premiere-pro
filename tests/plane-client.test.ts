import { describe, expect, it, vi } from "vitest";
import { PlaneClient } from "../src/plane-client";

describe("Plane review client", () => {
  it("uses the issue-scoped review endpoint instead of ordinary comments", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ asset_id: "a1", integration_token: "short-lived", expires_in: 300, can_manage: false, freeframe_api_url: "https://freeframe.test" }) });
    vi.stubGlobal("fetch", fetchMock);
    const state = await new PlaneClient("https://plane.test", "pat").getReviewSession("ws", "p", "i");
    expect(state.linked).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("https://plane.test/api/workspaces/ws/projects/p/issues/i/freeframe-review-session/");
    expect(fetchMock.mock.calls[0][0]).not.toContain("comments");
  });
  it("maps the controlled 404 body to an unlinked state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => JSON.stringify({ error: "not linked", can_manage: true }) }));
    await expect(new PlaneClient("https://plane.test", "pat").getReviewSession("ws", "p", "i")).resolves.toEqual({ linked: false, can_manage: true });
  });
});
