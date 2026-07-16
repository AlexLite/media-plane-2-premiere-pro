import type { ReviewVersion } from "./domain";
import type { DesiredMarker } from "./markers";
import type { PositionedReviewComment } from "./review-comments";

export interface ReviewMarkerLabels {
  open: string;
  resolved: string;
  author: string;
  status: string;
  freeframeComment: string;
}

export interface ReviewMarkerBuildResult {
  markers: DesiredMarker[];
  skipped: number;
}

function excerpt(value: string, max = 320): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

export function buildReviewMarkers(
  assetId: string,
  version: ReviewVersion,
  workItemIdentifier: string,
  comments: PositionedReviewComment[],
  labels: ReviewMarkerLabels,
): ReviewMarkerBuildResult {
  const markers: DesiredMarker[] = [];
  let skipped = 0;
  for (const item of comments) {
    if (item.position.status !== "ready" || item.position.frameNumber === undefined || item.position.seconds === undefined) {
      skipped += 1;
      continue;
    }
    const author = item.comment.author?.name ?? item.comment.guest_author?.name ?? "—";
    const status = item.comment.resolved ? labels.resolved : labels.open;
    const rangeEndFrame = item.position.rangeEndFrame ?? null;
    const durationSeconds = item.position.rangeEndSeconds !== null && item.position.rangeEndSeconds !== undefined
      ? Math.max(0, item.position.rangeEndSeconds - item.position.seconds)
      : 0;
    markers.push({
      identity: {
        plugin: "plane-freeframe-review",
        assetId,
        versionId: version.id,
        commentId: item.comment.id,
        frameNumber: item.position.frameNumber,
        rangeEndFrame,
      },
      startSeconds: item.position.seconds,
      durationSeconds,
      markerType: "Comment",
      name: `${workItemIdentifier} · v${version.version_number} · ${status}`,
      comment: [
        `${labels.author}: ${author}`,
        `${labels.status}: ${status}`,
        excerpt(item.comment.body),
        `${labels.freeframeComment}: ${item.comment.id}`,
      ].join("\n"),
    });
  }
  return { markers, skipped };
}
