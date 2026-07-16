import { describe, expect, it } from "vitest";
import { readIdentity, reconcileMarkers, serializeIdentity } from "../src/markers";

const identity = { plugin: "plane-freeframe-review" as const, assetId: "a", versionId: "v", commentId: "c", frameNumber: 42 };
describe("FreeFrame marker identity", () => {
  it("round trips canonical identity", () => expect(readIdentity(serializeIdentity(identity))).toEqual(identity));
  it("is idempotent and preserves unrelated editor markers", async () => {
    const markers = [{ id: "editor", startSeconds: 2, name: "Editor", comments: "private note" }]; let created = 0;
    const gateway = { list: async () => markers, create: async (marker: any) => { created++; markers.push({ id: `plugin-${created}`, ...marker }); }, remove: async (id: string) => { const index = markers.findIndex(marker => marker.id === id); if (index >= 0) markers.splice(index, 1); } };
    const desired = [{ identity, startSeconds: 1.68, name: "MEDIA-1 · v1", comment: "review" }];
    await reconcileMarkers(gateway, desired); await reconcileMarkers(gateway, desired);
    expect(created).toBe(1); expect(markers[0].id).toBe("editor");
  });
});
