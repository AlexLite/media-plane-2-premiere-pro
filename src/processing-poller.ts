import type { ReviewStream, ReviewVersion } from "./domain";
import { FreeFrameClient, FreeFrameError, type ExpectedReviewContext } from "./freeframe-client";

export interface ReadyReviewVersion { version: ReviewVersion; stream: ReviewStream }
export interface ProcessingPollOptions {
  signal?: AbortSignal;
  maxAttempts?: number;
  delaysMs?: readonly number[];
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  onStatus?: (status: string, attempt: number) => void;
  validateContext?: () => void | Promise<void>;
}

function abortError(): DOMException { return new DOMException("Processing polling cancelled", "AbortError"); }
function defaultSleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(abortError()); }, { once: true });
  });
}

export async function waitForReadyVersion(
  client: FreeFrameClient,
  assetId: string,
  versionId: string,
  expected: ExpectedReviewContext,
  options: ProcessingPollOptions = {},
): Promise<ReadyReviewVersion> {
  const maxAttempts = options.maxAttempts ?? 20;
  const delays = options.delaysMs ?? [1000, 1500, 2000, 3000, 5000];
  const sleep = options.sleep ?? defaultSleep;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || delays.length === 0 || delays.some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error("Invalid processing polling configuration");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options.signal?.aborted) throw abortError();
    await options.validateContext?.();
    const bootstrap = await client.bootstrap(assetId, expected, options.signal);
    const version = bootstrap.versions.find(item => item.id === versionId);
    if (!version) throw new Error("FreeFrame did not return the uploaded version");
    options.onStatus?.(version.processing_status, attempt);
    if (version.processing_status === "failed") throw new Error("FreeFrame processing failed");
    if (version.processing_status === "ready") {
      try {
        await options.validateContext?.();
        const stream = await client.stream(assetId, versionId, options.signal);
        return { version, stream };
      } catch (error) {
        if (!(error instanceof FreeFrameError) || error.status !== 409) throw error;
      }
    }
    if (attempt < maxAttempts) await sleep(delays[Math.min(attempt - 1, delays.length - 1)], options.signal);
  }
  throw new Error("FreeFrame processing did not reach ready state in time");
}
