import { afterEach, describe, expect, it, vi } from "vitest";
import { PlaneClient } from "../src/plane-client";

afterEach(() => vi.unstubAllGlobals());

describe("Plane connection and review client", () => {
  it("validates the PAT through the current-user and workspace contracts", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/users/me/")) return { ok: true, status: 200, text: async () => JSON.stringify({ id: "user-1", email: "editor@example.test", display_name: "Editor" }) };
      if (url.endsWith("/api/v1/workspaces/")) return { ok: true, status: 200, text: async () => JSON.stringify([{ id: "workspace-1", slug: "studio", name: "Studio" }]) };
      throw new Error("unexpected request");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(new PlaneClient("https://plane.test/", "pat").validate()).resolves.toEqual({
      user: { id: "user-1", email: "editor@example.test", displayName: "Editor" },
      workspaces: [{ id: "workspace-1", slug: "studio", name: "Studio" }],
    });
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(["https://plane.test/api/users/me/", "https://plane.test/api/v1/workspaces/"]);
  });

  it("rejects malformed current-user payloads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ id: "user-1" }) }));
    await expect(new PlaneClient("https://plane.test", "pat").getCurrentUser()).rejects.toThrow("invalid user");
  });

  it("uses the issue-scoped review endpoint instead of ordinary comments", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ asset_id: "44444444-4444-4444-8444-444444444444", integration_token: "short-lived", expires_in: 300, can_manage: false, freeframe_api_url: "https://freeframe.test" }) });
    vi.stubGlobal("fetch", fetchMock);
    const state = await new PlaneClient("https://plane.test", "pat").getReviewSession("ws", "p", "i");
    expect(state.linked).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("https://plane.test/api/workspaces/ws/projects/p/issues/i/freeframe-review-session/");
    expect(fetchMock.mock.calls[0][0]).not.toContain("comments");
  });

  it("validates Plane-proxied asset catalog and create responses", async () => {
    const asset = {
      id: "44444444-4444-4444-8444-444444444444",
      name: "Campaign cut",
      description: null,
      asset_type: "video",
      status: "active",
      thumbnail_url: null,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify([asset]) })
      .mockResolvedValueOnce({ ok: true, status: 201, text: async () => JSON.stringify(asset) });
    vi.stubGlobal("fetch", fetchMock);
    const client = new PlaneClient("https://plane.test", "pat");
    await expect(client.searchAssets("ws", "p", "i", "campaign cut")).resolves.toEqual([asset]);
    await expect(client.createAsset("ws", "p", "i", "  Campaign cut  ")).resolves.toEqual(asset);
    expect(fetchMock.mock.calls[0][0]).toContain("freeframe-review-assets/?q=campaign%20cut&limit=50");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ name: "Campaign cut", asset_type: "video", description: null });
  });

  it("requires Plane to return the exact asset ID after link", async () => {
    const assetId = "44444444-4444-4444-8444-444444444444";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 201, text: async () => JSON.stringify({ asset_id: assetId }) }));
    await expect(new PlaneClient("https://plane.test", "pat").linkAsset("ws", "p", "i", assetId)).resolves.toBe(assetId);
  });

  it("maps the controlled 404 body to an unlinked state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => JSON.stringify({ error: "not linked", can_manage: true }) }));
    await expect(new PlaneClient("https://plane.test", "pat").getReviewSession("ws", "p", "i")).resolves.toEqual({ linked: false, can_manage: true });
  });
});
