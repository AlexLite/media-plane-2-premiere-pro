import type { ReviewComment, ReviewVersion } from "./domain";
import { FreeFrameClient } from "./freeframe-client";
import { canonicalCommentPosition, canonicalPlayheadPosition, type CanonicalCommentPosition } from "./review-timing";

export interface PositionedReviewComment {
  comment: ReviewComment;
  position: CanonicalCommentPosition;
}

export interface ReviewCommentLoadOptions { sequenceDurationSeconds?: number; signal?: AbortSignal }

export async function loadVersionComments(
  client: FreeFrameClient,
  assetId: string,
  version: ReviewVersion,
  options: ReviewCommentLoadOptions = {},
): Promise<PositionedReviewComment[]> {
  const comments = await client.comments(assetId, version.id, options.signal);
  return comments
    .map(comment => ({ comment, position: canonicalCommentPosition(comment, version, options.sequenceDurationSeconds) }))
    .sort((left, right) => {
      const leftFrame = left.position.frameNumber ?? Number.POSITIVE_INFINITY;
      const rightFrame = right.position.frameNumber ?? Number.POSITIVE_INFINITY;
      return leftFrame - rightFrame || Date.parse(left.comment.created_at) - Date.parse(right.comment.created_at);
    });
}

export async function createCommentAtPlayhead(
  client: FreeFrameClient,
  assetId: string,
  version: ReviewVersion,
  body: string,
  playheadSeconds: number,
  sequenceDurationSeconds?: number,
  signal?: AbortSignal,
): Promise<PositionedReviewComment> {
  const position = canonicalPlayheadPosition(playheadSeconds, version, sequenceDurationSeconds);
  const created = await client.createComment(assetId, version.id, {
    body,
    timecode_start: position.seconds,
    annotation: { drawing_data: {}, frame_number: position.frameNumber },
  }, signal);
  const confirmed = canonicalCommentPosition(created, version, sequenceDurationSeconds);
  if (confirmed.status !== "ready" || confirmed.frameNumber !== position.frameNumber) throw new Error("FreeFrame did not confirm the canonical comment frame");
  return { comment: created, position: confirmed };
}

export async function setCommentResolved(
  client: FreeFrameClient,
  assetId: string,
  versionId: string,
  comment: ReviewComment,
  resolved: boolean,
  signal?: AbortSignal,
): Promise<ReviewComment> {
  if (comment.asset_id !== assetId || comment.version_id !== versionId) throw new Error("Comment does not belong to the selected review version");
  if (comment.resolved === resolved) return comment;
  const confirmed = await client.toggleResolved(assetId, versionId, comment.id, signal);
  if (confirmed.resolved !== resolved) throw new Error("FreeFrame did not confirm the requested resolution state");
  return confirmed;
}
