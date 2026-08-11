import type { Marker, MarkerWrite } from "./domain";

export interface MarkerIdentity {
  plugin: "plane-freeframe-review";
  assetId: string;
  versionId: string;
  commentId: string;
  frameNumber: number;
  rangeEndFrame?: number | null;
}

const PREFIX = "[plane-freeframe-review]";
const EPSILON_SECONDS = 1e-6;

export function serializeIdentity(identity: MarkerIdentity): string {
  return `${PREFIX}${JSON.stringify(identity)}`;
}

export function readIdentity(comment: string): MarkerIdentity | undefined {
  if (!comment.startsWith(PREFIX)) return undefined;
  try {
    const value = JSON.parse(comment.slice(PREFIX.length).split("\n", 1)[0]) as Partial<MarkerIdentity>;
    if (
      value.plugin !== "plane-freeframe-review"
      || typeof value.assetId !== "string" || !value.assetId
      || typeof value.versionId !== "string" || !value.versionId
      || typeof value.commentId !== "string" || !value.commentId
      || !Number.isInteger(value.frameNumber) || (value.frameNumber as number) < 0
    ) return undefined;
    if (value.rangeEndFrame !== undefined && value.rangeEndFrame !== null) {
      if (!Number.isInteger(value.rangeEndFrame) || value.rangeEndFrame < (value.frameNumber as number)) return undefined;
    }
    return value as MarkerIdentity;
  } catch {
    return undefined;
  }
}

export function markerKey(value: MarkerIdentity): string {
  return [value.assetId, value.versionId, value.commentId, value.frameNumber, value.rangeEndFrame ?? ""].join("\u0000");
}

export interface DesiredMarker {
  identity: MarkerIdentity;
  startSeconds: number;
  durationSeconds?: number;
  name: string;
  comment: string;
  markerType?: string;
}

export interface MarkerUpdate {
  id: string;
  marker: MarkerWrite;
}

export interface MarkerReconciliationPlan {
  create: MarkerWrite[];
  update: MarkerUpdate[];
  remove: string[];
  unchanged: number;
  ignored: number;
}

export interface MarkerScope { assetId: string; versionId: string }

function markerWrite(value: DesiredMarker): MarkerWrite {
  return {
    startSeconds: value.startSeconds,
    durationSeconds: value.durationSeconds ?? 0,
    name: value.name,
    comments: `${serializeIdentity(value.identity)}\n${value.comment}`,
    markerType: value.markerType ?? "Comment",
  };
}

function sameSeconds(left: number | undefined, right: number | undefined): boolean {
  return Math.abs((left ?? 0) - (right ?? 0)) <= EPSILON_SECONDS;
}

function markerMatches(existing: Marker, desired: MarkerWrite): boolean {
  return sameSeconds(existing.startSeconds, desired.startSeconds)
    && sameSeconds(existing.durationSeconds, desired.durationSeconds)
    && existing.name === desired.name
    && existing.comments === desired.comments
    && (existing.markerType ?? "Comment") === (desired.markerType ?? "Comment");
}

export function planMarkerReconciliation(
  existing: Marker[],
  desired: DesiredMarker[],
  scope: MarkerScope,
): MarkerReconciliationPlan {
  const required = new Map<string, MarkerWrite>();
  for (const value of desired) {
    if (value.identity.assetId !== scope.assetId || value.identity.versionId !== scope.versionId) {
      throw new Error("Desired marker is outside the reconciliation scope");
    }
    const key = markerKey(value.identity);
    if (required.has(key)) throw new Error("Duplicate desired marker identity");
    required.set(key, markerWrite(value));
  }

  const seen = new Set<string>();
  const plan: MarkerReconciliationPlan = { create: [], update: [], remove: [], unchanged: 0, ignored: 0 };
  for (const marker of existing) {
    const identity = readIdentity(marker.comments);
    if (!identity || identity.assetId !== scope.assetId || identity.versionId !== scope.versionId) {
      plan.ignored += 1;
      continue;
    }
    const key = markerKey(identity);
    const expected = required.get(key);
    if (!expected || seen.has(key)) {
      plan.remove.push(marker.id);
      continue;
    }
    seen.add(key);
    if (markerMatches(marker, expected)) plan.unchanged += 1;
    else plan.update.push({ id: marker.id, marker: expected });
  }
  for (const [key, marker] of required) if (!seen.has(key)) plan.create.push(marker);
  return plan;
}

export interface MarkerGateway {
  list(): Promise<Marker[]>;
  apply(plan: MarkerReconciliationPlan): Promise<void>;
}

export async function reconcileMarkers(
  gateway: MarkerGateway,
  desired: DesiredMarker[],
  scope: MarkerScope,
): Promise<MarkerReconciliationPlan> {
  const plan = planMarkerReconciliation(await gateway.list(), desired, scope);
  if (plan.create.length || plan.update.length || plan.remove.length) await gateway.apply(plan);
  return plan;
}
