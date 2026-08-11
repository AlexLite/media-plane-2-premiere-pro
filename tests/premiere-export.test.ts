import { describe, expect, it, vi } from "vitest";
import { PremiereDirectExporter } from "../src/premiere-export";

function fixture(accepted = true) {
  const listeners = new Map<string, (event?: object) => void>();
  const output = { isFile: true, name: "cut.mp4", nativePath: "C:/cut.mp4", getMetadata: vi.fn().mockResolvedValue({ size: 10 }) };
  const preset = { isFile: true, name: "H264.epr", nativePath: "C:/H264.epr", getMetadata: vi.fn() };
  const encoder = { isAMEInstalled: true, exportSequence: vi.fn().mockResolvedValue(accepted) };
  const runtime = () => ({
    EncoderManager: {
      getManager: () => encoder,
      getExportFileExtension: vi.fn().mockResolvedValue("mp4"),
      EXPORT_IMMEDIATELY: "immediately",
      EVENT_RENDER_COMPLETE: "complete",
      EVENT_RENDER_ERROR: "error",
      EVENT_RENDER_CANCEL: "cancel",
      EVENT_RENDER_PROGRESS: "progress",
    },
    Constants: { ExportType: { IMMEDIATELY: "immediately" } },
    EventManager: {
      addEventListener: (_target: unknown, name: string, handler: (event?: object) => void) => listeners.set(name, handler),
      removeEventListener: (_target: unknown, name: string) => listeners.delete(name),
    },
  });
  return { adapter: new PremiereDirectExporter(runtime), output, preset, encoder, listeners };
}

describe("Premiere direct export boundary", () => {
  it("submits the active sequence and resolves only after the render event", async () => {
    const { adapter, output, preset, encoder, listeners } = fixture();
    expect(adapter.supports()).toBe(true);
    const prepared = await adapter.prepare("project", "sequence", {}, "Cut", preset, output);
    expect(prepared?.extension).toBe("mp4");
    const rendered = adapter.export(prepared!);
    await Promise.resolve();
    expect(encoder.exportSequence).toHaveBeenCalledWith({}, "immediately", "C:/cut.mp4", "C:/H264.epr", true);
    expect(listeners.has("complete")).toBe(true);
    listeners.get("complete")?.();
    await expect(rendered).resolves.toBe(output);
    expect(output.getMetadata).toHaveBeenCalled();
  });

  it("rejects when Premiere refuses the export request", async () => {
    const { adapter, output, preset } = fixture(false);
    const prepared = await adapter.prepare("project", "sequence", {}, "Cut", preset, output);
    await expect(adapter.export(prepared!)).rejects.toThrow("rejected");
  });
});
