export function staleOperationError(): DOMException { return new DOMException("Operation superseded by a newer context", "AbortError"); }

/** Prevents late async results from overwriting state for a newer host context. */
export class OperationGeneration {
  private value = 0;
  begin(): number { return ++this.value; }
  invalidate(): void { this.value += 1; }
  current(token: number): boolean { return token === this.value; }
  assertCurrent(token: number): void { if (!this.current(token)) throw staleOperationError(); }
}
