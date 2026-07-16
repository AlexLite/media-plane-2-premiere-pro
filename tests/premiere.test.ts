import { describe, expect, it, vi } from "vitest";
import { PremiereAdapter } from "../src/premiere";

const guid = (value: string) => ({ toString: () => value });

describe("Premiere project and sequence context", () => {
  it("distinguishes no-project and no-sequence states", async () => {
    const noProject = new PremiereAdapter(() => ({ Project: { getActiveProject: vi.fn().mockResolvedValue(undefined) } }));
    await expect(noProject.context()).resolves.toEqual({ status: "no-project" });

    const noSequence = new PremiereAdapter(() => ({ Project: { getActiveProject: vi.fn().mockResolvedValue({ guid: guid("project-guid"), getActiveSequence: vi.fn().mockResolvedValue(undefined) }) } }));
    await expect(noSequence.context()).resolves.toEqual({ status: "no-sequence", projectGuid: "project-guid" });
  });

  it("returns stable project and sequence GUIDs for binding", async () => {
    const adapter = new PremiereAdapter(() => ({ Project: { getActiveProject: vi.fn().mockResolvedValue({ guid: guid("project-guid"), getActiveSequence: vi.fn().mockResolvedValue({ guid: guid("sequence-guid"), name: "Cut 01" }) }) } }));
    await expect(adapter.context()).resolves.toEqual({ status: "ready", sequence: { projectGuid: "project-guid", id: "sequence-guid", name: "Cut 01" } });
  });
});
