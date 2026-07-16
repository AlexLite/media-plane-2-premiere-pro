import type { ReviewStream, ReviewVersion } from "./domain";
import { FreeFrameClient, type ExpectedReviewContext } from "./freeframe-client";
import { MultipartUploader, type UploadFile } from "./multipart-uploader";
import { waitForReadyVersion, type ProcessingPollOptions } from "./processing-poller";

export type TransferStage = "idle" | "exporting" | "uploading" | "processing" | "ready" | "failed" | "cancelled";
export interface TransferSnapshot {
  stage: TransferStage;
  progress: number;
  versionId?: string;
  processingStatus?: string;
}
export interface TransferResult { version: ReviewVersion; stream: ReviewStream }
export interface UploadControllerOptions {
  onChange?: (snapshot: TransferSnapshot) => void;
  poll?: Omit<ProcessingPollOptions, "signal" | "onStatus" | "validateContext">;
  validateContext?: () => void | Promise<void>;
}

function abortError(): DOMException { return new DOMException("Transfer cancelled", "AbortError"); }
function isAbort(error: unknown): boolean { return error instanceof DOMException && error.name === "AbortError"; }

export class ReviewUploadController {
  private active?: AbortController;
  private snapshot: TransferSnapshot = { stage: "idle", progress: 0 };
  constructor(private readonly client: FreeFrameClient, private readonly uploader = new MultipartUploader(client)) {}
  current(): TransferSnapshot { return { ...this.snapshot }; }
  cancel(): void { this.active?.abort(); }

  private update(value: TransferSnapshot, callback?: (snapshot: TransferSnapshot) => void): void {
    this.snapshot = value;
    callback?.({ ...value });
  }

  async run(
    assetId: string,
    expected: ExpectedReviewContext,
    source: UploadFile | ((signal: AbortSignal) => Promise<UploadFile>),
    options: UploadControllerOptions = {},
  ): Promise<TransferResult> {
    if (this.active) throw new Error("A transfer is already running");
    const controller = new AbortController();
    this.active = controller;
    try {
      await options.validateContext?.();
      let file: UploadFile;
      if (typeof source === "function") {
        this.update({ stage: "exporting", progress: 0 }, options.onChange);
        file = await source(controller.signal);
        if (controller.signal.aborted) throw abortError();
        await options.validateContext?.();
      } else file = source;

      this.update({ stage: "uploading", progress: 0 }, options.onChange);
      const uploaded = await this.uploader.upload(assetId, file, {
        signal: controller.signal,
        onProgress: progress => this.update({ stage: "uploading", progress }, options.onChange),
        validateContext: options.validateContext,
      });
      this.update({ stage: "processing", progress: 1, versionId: uploaded.version_id, processingStatus: uploaded.status }, options.onChange);
      const ready = await waitForReadyVersion(this.client, assetId, uploaded.version_id, expected, {
        ...options.poll,
        signal: controller.signal,
        onStatus: status => this.update({ stage: "processing", progress: 1, versionId: uploaded.version_id, processingStatus: status }, options.onChange),
        validateContext: options.validateContext,
      });
      this.update({ stage: "ready", progress: 1, versionId: ready.version.id, processingStatus: "ready" }, options.onChange);
      return ready;
    } catch (error) {
      this.update({ stage: isAbort(error) || controller.signal.aborted ? "cancelled" : "failed", progress: this.snapshot.progress, versionId: this.snapshot.versionId, processingStatus: this.snapshot.processingStatus }, options.onChange);
      throw error;
    } finally { this.active = undefined; }
  }
}
