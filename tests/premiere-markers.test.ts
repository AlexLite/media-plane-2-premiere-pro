import { describe, expect, it, vi } from "vitest";
import { PremiereMarkerAdapter } from "../src/premiere-markers";
import { serializeIdentity, type DesiredMarker } from "../src/markers";

const projectGuid = "project-guid";
const sequenceId = "sequence-guid";
const scope = { assetId: "asset-1", versionId: "version-1" };
const desired: DesiredMarker = {
  identity: { plugin: "plane-freeframe-review", assetId: scope.assetId, versionId: scope.versionId, commentId: "comment-1", frameNumber: 50 },
  startSeconds: 2,
  durationSeconds: 0,
  name: "MEDIA-1 · v1 · Open",
  comment: "Reviewer: Editor",
  markerType: "Comment",
};

function marker(overrides: Record<string, unknown> = {}) {
  return {
    getStart: vi.fn(() => ({ seconds: 2 })),
    getDuration: vi.fn(() => ({ seconds: 0 })),
    getName: vi.fn(() => desired.name),
    getComments: vi.fn(() => `${serializeIdentity(desired.identity)}\n${desired.comment}`),
    getType: vi.fn(() => "Comment"),
    createSetDurationAction: vi.fn((value: unknown) => ({ kind: "duration", value })),
    createSetNameAction: vi.fn((value: unknown) => ({ kind: "name", value })),
    createSetCommentsAction: vi.fn((value: unknown) => ({ kind: "comments", value })),
    createSetTypeAction: vi.fn((value: unknown) => ({ kind: "type", value })),
    ...overrides,
  };
}

function runtime(existing: any[] = []) {
  const actions: any[] = [];
  const collection = {
    getMarkers: vi.fn(() => existing),
    createAddMarkerAction: vi.fn((...args: unknown[]) => ({ kind: "add", args })),
    createMoveMarkerAction: vi.fn((...args: unknown[]) => ({ kind: "move", args })),
    createRemoveMarkerAction: vi.fn((...args: unknown[]) => ({ kind: "remove", args })),
  };
  const compound = { addAction: vi.fn((action: unknown) => { actions.push(action); return true; }) };
  const sequence = { guid: { toString: () => sequenceId } };
  const project = {
    guid: { toString: () => projectGuid },
    getActiveSequence: vi.fn(async () => sequence),
    executeTransaction: vi.fn((callback: (value: typeof compound) => void) => { callback(compound); return true; }),
    lockedAccess: vi.fn((callback: () => void) => callback()),
  };
  const api = {
    Project: { getActiveProject: vi.fn(async () => project) },
    Markers: { getMarkers: vi.fn(async () => collection) },
    TickTime: { createWithSeconds: vi.fn((seconds: number) => ({ seconds })) },
  };
  return { api, project, collection, actions };
}

describe("Premiere marker transaction adapter", () => {
  it("creates markers in one undoable transaction", async () => {
    const host = runtime();
    const adapter = new PremiereMarkerAdapter(() => host.api);
    await expect(adapter.reconcile(projectGuid, sequenceId, [desired], scope, "Sync review markers")).resolves.toEqual({ created: 1, updated: 0, removed: 0, unchanged: 0, ignored: 0 });
    expect(host.project.executeTransaction).toHaveBeenCalledTimes(1);
    expect(host.collection.createAddMarkerAction).toHaveBeenCalledWith(desired.name, "Comment", { seconds: 2 }, { seconds: 0 }, expect.stringContaining("plane-freeframe-review"));
    expect(host.actions.map(action => action.kind)).toEqual(["add"]);
  });

  it("updates a moved/resolved marker and removes stale duplicates in the same transaction", async () => {
    const current = marker({
      getStart: vi.fn(() => ({ seconds: 8 })),
      getName: vi.fn(() => "MEDIA-1 · v1 · Open"),
      getComments: vi.fn(() => `${serializeIdentity(desired.identity)}\nOld`),
    });
    const duplicate = marker();
    const host = runtime([current, duplicate]);
    const adapter = new PremiereMarkerAdapter(() => host.api);
    const resolved = { ...desired, name: "MEDIA-1 · v1 · Resolved", comment: "Reviewer: Editor\nReview status: Resolved" };
    const result = await adapter.reconcile(projectGuid, sequenceId, [resolved], scope, "Sync review markers");
    expect(result).toMatchObject({ created: 0, updated: 1, removed: 1 });
    expect(host.project.executeTransaction).toHaveBeenCalledTimes(1);
    expect(host.collection.createMoveMarkerAction).toHaveBeenCalled();
    expect(current.createSetNameAction).toHaveBeenCalledWith(resolved.name);
    expect(current.createSetCommentsAction).toHaveBeenCalledWith(expect.stringContaining("Review status: Resolved"));
    expect(host.collection.createRemoveMarkerAction).toHaveBeenCalledWith(duplicate);
  });

  it("fails closed when the active sequence does not match", async () => {
    const host = runtime();
    const adapter = new PremiereMarkerAdapter(() => host.api);
    await expect(adapter.reconcile(projectGuid, "other-sequence", [desired], scope, "Sync review markers")).rejects.toThrow("active Premiere sequence changed");
    expect(host.project.executeTransaction).not.toHaveBeenCalled();
  });
});
