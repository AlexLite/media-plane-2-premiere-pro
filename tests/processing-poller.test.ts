import { describe, expect, it, vi } from "vitest";
import { waitForReadyVersion } from "../src/processing-poller";

const expected = { projectId: "p", issueId: "i" };
const version = (status: string) => ({ id: "v", version_number: 1, processing_status: status, created_at: null });
const bootstrap = (status: string) => ({ context: { workspace_id: "w", project_id: "p", issue_id: "i" }, asset: { id: "a", name: "A", asset_type: "video" }, versions: [version(status)], permissions: { read: true, comment: true, upload: true, manage: false } });

describe("processing poller", () => {
  it("terminates only after ready and playback metadata are available", async () => {
    const client = {
      bootstrap: vi.fn().mockResolvedValueOnce(bootstrap("processing")).mockResolvedValueOnce(bootstrap("ready")),
      stream: vi.fn().mockResolvedValue({ url: "/stream/hls/master.m3u8?token=x", asset_type: "video", expires_in: 300 }),
    };
    const statuses: string[] = [];
    const result = await waitForReadyVersion(client as any, "a", "v", expected, { maxAttempts: 3, delaysMs: [0], sleep: async () => undefined, onStatus: status => statuses.push(status) });
    expect(result.version.processing_status).toBe("ready");
    expect(result.stream.asset_type).toBe("video");
    expect(statuses).toEqual(["processing", "ready"]);
  });

  it("stops on failed processing", async () => {
    const client = { bootstrap: vi.fn().mockResolvedValue(bootstrap("failed")), stream: vi.fn() };
    await expect(waitForReadyVersion(client as any, "a", "v", expected, { sleep: async () => undefined })).rejects.toThrow("processing failed");
    expect(client.stream).not.toHaveBeenCalled();
  });

  it("terminates after the bounded number of attempts", async () => {
    const client = { bootstrap: vi.fn().mockResolvedValue(bootstrap("processing")), stream: vi.fn() };
    await expect(waitForReadyVersion(client as any, "a", "v", expected, { maxAttempts: 2, delaysMs: [0], sleep: async () => undefined })).rejects.toMatchObject({ code: "processing-continues" });
    expect(client.bootstrap).toHaveBeenCalledTimes(2);
  });

  it("honors cancellation before another poll", async () => {
    const controller = new AbortController();
    const client = { bootstrap: vi.fn().mockResolvedValue(bootstrap("processing")), stream: vi.fn() };
    const wait = waitForReadyVersion(client as any, "a", "v", expected, {
      maxAttempts: 3,
      delaysMs: [0],
      sleep: async () => { controller.abort(); },
      signal: controller.signal,
    });
    await expect(wait).rejects.toMatchObject({ name: "AbortError" });
    expect(client.bootstrap).toHaveBeenCalledTimes(1);
  });

  it("stops polling when the active Premiere context changes", async () => {
    const client = { bootstrap: vi.fn().mockResolvedValue(bootstrap("processing")), stream: vi.fn() };
    const validateContext = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Active sequence changed"));
    await expect(waitForReadyVersion(client as any, "a", "v", expected, {
      maxAttempts: 3,
      delaysMs: [0],
      sleep: async () => undefined,
      validateContext,
    })).rejects.toThrow("Active sequence changed");
    expect(client.bootstrap).toHaveBeenCalledTimes(1);
    expect(client.stream).not.toHaveBeenCalled();
  });

});
