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

it("cancels an active upload and attempts best-effort abort", async () => {
  const controller = new AbortController();
  const requestJson = vi.fn()
    .mockResolvedValueOnce({ upload_id: "u", s3_key: "k", asset_id: "a", version_id: "v" })
    .mockResolvedValueOnce({ presigned_url: "https://storage.test/1", part_number: 1 })
    .mockResolvedValueOnce(undefined);
  vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
  })));
  const upload = new MultipartUploader({ requestJson } as any, 3).upload("a", file, { signal: controller.signal });
  await vi.waitFor(() => expect(requestJson).toHaveBeenCalledTimes(2));
  controller.abort();
  await expect(upload).rejects.toMatchObject({ name: "AbortError" });
  expect(requestJson.mock.calls[requestJson.mock.calls.length - 1][0]).toContain("/upload/abort");
});

it("rejects insecure presigned upload URLs before sending media", async () => {
  const requestJson = vi.fn()
    .mockResolvedValueOnce({ upload_id: "u", s3_key: "k", asset_id: "a", version_id: "v" })
    .mockResolvedValueOnce({ presigned_url: "http://storage.test/1", part_number: 1 })
    .mockResolvedValueOnce(undefined);
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await expect(new MultipartUploader({ requestJson } as any, 3).upload("a", file)).rejects.toThrow("must use HTTPS");
  expect(fetchMock).not.toHaveBeenCalled();
});


it("aborts the initiated multipart upload when the Premiere context changes", async () => {
  const requestJson = vi.fn()
    .mockResolvedValueOnce({ upload_id: "u", s3_key: "k", asset_id: "a", version_id: "v" })
    .mockResolvedValueOnce(undefined);
  const validateContext = vi.fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("Active sequence changed"));
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await expect(new MultipartUploader({ requestJson } as any, 3).upload("a", file, { validateContext })).rejects.toThrow("Active sequence changed");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(requestJson).toHaveBeenCalledTimes(2);
  expect(requestJson.mock.calls[1][0]).toContain("/upload/abort");
});
