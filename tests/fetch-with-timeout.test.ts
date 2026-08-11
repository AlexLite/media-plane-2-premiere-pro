import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout, NetworkTimeoutError } from "../src/fetch-with-timeout";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fetchWithTimeout", () => {
  it("aborts a stalled request at its deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));
    const request = fetchWithTimeout("https://example.test", {}, 50);
    const rejection = expect(request).rejects.toBeInstanceOf(NetworkTimeoutError);
    await vi.advanceTimersByTimeAsync(50);
    await rejection;
  });

  it("preserves caller cancellation without reporting a timeout", async () => {
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));
    const controller = new AbortController();
    const request = fetchWithTimeout("https://example.test", { signal: controller.signal }, 1_000);
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });
});
