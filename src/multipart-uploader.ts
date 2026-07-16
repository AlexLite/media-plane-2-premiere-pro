import { FreeFrameClient } from "./freeframe-client";

export interface UploadFile { name: string; type: string; size: number; slice(start: number, end: number, signal?: AbortSignal): Blob | Promise<Blob> }
interface Initiation { upload_id: string; s3_key: string; asset_id: string; version_id: string }
interface Presign { presigned_url: string; part_number: number }
export interface UploadResult { asset_id: string; version_id: string; status: string }
export interface MultipartUploadOptions {
  signal?: AbortSignal;
  onProgress?: (value: number) => void;
  validateContext?: () => void | Promise<void>;
}

function record(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function abortError(): DOMException { return new DOMException("Upload cancelled", "AbortError"); }
function validatePresignedUrl(value: unknown): string {
  if (!nonEmpty(value)) throw new Error("Invalid presigned upload URL");
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("Invalid presigned upload URL"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("Presigned upload URL must use HTTPS");
  return value;
}

export class MultipartUploader {
  constructor(private readonly client: FreeFrameClient, readonly chunkSize = 10 * 1024 * 1024) {
    if (!Number.isInteger(chunkSize) || chunkSize <= 0) throw new Error("Invalid multipart chunk size");
  }
  async upload(assetId: string, file: UploadFile, options: MultipartUploadOptions = {}): Promise<UploadResult> {
    if (!assetId || !file.name || !file.type || !Number.isFinite(file.size) || file.size <= 0) throw new Error("Invalid upload file");
    const root = `/integrations/plane/assets/${encodeURIComponent(assetId)}`;
    let initiation: Initiation | undefined;
    try {
      if (options.signal?.aborted) throw abortError();
      await options.validateContext?.();
      const initiationValue = record(await this.client.requestJson<unknown>(`${root}/versions`, { asset_id: assetId, original_filename: file.name, mime_type: file.type, file_size_bytes: file.size }, options.signal));
      if (!initiationValue || initiationValue.asset_id !== assetId || !nonEmpty(initiationValue.upload_id) || !nonEmpty(initiationValue.s3_key) || !nonEmpty(initiationValue.version_id)) throw new Error("Unexpected upload context");
      initiation = { upload_id: initiationValue.upload_id, s3_key: initiationValue.s3_key, asset_id: assetId, version_id: initiationValue.version_id };
      const total = Math.ceil(file.size / this.chunkSize);
      if (total > 10000) throw new Error("Upload exceeds the multipart part limit");
      const parts: Array<{ PartNumber: number; ETag: string }> = [];
      for (let part = 1; part <= total; part++) {
        if (options.signal?.aborted) throw abortError();
        await options.validateContext?.();
        const presignValue = record(await this.client.requestJson<unknown>(`${root}/versions/${encodeURIComponent(initiation.version_id)}/upload/presign-part`, { s3_key: initiation.s3_key, upload_id: initiation.upload_id, part_number: part }, options.signal));
        if (!presignValue || presignValue.part_number !== part) throw new Error("Unexpected multipart order");
        const presignedUrl = validatePresignedUrl(presignValue.presigned_url);
        const body = await file.slice((part - 1) * this.chunkSize, Math.min(part * this.chunkSize, file.size), options.signal);
        if (options.signal?.aborted) throw abortError();
        await options.validateContext?.();
        const response = await fetch(presignedUrl, { method: "PUT", body, signal: options.signal });
        const etag = response.headers.get("ETag")?.trim();
        if (!response.ok || !etag) throw new Error(`Upload part ${part} failed`);
        parts.push({ PartNumber: part, ETag: etag });
        options.onProgress?.(part / total);
      }
      if (options.signal?.aborted) throw abortError();
      await options.validateContext?.();
      const completed = record(await this.client.requestJson<unknown>(`${root}/versions/${encodeURIComponent(initiation.version_id)}/upload/complete`, { s3_key: initiation.s3_key, upload_id: initiation.upload_id, asset_id: assetId, version_id: initiation.version_id, parts }, options.signal));
      if (!completed || completed.asset_id !== assetId || completed.version_id !== initiation.version_id || !nonEmpty(completed.status) || !["processing", "ready"].includes(completed.status)) {
        throw new Error("Unexpected upload completion response");
      }
      return { asset_id: assetId, version_id: initiation.version_id, status: completed.status };
    } catch (error) {
      if (initiation) await this.client.requestJson(`${root}/versions/${encodeURIComponent(initiation.version_id)}/upload/abort`, { s3_key: initiation.s3_key, upload_id: initiation.upload_id, version_id: initiation.version_id }).catch(() => undefined);
      throw error;
    }
  }
}
