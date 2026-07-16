import { describe, expect, it } from "vitest";
import type { Marker } from "../src/domain";
import { planMarkerReconciliation, readIdentity, serializeIdentity, type DesiredMarker, type MarkerIdentity } from "../src/markers";

const scope = { assetId: "asset-a", versionId: "version-1" };
const identity: MarkerIdentity = { plugin: "plane-freeframe-review", assetId: scope.assetId, versionId: scope.versionId, commentId: "comment-1", frameNumber: 42 };
const desired = (overrides: Partial<DesiredMarker> = {}): DesiredMarker => ({
  identity,
  startSeconds: 1.4,
  durationSeconds: 0,
  name: "MEDIA-1 · v1 · Open",
  comment: "Reviewer: Editor\nReview status: Open\nFix this\nFreeFrame comment: comment-1",
  markerType: "Comment",
  ...overrides,
});
const snapshot = (value = desired(), overrides: Partial<Marker> = {}): Marker => ({
  id: "marker-1",
  startSeconds: value.startSeconds,
  durationSeconds: value.durationSeconds,
  name: value.name,
  comments: `${serializeIdentity(value.identity)}\n${value.comment}`,
  markerType: value.markerType,
  ...overrides,
});

describe("FreeFrame marker identity and reconciliation", () => {
  it("round trips canonical identity and rejects invalid ranges", () => {
    expect(readIdentity(serializeIdentity(identity))).toEqual(identity);
    expect(readIdentity(serializeIdentity({ ...identity, rangeEndFrame: 41 }))).toBeUndefined();
  });

  it("is idempotent and preserves unrelated editor, asset, and version markers", () => {
    const existing = [
      snapshot(),
      { id: "editor", startSeconds: 2, name: "Editor", comments: "private note" },
      snapshot({ ...desired(), identity: { ...identity, assetId: "asset-b" } }, { id: "other-asset" }),
      snapshot({ ...desired(), identity: { ...identity, versionId: "version-2" } }, { id: "other-version" }),
    ];
    const plan = planMarkerReconciliation(existing, [desired()], scope);
    expect(plan).toEqual({ create: [], update: [], remove: [], unchanged: 1, ignored: 3 });
  });

  it("removes stale and duplicate markers only inside the selected scope", () => {
    const stale = snapshot({ ...desired(), identity: { ...identity, commentId: "stale" } }, { id: "stale" });
    const duplicate = snapshot(desired(), { id: "duplicate" });
    const plan = planMarkerReconciliation([snapshot(), duplicate, stale], [desired()], scope);
    expect(plan.remove).toEqual(["duplicate", "stale"]);
    expect(plan.unchanged).toBe(1);
  });

  it("updates resolved state and a manually moved marker without creating a duplicate", () => {
    const resolved = desired({ name: "MEDIA-1 · v1 · Resolved", comment: "Reviewer: Editor\nReview status: Resolved\nFix this\nFreeFrame comment: comment-1" });
    const plan = planMarkerReconciliation([snapshot(desired(), { startSeconds: 9 })], [resolved], scope);
    expect(plan.create).toHaveLength(0);
    expect(plan.remove).toHaveLength(0);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0].marker.startSeconds).toBe(1.4);
    expect(plan.update[0].marker.name).toContain("Resolved");
  });
});
