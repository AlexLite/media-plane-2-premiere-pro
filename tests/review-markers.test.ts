import { describe, expect, it } from "vitest";
import type { ReviewComment, ReviewVersion } from "../src/domain";
import { buildReviewMarkers } from "../src/review-markers";
import type { PositionedReviewComment } from "../src/review-comments";

const version: ReviewVersion = { id: "version-1", version_number: 3, processing_status: "ready", created_at: null, duration_seconds: 10, fps_numerator: 25, fps_denominator: 1 };
const comment = (id: string, resolved = false): ReviewComment => ({
  id,
  asset_id: "asset-1",
  version_id: version.id,
  parent_id: null,
  author_id: "user-1",
  guest_author_id: null,
  timecode_start: 2,
  timecode_end: null,
  body: "Please tighten this cut",
  resolved,
  visibility: "public",
  created_at: "2026-07-16T10:00:00Z",
  updated_at: "2026-07-16T10:00:00Z",
  author: { id: "user-1", name: "Reviewer", avatar_url: null },
  guest_author: null,
  annotation: null,
  replies: [],
});
const labels = { open: "Open", resolved: "Resolved", author: "Reviewer", status: "Review status", freeframeComment: "FreeFrame comment" };

describe("review marker builder", () => {
  it("builds canonical selected-version markers and skips unsafe timing", () => {
    const comments: PositionedReviewComment[] = [
      { comment: comment("comment-1"), position: { status: "ready", frameNumber: 50, rangeEndFrame: 75, seconds: 2, rangeEndSeconds: 3, fps: { numerator: 25, denominator: 1 }, source: "annotation" } },
      { comment: comment("comment-2"), position: { status: "timing-conflict", fps: { numerator: 25, denominator: 1 } } },
    ];
    const result = buildReviewMarkers("asset-1", version, "MEDIA-42", comments, labels);
    expect(result.skipped).toBe(1);
    expect(result.markers).toHaveLength(1);
    expect(result.markers[0]).toMatchObject({ startSeconds: 2, durationSeconds: 1, name: "MEDIA-42 · v3 · Open" });
    expect(result.markers[0].identity).toMatchObject({ assetId: "asset-1", versionId: version.id, commentId: "comment-1", frameNumber: 50, rangeEndFrame: 75 });
    expect(result.markers[0].comment).toContain("Please tighten this cut");
  });

  it("changes marker presentation for resolved comments without changing identity", () => {
    const open = buildReviewMarkers("asset-1", version, "MEDIA-42", [{ comment: comment("comment-1"), position: { status: "ready", frameNumber: 50, seconds: 2, fps: { numerator: 25, denominator: 1 }, source: "annotation" } }], labels).markers[0];
    const resolved = buildReviewMarkers("asset-1", version, "MEDIA-42", [{ comment: comment("comment-1", true), position: { status: "ready", frameNumber: 50, seconds: 2, fps: { numerator: 25, denominator: 1 }, source: "annotation" } }], labels).markers[0];
    expect(resolved.identity).toEqual(open.identity);
    expect(resolved.name).toContain("Resolved");
    expect(resolved.comment).toContain("Review status: Resolved");
  });
});
