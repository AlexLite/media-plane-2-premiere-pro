import { describe, expect, it, vi } from "vitest";
import { PlaneClient } from "../src/plane-client";
describe("Plane comment fallback", () => {
  it("parses legacy HTML only when computed timecodes are absent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [{ id: "c1", comment_html: '<span data-plane-timecode="00:00:05">5</span>' }] }));
    const comments = await new PlaneClient("https://plane.test", "token").getComments("ws", "project", "issue");
    expect(comments[0].timecodes).toEqual([{ value: "00:00:05", seconds: 5 }]);
  });
});
