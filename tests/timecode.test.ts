import { describe, expect, it } from "vitest";
import { parseTimecode, timecodesFromHtml } from "../src/timecode";
describe("timecodes", () => {
  it("accepts MM:SS and HH:MM:SS in range", () => { expect(parseTimecode("01:23")).toBe(83); expect(parseTimecode("01:01:23")).toBe(3683); });
  it("rejects malformed or out of range values", () => { expect(parseTimecode("1:23")).toBeUndefined(); expect(parseTimecode("01:60")).toBeUndefined(); expect(parseTimecode("25:99:00")).toBeUndefined(); });
  it("uses only Plane timecode spans for fallback", () => { expect(timecodesFromHtml('<span data-plane-timecode="00:01:23">x</span><time>00:02:00</time>')).toEqual([{ value: "00:01:23", seconds: 83 }]); });
});
