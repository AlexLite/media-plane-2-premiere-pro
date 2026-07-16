import { describe, expect, it, vi } from "vitest";
import { PremiereDirectExporter } from "../src/premiere-export";

const guid = (value: string) => ({ toString: () => value });
const binary = Symbol("binary");

function fixtures(exportExtension = "mp4") {
  const sequence = { guid: guid("sequence-guid"), name: "Cut 01" };
  const project = { guid: guid("project-guid"), getActiveSequence: vi.fn().mockResolvedValue(sequence) };
  const preset = { isFile: true, name: "Review.epr", nativePath: "/private/Review.epr" };
  let metadataCalls = 0;
  const output = {
    isFile: true,
    name: "Cut 01.mp4",
    nativePath: "/private/Cut 01.mp4",
    getMetadata: vi.fn(async () => ({ size: ++metadataCalls < 2 ? 4 : 4 })),
    read: vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer),
  };
  const manager = { isAMEInstalled: true, exportSequence: vi.fn().mockResolvedValue(true) };
  const premiere = () => ({
    Project: { getActiveProject: vi.fn().mockResolvedValue(project) },
    EncoderManager: { getManager: () => manager, getExportFileExtension: vi.fn().mockResolvedValue(exportExtension) },
    Constants: { ExportType: { IMMEDIATELY: 1 } },
  });
  const uxp = () => ({ storage: { formats: { binary }, localFileSystem: { getFileForOpening: vi.fn().mockResolvedValue(preset), getFileForSaving: vi.fn().mockResolvedValue(output) } } });
  return { premiere, uxp, manager, output };
}

describe("Premiere direct export adapter", () => {
  it("uses an explicit preset and output path with the official export call", async () => {
    const { premiere, uxp, manager } = fixtures();
    const adapter = new PremiereDirectExporter(premiere, uxp);
    const prepared = await adapter.prepare("project-guid", "sequence-guid", "Cut 01");
    expect(prepared?.presetName).toBe("Review.epr");
    expect(prepared?.outputName).toBe("Cut 01.mp4");
    const file = await adapter.export(prepared!, { maxOutputChecks: 2, outputCheckDelayMs: 0, sleep: async () => undefined });
    expect(file.name).toBe("Cut 01.mp4");
    expect(file.source).toBe("exported");
    expect(manager.exportSequence).toHaveBeenCalledWith(expect.anything(), 1, "/private/Cut 01.mp4", "/private/Review.epr", true);
  });

  it("fails closed if the active sequence changed", async () => {
    const { premiere, uxp } = fixtures();
    await expect(new PremiereDirectExporter(premiere, uxp).prepare("project-guid", "other-sequence", "Cut")).rejects.toThrow("sequence changed");
  });

  it("rejects export presets whose output type is unsupported by FreeFrame", async () => {
    const { premiere, uxp, manager } = fixtures("mxf");
    await expect(new PremiereDirectExporter(premiere, uxp).prepare("project-guid", "sequence-guid", "Cut")).rejects.toThrow("Unsupported media file type");
    expect(manager.exportSequence).not.toHaveBeenCalled();
  });
});
