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
  deadlineMs?: number;
  now?: () => number;
}

export class ProcessingContinuesError extends Error {
  readonly code = "processing-continues";
  constructor() { super("FreeFrame processing continues after the local polling deadline"); }
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
  const maxAttempts = options.maxAttempts ?? Number.MAX_SAFE_INTEGER;
  const deadlineMs = options.deadlineMs ?? 15 * 60 * 1000;
  const now = options.now ?? Date.now;
  const startedAt = now();
  const delays = options.delaysMs ?? [1000, 1500, 2000, 3000, 5000];
  const sleep = options.sleep ?? defaultSleep;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || !Number.isFinite(deadlineMs) || deadlineMs <= 0 || delays.length === 0 || delays.some(value => !Number.isFinite(value) || value < 0)) {
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
    const delay = delays[Math.min(attempt - 1, delays.length - 1)];
    if (attempt >= maxAttempts || now() - startedAt + delay >= deadlineMs) break;
    await sleep(delay, options.signal);
  }
  throw new ProcessingContinuesError();
}
