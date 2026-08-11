import { describe, expect, it, vi } from "vitest";
import { PremiereDirectExporter } from "../src/premiere-export";

describe("Premiere direct export boundary", () => {
  it("fails closed without invoking Premiere until completion events are verified", async () => {
    const exportSequence = vi.fn();
    const adapter = new PremiereDirectExporter(() => ({ EncoderManager: { getManager: () => ({ exportSequence }) } }));
    expect(adapter.supports()).toBe(false);
    await expect(adapter.prepare("project", "sequence", "Cut")).rejects.toThrow("disabled");
    await expect(adapter.export({ projectGuid: "project", sequenceId: "sequence", presetName: "", outputName: "", outputPath: "", extension: "mp4" })).rejects.toThrow("disabled");
    expect(exportSequence).not.toHaveBeenCalled();
  });
});
