import type { ReviewComment, ReviewVersion } from "./domain";
import { frameToSeconds, secondsToFrame, type RationalFps, validateFps } from "./timing";

export type CommentTimingStatus =
  | "ready"
  | "untimed"
  | "timing-unavailable"
  | "timing-conflict"
  | "outside-version"
  | "outside-sequence";

export interface CanonicalCommentPosition {
  status: CommentTimingStatus;
  frameNumber?: number;
  rangeEndFrame?: number | null;
  seconds?: number;
  rangeEndSeconds?: number | null;
  fps?: RationalFps;
  source?: "annotation" | "seconds";
}

export class ReviewTimingError extends Error {
  constructor(readonly code: "timing-unavailable" | "outside-version" | "outside-sequence" | "invalid-playhead", message: string) { super(message); }
}

export interface PlayheadPosition {
  frameNumber: number;
  seconds: number;
  fps: RationalFps;
}

function versionFps(version: ReviewVersion): RationalFps | undefined {
  const numerator = version.fps_numerator;
  const denominator = version.fps_denominator;
  if (typeof numerator !== "number" || typeof denominator !== "number") return undefined;
  const fps: RationalFps = { numerator, denominator };
  validateFps(fps);
  return fps;
}

function finiteNonNegative(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function frameWithinDuration(frame: number, durationSeconds: number | undefined, fps: RationalFps): boolean {
  if (durationSeconds === undefined) return true;
  return frameToSeconds(frame, fps) < durationSeconds;
}

export function canonicalCommentPosition(
  comment: ReviewComment,
  version: ReviewVersion,
  sequenceDurationSeconds?: number,
): CanonicalCommentPosition {
  if (comment.version_id !== version.id) throw new Error("Comment does not belong to the selected version");
  const fps = versionFps(version);
  const startSeconds = finiteNonNegative(comment.timecode_start);
  const endSeconds = finiteNonNegative(comment.timecode_end);
  const annotationFrame = comment.annotation?.frame_number;
  const hasAnnotation = Number.isInteger(annotationFrame) && (annotationFrame as number) >= 0;

  if (!fps) {
    return hasAnnotation || startSeconds !== undefined
      ? { status: "timing-unavailable" }
      : { status: "untimed" };
  }
  if (!hasAnnotation && startSeconds === undefined) return { status: "untimed", fps };

  let frameNumber: number;
  let source: "annotation" | "seconds";
  if (hasAnnotation) {
    frameNumber = annotationFrame as number;
    source = "annotation";
    if (startSeconds !== undefined) {
      const secondsFrame = secondsToFrame(startSeconds, fps);
      if (secondsFrame !== frameNumber) return { status: "timing-conflict", fps };
    }
  } else {
    frameNumber = secondsToFrame(startSeconds!, fps);
    source = "seconds";
  }

  const canonicalSeconds = frameToSeconds(frameNumber, fps);
  let rangeEndFrame: number | null = null;
  let canonicalEndSeconds: number | null = null;
  if (endSeconds !== undefined) {
    rangeEndFrame = secondsToFrame(endSeconds, fps);
    if (rangeEndFrame < frameNumber) return { status: "timing-conflict", fps };
    canonicalEndSeconds = frameToSeconds(rangeEndFrame, fps);
  }

  const versionDuration = finiteNonNegative(version.duration_seconds);
  if (!frameWithinDuration(frameNumber, versionDuration, fps)
    || (rangeEndFrame !== null && !frameWithinDuration(rangeEndFrame, versionDuration, fps))) {
    return { status: "outside-version", frameNumber, rangeEndFrame, seconds: canonicalSeconds, rangeEndSeconds: canonicalEndSeconds, fps, source };
  }
  const sequenceDuration = finiteNonNegative(sequenceDurationSeconds);
  if (!frameWithinDuration(frameNumber, sequenceDuration, fps)
    || (rangeEndFrame !== null && !frameWithinDuration(rangeEndFrame, sequenceDuration, fps))) {
    return { status: "outside-sequence", frameNumber, rangeEndFrame, seconds: canonicalSeconds, rangeEndSeconds: canonicalEndSeconds, fps, source };
  }
  return { status: "ready", frameNumber, rangeEndFrame, seconds: canonicalSeconds, rangeEndSeconds: canonicalEndSeconds, fps, source };
}

export function canonicalPlayheadPosition(
  playheadSeconds: number,
  version: ReviewVersion,
  sequenceDurationSeconds?: number,
): PlayheadPosition {
  const fps = versionFps(version);
  if (!fps) throw new ReviewTimingError("timing-unavailable", "Selected version timing is unavailable");
  if (!Number.isFinite(playheadSeconds) || playheadSeconds < 0) throw new ReviewTimingError("invalid-playhead", "Premiere returned an invalid playhead position");
  const frameNumber = secondsToFrame(playheadSeconds, fps);
  const seconds = frameToSeconds(frameNumber, fps);
  const versionDuration = finiteNonNegative(version.duration_seconds);
  if (!frameWithinDuration(frameNumber, versionDuration, fps)) throw new ReviewTimingError("outside-version", "Playhead is outside the selected review version");
  const sequenceDuration = finiteNonNegative(sequenceDurationSeconds);
  if (!frameWithinDuration(frameNumber, sequenceDuration, fps)) throw new ReviewTimingError("outside-sequence", "Playhead is outside the active Premiere sequence");
  return { frameNumber, seconds, fps };
}
