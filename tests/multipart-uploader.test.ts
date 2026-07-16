import { describe, expect, it, vi } from "vitest";
import { MultipartUploader } from "../src/multipart-uploader";

const file = { name: "cut.mp4", type: "video/mp4", size: 6, slice: (start: number, end: number) => new Blob(["x".repeat(end - start)]) };
describe("multipart uploader", () => {
  it("preserves part order and ETags", async () => {
    const requestJson = vi.fn()
      .mockResolvedValueOnce({ upload_id: "u", s3_key: "k", asset_id: "a", version_id: "v" })
      .mockResolvedValueOnce({ presigned_url: "https://storage.test/1", part_number: 1 })
      .mockResolvedValueOnce({ presigned_url: "https://storage.test/2", part_number: 2 })
      .mockResolvedValueOnce({ asset_id: "a", version_id: "v", status: "processing" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, headers: new Headers({ ETag: "etag-1" }) }).mockResolvedValueOnce({ ok: true, headers: new Headers({ ETag: "etag-2" }) }));
    await new MultipartUploader({ requestJson } as any, 3).upload("a", file);
    expect(requestJson.mock.calls[3][1].parts).toEqual([{ PartNumber: 1, ETag: "etag-1" }, { PartNumber: 2, ETag: "etag-2" }]);
  });
  it("attempts abort after an upload failure", async () => {
    const requestJson = vi.fn()
      .mockResolvedValueOnce({ upload_id: "u", s3_key: "k", asset_id: "a", version_id: "v" })
      .mockResolvedValueOnce({ presigned_url: "https://storage.test/1", part_number: 1 })
      .mockResolvedValueOnce(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, headers: new Headers() }));
    await expect(new MultipartUploader({ requestJson } as any, 3).upload("a", file)).rejects.toThrow("Upload part 1 failed");
    expect(requestJson.mock.calls[requestJson.mock.calls.length - 1][0]).toContain("/upload/abort");
  });
});
