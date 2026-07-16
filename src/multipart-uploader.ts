import { FreeFrameClient } from "./freeframe-client";

export interface UploadFile { name: string; type: string; size: number; slice(start: number, end: number): Blob }
interface Initiation { upload_id: string; s3_key: string; asset_id: string; version_id: string }
interface Presign { presigned_url: string; part_number: number }
export interface UploadResult { asset_id: string; version_id: string; status: string }

export class MultipartUploader {
  constructor(private readonly client: FreeFrameClient, readonly chunkSize = 10 * 1024 * 1024) {}
  async upload(assetId: string, file: UploadFile, options: { signal?: AbortSignal; onProgress?: (value: number) => void } = {}): Promise<UploadResult> {
    if (!file.name || file.size <= 0) throw new Error("Invalid upload file");
    const root = `/integrations/plane/assets/${encodeURIComponent(assetId)}`;
    let initiation: Initiation | undefined;
    try {
      initiation = await this.client.requestJson<Initiation>(`${root}/versions`, { asset_id: assetId, original_filename: file.name, mime_type: file.type, file_size_bytes: file.size }, options.signal);
      if (initiation.asset_id !== assetId || !initiation.version_id) throw new Error("Unexpected upload context");
      const total = Math.ceil(file.size / this.chunkSize); const parts: Array<{ PartNumber: number; ETag: string }> = [];
      for (let part = 1; part <= total; part++) {
        if (options.signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
        const presign = await this.client.requestJson<Presign>(`${root}/versions/${encodeURIComponent(initiation.version_id)}/upload/presign-part`, { s3_key: initiation.s3_key, upload_id: initiation.upload_id, part_number: part }, options.signal);
        if (presign.part_number !== part) throw new Error("Unexpected multipart order");
        const response = await fetch(presign.presigned_url, { method: "PUT", body: file.slice((part - 1) * this.chunkSize, Math.min(part * this.chunkSize, file.size)), signal: options.signal });
        const etag = response.headers.get("ETag")?.trim();
        if (!response.ok || !etag) throw new Error(`Upload part ${part} failed`);
        parts.push({ PartNumber: part, ETag: etag }); options.onProgress?.(part / total);
      }
      return await this.client.requestJson(`${root}/versions/${encodeURIComponent(initiation.version_id)}/upload/complete`, { s3_key: initiation.s3_key, upload_id: initiation.upload_id, asset_id: assetId, version_id: initiation.version_id, parts }, options.signal);
    } catch (error) {
      if (initiation) await this.client.requestJson(`${root}/versions/${encodeURIComponent(initiation.version_id)}/upload/abort`, { s3_key: initiation.s3_key, upload_id: initiation.upload_id, version_id: initiation.version_id }).catch(() => undefined);
      throw error;
    }
  }
}
