import { describe, expect, it, vi } from "vitest";
import { PremiereAdapter } from "../src/premiere";

const guid = (value: string) => ({ toString: () => value });
function runtime(playerSeconds = 12.5, endSeconds = 60) {
  const sequence = {
    guid: guid("sequence-guid"),
    name: "Cut 01",
    getPlayerPosition: vi.fn().mockResolvedValue({ seconds: playerSeconds }),
    getEndTime: vi.fn().mockResolvedValue({ seconds: endSeconds }),
  };
  const project = { guid: guid("project-guid"), getActiveSequence: vi.fn().mockResolvedValue(sequence) };
  return { adapter: new PremiereAdapter(() => ({ Project: { getActiveProject: vi.fn().mockResolvedValue(project) } })), sequence };
}

describe("Premiere playhead boundary", () => {
  it("returns documented TickTime seconds and sequence end time", async () => {
    const { adapter } = runtime();
    await expect(adapter.context()).resolves.toEqual({ status: "ready", sequence: { projectGuid: "project-guid", id: "sequence-guid", name: "Cut 01", durationSeconds: 60 } });
    await expect(adapter.playhead("project-guid", "sequence-guid")).resolves.toEqual({ seconds: 12.5, sequenceDurationSeconds: 60 });
  });

  it("fails closed when the active project or sequence changes", async () => {
    const { adapter } = runtime();
    await expect(adapter.playhead("other-project", "sequence-guid")).rejects.toThrow("project changed");
    await expect(adapter.playhead("project-guid", "other-sequence")).rejects.toThrow("sequence changed");
  });

  it("rejects invalid playhead values", async () => {
    const { adapter } = runtime(Number.NaN);
    await expect(adapter.playhead("project-guid", "sequence-guid")).rejects.toThrow("invalid playhead");
  });
});
