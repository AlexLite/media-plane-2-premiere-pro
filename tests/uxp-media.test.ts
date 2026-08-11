import { describe, expect, it, vi } from "vitest";
import { mediaMimeType, UxpMediaFiles } from "../src/uxp-media";

function uxpRuntime(entry: any, savedEntry: any = entry) {
  return () => ({ storage: { localFileSystem: { getFileForOpening: async () => entry, getFileForSaving: async () => savedEntry } } });
}
function fsRuntime(bytes: Uint8Array, maxRead = Number.POSITIVE_INFINITY) {
  const open = vi.fn(async () => 7);
  const close = vi.fn(async () => 0);
  const read = vi.fn(async (_fd: number, buffer: ArrayBuffer, offset: number, length: number, position: number) => {
    const count = Math.min(length, maxRead, Math.max(0, bytes.length - position));
    new Uint8Array(buffer, offset, count).set(bytes.slice(position, position + count));
    return { bytesRead: count, buffer };
  });
  return { runtime: () => ({ open, read, close }), open, read, close };
}

describe("UXP media file boundary", () => {
  it("selects supported media and reads only requested multipart ranges", async () => {
    const entry = { isFile: true, name: "cut.mp4", nativePath: "/private/cut.mp4", getMetadata: async () => ({ size: 6 }) };
    const fs = fsRuntime(new Uint8Array([1, 2, 3, 4, 5, 6]), 1);
    const file = await new UxpMediaFiles(uxpRuntime(entry), fs.runtime).selectExported();
    expect(file?.name).toBe("cut.mp4");
    expect(file?.type).toBe("video/mp4");
    expect(file?.source).toBe("selected");
    const part = await file?.slice(2, 5);
    expect([...new Uint8Array(await part!.arrayBuffer())]).toEqual([3, 4, 5]);
    expect(fs.open).toHaveBeenCalledWith("/private/cut.mp4", "r");
    expect(fs.read).toHaveBeenCalledTimes(3);
    expect(fs.close).toHaveBeenCalledWith(7);
  });

  it("cancels a local chunk read before opening the file", async () => {
    const entry = { isFile: true, name: "cut.mp4", nativePath: "/private/cut.mp4", getMetadata: async () => ({ size: 6 }) };
    const fs = fsRuntime(new Uint8Array([1, 2, 3, 4, 5, 6]));
    const file = await new UxpMediaFiles(uxpRuntime(entry), fs.runtime).selectExported();
    const controller = new AbortController();
    controller.abort();
    await expect(file!.slice(0, 3, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fs.open).not.toHaveBeenCalled();
  });

  it("returns undefined when the picker is cancelled", async () => {
    await expect(new UxpMediaFiles(uxpRuntime(null), fsRuntime(new Uint8Array()).runtime).selectExported()).resolves.toBeUndefined();
  });

  it("selects a Premiere preset and a validated output destination", async () => {
    const preset = { isFile: true, name: "H264.epr", nativePath: "/private/H264.epr" };
    const output = { isFile: true, name: "cut.mp4", nativePath: "/private/cut.mp4" };
    const media = new UxpMediaFiles(uxpRuntime(preset, output), fsRuntime(new Uint8Array()).runtime);
    await expect(media.selectPreset()).resolves.toBe(preset);
    await expect(media.selectOutput("cut.mp4", ".mp4")).resolves.toBe(output);
  });

  it("rejects unsupported extensions, invalid metadata, and truncated ranges", async () => {
    expect(() => mediaMimeType("cut.mxf")).toThrow("Unsupported");
    const invalid = { isFile: true, name: "cut.mov", nativePath: "/private/cut.mov", getMetadata: async () => ({ size: 0 }) };
    await expect(new UxpMediaFiles(uxpRuntime(invalid), fsRuntime(new Uint8Array()).runtime).selectExported()).rejects.toThrow("empty or invalid");

    const entry = { isFile: true, name: "cut.mkv", nativePath: "/private/cut.mkv", getMetadata: async () => ({ size: 4 }) };
    const file = await new UxpMediaFiles(uxpRuntime(entry), fsRuntime(new Uint8Array([1, 2])).runtime).selectExported();
    await expect(file!.slice(0, 4)).rejects.toThrow("incomplete media data");
  });
});
