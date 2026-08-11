import { describe, expect, it } from "vitest";
import { frameToSeconds, secondsToFrame } from "../src/timing";
describe("rational timing", () => {
  it("round trips NTSC frame positions", () => { const fps = { numerator: 30000, denominator: 1001 }; expect(secondsToFrame(frameToSeconds(1842, fps), fps)).toBe(1842); });
  it("rejects invalid frame rates", () => expect(() => frameToSeconds(1, { numerator: 25, denominator: 0 })).toThrow());
});
