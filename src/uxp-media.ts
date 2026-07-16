import type { UploadFile } from "./multipart-uploader";

declare const require: (name: string) => any;

interface UxpFileEntry {
  isFile?: boolean;
  name: string;
  nativePath: string;
  getMetadata(): Promise<{ size: number; isFile?: boolean }>;
}
interface UxpFs {
  open(path: string, flag?: string): Promise<number>;
  read(fd: number, buffer: ArrayBuffer, offset: number, length: number, position: number): Promise<{ bytesRead: number; buffer: ArrayBuffer }>;
  close(fd: number): Promise<number>;
}

export interface SelectedMediaFile extends UploadFile {
  readonly source: "selected" | "exported";
}

const MIME_BY_EXTENSION: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  webm: "video/webm",
  mpeg: "video/mpeg",
  mpg: "video/mpeg",
  wmv: "video/x-ms-wmv",
};

function extension(name: string): string { return name.split(".").pop()?.toLowerCase() ?? ""; }
function abortError(): DOMException { return new DOMException("Operation cancelled", "AbortError"); }

export function mediaMimeType(name: string): string {
  const mime = MIME_BY_EXTENSION[extension(name)];
  if (!mime) throw new Error("Unsupported media file type");
  return mime;
}

class NativeMediaFile implements SelectedMediaFile {
  readonly type: string;
  constructor(
    readonly name: string,
    readonly source: "selected" | "exported",
    readonly size: number,
    private readonly nativePath: string,
    private readonly fs: UxpFs,
  ) { this.type = mediaMimeType(name); }

  async slice(start: number, end: number, signal?: AbortSignal): Promise<Blob> {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > this.size) {
      throw new Error("Invalid media read range");
    }
    if (signal?.aborted) throw abortError();
    const length = end - start;
    const buffer = new ArrayBuffer(length);
    let fd: number | undefined;
    let total = 0;
    try {
      fd = await this.fs.open(this.nativePath, "r");
      while (total < length) {
        if (signal?.aborted) throw abortError();
        const result = await this.fs.read(fd, buffer, total, length - total, start + total);
        if (!result || !Number.isInteger(result.bytesRead) || result.bytesRead <= 0 || result.bytesRead > length - total) break;
        total += result.bytesRead;
        if (signal?.aborted) throw abortError();
      }
    } finally {
      if (fd !== undefined) await this.fs.close(fd);
    }
    if (total !== length) throw new Error("UXP returned incomplete media data");
    return new Blob([buffer], { type: this.type });
  }
}

export class UxpMediaFiles {
  constructor(
    private readonly runtime: () => any = () => require("uxp"),
    private readonly fsRuntime: () => UxpFs = () => require("fs") as UxpFs,
  ) {}

  private storage(): any {
    const localFileSystem = this.runtime().storage?.localFileSystem;
    if (!localFileSystem) throw new Error("UXP local file access is unavailable");
    return localFileSystem;
  }

  async selectExported(signal?: AbortSignal): Promise<SelectedMediaFile | undefined> {
    if (signal?.aborted) throw abortError();
    const entry = await this.storage().getFileForOpening({ allowMultiple: false, types: ["mp4", "mov", "avi", "mkv", "webm", "mpeg", "mpg", "wmv"] }) as UxpFileEntry | null;
    if (!entry) return undefined;
    return this.read(entry, "selected", signal);
  }

  async read(entry: UxpFileEntry, source: "selected" | "exported", signal?: AbortSignal): Promise<SelectedMediaFile> {
    if (!entry?.isFile || !entry.name || !entry.nativePath) throw new Error("UXP did not return a media file");
    mediaMimeType(entry.name);
    if (signal?.aborted) throw abortError();
    const metadata = await entry.getMetadata();
    if (!Number.isInteger(metadata.size) || metadata.size <= 0) throw new Error("Selected media file is empty or invalid");
    if (signal?.aborted) throw abortError();
    return new NativeMediaFile(entry.name, source, metadata.size, entry.nativePath, this.fsRuntime());
  }
}
