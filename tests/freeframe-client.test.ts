import { afterEach, describe, expect, it, vi } from "vitest";
import { FreeFrameClient } from "../src/freeframe-client";

const ids = {
  workspace: "11111111-1111-4111-8111-111111111111",
  project: "22222222-2222-4222-8222-222222222222",
  issue: "33333333-3333-4333-8333-333333333333",
  asset: "44444444-4444-4444-8444-444444444444",
  version: "55555555-5555-4555-8555-555555555555",
  shadowUser: "66666666-6666-4666-8666-666666666666",
  planeUser: "77777777-7777-4777-8777-777777777777",
} as const;

const session = {
  access_token: "memory-only",
  token_type: "bearer",
  expires_in: 300,
  user: { id: ids.shadowUser, plane_user_id: ids.planeUser, email: "editor@example.test", name: "Editor" },
  context: { workspace_id: ids.workspace, project_id: ids.project, issue_id: ids.issue },
  scopes: ["review:read"],
};

const response = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
});

afterEach(() => vi.unstubAllGlobals());

describe("FreeFrame playback contract", () => {
  it("accepts scoped relative playback metadata only after session exchange", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response({ url: "/stream/hls/master.m3u8?token=ephemeral", asset_type: "video", expires_in: 600 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FreeFrameClient("https://freeframe.test/api");
    await client.exchange("integration-token", { projectId: ids.project, issueId: ids.issue });
    await expect(client.stream(ids.asset, ids.version)).resolves.toEqual({
      url: "/stream/hls/master.m3u8?token=ephemeral",
      asset_type: "video",
      expires_in: 600,
    });
    expect(fetchMock.mock.calls[1][0]).toBe(`https://freeframe.test/api/integrations/plane/assets/${ids.asset}/stream?version_id=${ids.version}`);
  });

  it("rejects insecure or credential-bearing playback URLs", async () => {
    for (const url of ["http://storage.test/video.mp4", "https://user:secret@storage.test/video.mp4", "//storage.test/video.mp4"]) {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(response({ url, asset_type: "video", expires_in: 600 }));
      vi.stubGlobal("fetch", fetchMock);
      const client = new FreeFrameClient("https://freeframe.test");
      await client.exchange("integration-token", { projectId: ids.project, issueId: ids.issue });
      await expect(client.stream(ids.asset, ids.version)).rejects.toThrow("unsafe playback URL");
    }
  });
});
