import { describe, expect, it, vi } from "vitest";
import { ReviewUploadController } from "../src/upload-controller";

const file = { name: "cut.mp4", type: "video/mp4", size: 3, slice: () => new Blob(["abc"]) };
const bootstrap = (status: string) => ({
  context: { workspace_id: "w", project_id: "p", issue_id: "i" },
  asset: { id: "a", name: "A", asset_type: "video" },
  versions: [{ id: "v", version_number: 1, processing_status: status, created_at: null }],
  permissions: { read: true, comment: true, upload: true, manage: false },
});

describe("review upload controller", () => {
  it("reports exporting, uploading, processing, and ready separately", async () => {
    const uploader = { upload: vi.fn(async (_asset: string, _file: unknown, options: any) => { options.onProgress(0.5); options.onProgress(1); return { asset_id: "a", version_id: "v", status: "processing" }; }) };
    const client = { bootstrap: vi.fn().mockResolvedValueOnce(bootstrap("processing")).mockResolvedValueOnce(bootstrap("ready")), stream: vi.fn().mockResolvedValue({ url: "/stream", asset_type: "video", expires_in: 300 }) };
    const stages: string[] = [];
    const validateContext = vi.fn().mockResolvedValue(undefined);
    const controller = new ReviewUploadController(client as any, uploader as any);
    const result = await controller.run("a", { projectId: "p", issueId: "i" }, async () => file, { onChange: state => stages.push(state.stage), poll: { maxAttempts: 2, delaysMs: [0], sleep: async () => undefined }, validateContext });
    expect(result.version.id).toBe("v");
    expect(stages).toContain("exporting");
    expect(stages).toContain("uploading");
    expect(stages).toContain("processing");
    expect(stages.at(-1)).toBe("ready");
    expect(validateContext).toHaveBeenCalled();
    expect(uploader.upload.mock.calls[0][2].validateContext).toBe(validateContext);
  });

  it("exposes cancelled as a terminal state", async () => {
    const uploader = { upload: vi.fn((_asset: string, _file: unknown, options: any) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true }))) };
    const controller = new ReviewUploadController({} as any, uploader as any);
    const run = controller.run("a", { projectId: "p", issueId: "i" }, file);
    await vi.waitFor(() => expect(uploader.upload).toHaveBeenCalledOnce());
    controller.cancel();
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(controller.current().stage).toBe("cancelled");
  });

  it("fails closed before upload when the active sequence changed after export", async () => {
    const uploader = { upload: vi.fn() };
    const validateContext = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Active sequence changed"));
    const controller = new ReviewUploadController({} as any, uploader as any);
    await expect(controller.run("a", { projectId: "p", issueId: "i" }, async () => file, { validateContext })).rejects.toThrow("Active sequence changed");
    expect(uploader.upload).not.toHaveBeenCalled();
    expect(controller.current().stage).toBe("failed");
  });
});
