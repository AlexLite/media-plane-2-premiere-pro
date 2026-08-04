import { describe, expect, it } from "vitest";
import { OperationGeneration } from "../src/operation-generation";

describe("operation generation", () => {
  it("rejects a late result after a newer operation begins", () => {
    const guard = new OperationGeneration();
    const old = guard.begin();
    const current = guard.begin();
    expect(() => guard.assertCurrent(old)).toThrowError(expect.objectContaining({ name: "AbortError" }));
    expect(() => guard.assertCurrent(current)).not.toThrow();
  });
});
