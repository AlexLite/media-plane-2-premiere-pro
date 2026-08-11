import { describe, expect, it, vi } from "vitest";
import type { ReviewComment, ReviewVersion } from "../src/domain";
import { createCommentAtPlayhead, loadVersionComments, setCommentResolved } from "../src/review-comments";

const assetId = "44444444-4444-4444-8444-444444444444";
const version: ReviewVersion = {
  id: "55555555-5555-4555-8555-555555555555",
  version_number: 2,
  processing_status: "ready",
  created_at: "2026-07-16T10:00:00Z",
  duration_seconds: 100,
  fps_numerator: 25,
  fps_denominator: 1,
};
const comment = (id: string, frame: number, resolved = false): ReviewComment => ({
  id,
  asset_id: assetId,
  version_id: version.id,
  parent_id: null,
  author_id: "77777777-7777-4777-8777-777777777777",
  guest_author_id: null,
  timecode_start: frame / 25,
  timecode_end: null,
  body: `Frame ${frame}`,
  resolved,
  visibility: "public",
  created_at: "2026-07-16T10:00:00Z",
  updated_at: "2026-07-16T10:00:00Z",
  author: { id: "77777777-7777-4777-8777-777777777777", name: "Editor", avatar_url: null },
  guest_author: null,
  annotation: { id: `88888888-8888-4888-8888-${String(frame).padStart(12, "0")}`, comment_id: id, drawing_data: {}, frame_number: frame, carousel_position: null },
  replies: [],
});

describe("review comment workflow", () => {
  it("loads selected-version comments ordered by canonical frame", async () => {
    const client = { comments: vi.fn().mockResolvedValue([
      comment("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 50),
      comment("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 10),
    ]) };
    const loaded = await loadVersionComments(client as any, assetId, version, { sequenceDurationSeconds: 120 });
    expect(loaded.map(item => item.position.frameNumber)).toEqual([10, 50]);
  });

  it("creates at the current playhead and requires FreeFrame to confirm the same canonical frame", async () => {
    const confirmed = comment("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 38);
    const client = { createComment: vi.fn().mockResolvedValue(confirmed) };
    const created = await createCommentAtPlayhead(client as any, assetId, version, "Trim here", 1.52, 120);
    expect(created.position.frameNumber).toBe(38);
    expect(client.createComment).toHaveBeenCalledWith(assetId, version.id, {
      body: "Trim here",
      timecode_start: 38 / 25,
      annotation: { drawing_data: {}, frame_number: 38 },
    }, undefined);
  });

  it("fails when the server confirms a different frame", async () => {
    const client = { createComment: vi.fn().mockResolvedValue(comment("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 39)) };
    await expect(createCommentAtPlayhead(client as any, assetId, version, "Trim", 1.52, 120)).rejects.toThrow("canonical comment frame");
  });

  it("resolves and reopens only from the server-confirmed toggle response", async () => {
    const open = comment("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 10, false);
    const client = { toggleResolved: vi.fn().mockResolvedValue({ ...open, resolved: true }) };
    await expect(setCommentResolved(client as any, assetId, version.id, open, true)).resolves.toMatchObject({ resolved: true });
    expect(client.toggleResolved).toHaveBeenCalledOnce();

    client.toggleResolved.mockResolvedValue({ ...open, resolved: false });
    await expect(setCommentResolved(client as any, assetId, version.id, open, true)).rejects.toThrow("did not confirm");
  });

  it("does not toggle when the comment is already in the requested state", async () => {
    const resolved = comment("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 10, true);
    const client = { toggleResolved: vi.fn() };
    await expect(setCommentResolved(client as any, assetId, version.id, resolved, true)).resolves.toBe(resolved);
    expect(client.toggleResolved).not.toHaveBeenCalled();
  });
});
