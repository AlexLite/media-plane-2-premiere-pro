export class NetworkTimeoutError extends Error {
  readonly code = "network-timeout";
  constructor(readonly timeoutMs: number) {
    super(`Network request exceeded ${timeoutMs} ms`);
    this.name = "NetworkTimeoutError";
  }
}

/** Adds a finite deadline while preserving cancellation supplied by the caller. */
export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController();
  const external = init.signal;
  let timedOut = false;
  const cancel = (): void => controller.abort();
  if (external?.aborted) controller.abort();
  else external?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new NetworkTimeoutError(timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", cancel);
  }
}
