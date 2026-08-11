import { describe, expect, it } from "vitest";
import type { ReviewComment, ReviewVersion } from "../src/domain";
import { canonicalCommentPosition, canonicalPlayheadPosition } from "../src/review-timing";

const version: ReviewVersion = {
  id: "55555555-5555-4555-8555-555555555555",
  version_number: 3,
  processing_status: "ready",
  created_at: "2026-07-16T10:00:00Z",
  duration_seconds: 100,
  fps_numerator: 30000,
  fps_denominator: 1001,
};
const comment = (overrides: Partial<ReviewComment> = {}): ReviewComment => ({
  id: "66666666-6666-4666-8666-666666666666",
  asset_id: "44444444-4444-4444-8444-444444444444",
  version_id: version.id,
  parent_id: null,
  author_id: "77777777-7777-4777-8777-777777777777",
  guest_author_id: null,
  timecode_start: 1842 * 1001 / 30000,
  timecode_end: null,
  body: "Trim this frame",
  resolved: false,
  visibility: "public",
  created_at: "2026-07-16T10:00:00Z",
  updated_at: "2026-07-16T10:00:00Z",
  author: { id: "77777777-7777-4777-8777-777777777777", name: "Editor", avatar_url: null },
  guest_author: null,
  annotation: {
    id: "88888888-8888-4888-8888-888888888888",
    comment_id: "66666666-6666-4666-8666-666666666666",
    drawing_data: {},
    frame_number: 1842,
    carousel_position: null,
  },
  replies: [],
  ...overrides,
});

describe("FreeFrame comment timing compatibility adapter", () => {
  it("uses the annotation frame as canonical identity at NTSC rate", () => {
    expect(canonicalCommentPosition(comment(), version, 90)).toMatchObject({
      status: "ready",
      frameNumber: 1842,
      source: "annotation",
      fps: { numerator: 30000, denominator: 1001 },
    });
  });

  it("converts legacy seconds to a canonical frame without leaking seconds into identity", () => {
    const position = canonicalCommentPosition(comment({ annotation: null }), version, 90);
    expect(position).toMatchObject({ status: "ready", frameNumber: 1842, source: "seconds" });
  });

  it("fails closed when annotation and seconds point to different frames", () => {
    expect(canonicalCommentPosition(comment({ timecode_start: 1 }), version, 90).status).toBe("timing-conflict");
  });

  it("derives an optional canonical range end", () => {
    const endFrame = 1850;
    expect(canonicalCommentPosition(comment({ timecode_end: endFrame * 1001 / 30000 }), version, 90)).toMatchObject({
      status: "ready",
      frameNumber: 1842,
      rangeEndFrame: endFrame,
    });
  });

  it("distinguishes missing timing, untimed, outside-version, and outside-sequence states", () => {
    expect(canonicalCommentPosition(comment(), { ...version, fps_numerator: null, fps_denominator: null }, 90).status).toBe("timing-unavailable");
    expect(canonicalCommentPosition(comment({ annotation: null, timecode_start: null }), version, 90).status).toBe("untimed");
    expect(canonicalCommentPosition(comment({ annotation: { ...comment().annotation!, frame_number: 3100 }, timecode_start: null }), version, 90).status).toBe("outside-version");
    expect(canonicalCommentPosition(comment(), version, 20).status).toBe("outside-sequence");
  });

  it("snaps the Premiere playhead to the selected version rational frame rate", () => {
    expect(canonicalPlayheadPosition(1842 * 1001 / 30000 + 0.0001, version, 90)).toEqual({
      frameNumber: 1842,
      seconds: 1842 * 1001 / 30000,
      fps: { numerator: 30000, denominator: 1001 },
    });
  });

  it("rejects playheads outside the selected version", () => {
    expect(() => canonicalPlayheadPosition(100.1, version, 120)).toThrow("outside the selected review version");
  });
});
