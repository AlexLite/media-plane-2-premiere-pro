import { afterEach, describe, expect, it, vi } from "vitest";
import { FreeFrameClient } from "../src/freeframe-client";

const ids = {
  workspace: "11111111-1111-4111-8111-111111111111",
  project: "22222222-2222-4222-8222-222222222222",
  issue: "33333333-3333-4333-8333-333333333333",
  asset: "44444444-4444-4444-8444-444444444444",
  version: "55555555-5555-4555-8555-555555555555",
  comment: "66666666-6666-4666-8666-666666666666",
  user: "77777777-7777-4777-8777-777777777777",
  annotation: "88888888-8888-4888-8888-888888888888",
  shadow: "99999999-9999-4999-8999-999999999999",
} as const;
const session = {
  access_token: "memory-only",
  token_type: "bearer",
  expires_in: 300,
  user: { id: ids.shadow, plane_user_id: ids.user, email: "editor@example.test", name: "Editor" },
  context: { workspace_id: ids.workspace, project_id: ids.project, issue_id: ids.issue },
  scopes: ["review:read", "review:comment"],
};
const comment = (overrides: Record<string, unknown> = {}) => ({
  id: ids.comment,
  asset_id: ids.asset,
  version_id: ids.version,
  parent_id: null,
  author_id: ids.user,
  guest_author_id: null,
  timecode_start: 1.5,
  timecode_end: null,
  body: "Trim this frame",
  resolved: false,
  visibility: "public",
  created_at: "2026-07-16T10:00:00Z",
  updated_at: "2026-07-16T10:00:00Z",
  author: { id: ids.user, name: "Editor", avatar_url: null },
  annotation: { id: ids.annotation, comment_id: ids.comment, drawing_data: {}, frame_number: 45, carousel_position: null },
  replies: [],
  attachments: [],
  reactions: [],
  ...overrides,
});
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });

async function client(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  const result = new FreeFrameClient("https://freeframe.test/api");
  await result.exchange("integration", { projectId: ids.project, issueId: ids.issue });
  return result;
}
afterEach(() => vi.unstubAllGlobals());

describe("FreeFrame version comment contract", () => {
  it("lists and validates comments from the exact version route", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(session)).mockResolvedValueOnce(response([comment()]));
    const result = await client(fetchMock);
    await expect(result.comments(ids.asset, ids.version)).resolves.toHaveLength(1);
    expect(fetchMock.mock.calls[1][0]).toBe(`https://freeframe.test/api/integrations/plane/assets/${ids.asset}/versions/${ids.version}/comments`);
  });

  it("creates a frame-bearing public comment and validates the confirmed response", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(session)).mockResolvedValueOnce(response(comment()));
    const result = await client(fetchMock);
    await result.createComment(ids.asset, ids.version, { body: "  Trim this frame  ", timecode_start: 1.5, annotation: { drawing_data: {}, frame_number: 45 } });
    const request = fetchMock.mock.calls[1];
    expect(request[0]).toContain(`/versions/${ids.version}/comments`);
    expect(JSON.parse(request[1].body)).toEqual({ body: "Trim this frame", timecode_start: 1.5, annotation: { drawing_data: {}, frame_number: 45 } });
  });

  it("uses the asset-scoped toggle endpoint and validates exact version context", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(session)).mockResolvedValueOnce(response(comment({ resolved: true })));
    const result = await client(fetchMock);
    await expect(result.toggleResolved(ids.asset, ids.version, ids.comment)).resolves.toMatchObject({ resolved: true });
    expect(fetchMock.mock.calls[1][0]).toBe(`https://freeframe.test/api/integrations/plane/assets/${ids.asset}/comments/${ids.comment}/resolve`);
  });

  it("fails closed for mismatched asset/version, malformed frames, or non-public comments", async () => {
    for (const payload of [
      comment({ asset_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
      comment({ version_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
      comment({ annotation: { ...comment().annotation, frame_number: -1 } }),
      comment({ visibility: "internal" }),
    ]) {
      const result = await client(vi.fn().mockResolvedValueOnce(response(session)).mockResolvedValueOnce(response([payload])));
      await expect(result.comments(ids.asset, ids.version)).rejects.toThrow();
      vi.unstubAllGlobals();
    }
  });
});
