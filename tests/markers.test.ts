import { describe, expect, it } from "vitest";
import { readIdentity, reconcileMarkers, serializeIdentity } from "../src/markers";
describe("marker identity", () => {
  it("round trips the private identity", () => { const value = { plugin: "plane-timecode-review" as const, commentId: "c1", timecode: "00:01:23" }; expect(readIdentity(serializeIdentity(value))).toEqual(value); });
  it("reconciliation is idempotent and does not touch unrelated markers", async () => {
    const markers = [{ id: "other", startSeconds: 2, name: "Other", comments: "editor marker" }]; let created = 0;
    const gateway = { list: async () => markers, create: async (m: any) => { created++; markers.push({ id: `p${created}`, ...m }); }, remove: async (id: string) => { const i = markers.findIndex(m => m.id === id); if (i >= 0) markers.splice(i, 1); } };
    const desired = [{ identity: { plugin: "plane-timecode-review" as const, commentId: "c", timecode: "00:00:04" }, startSeconds: 4, name: "ABC-1 00:00:04", comment: "a" }];
    await reconcileMarkers(gateway, desired); await reconcileMarkers(gateway, desired);
    expect(created).toBe(1); expect(markers).toHaveLength(2); expect(markers[0].id).toBe("other");
  });
});
