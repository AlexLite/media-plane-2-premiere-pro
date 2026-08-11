import { describe, expect, it } from "vitest";
import { capabilities } from "../src/permissions";
describe("server scopes", () => {
  it("does not infer manage from other scopes", () => expect(capabilities(["review:read", "review:comment", "review:upload"])).toEqual({ read: true, comment: true, upload: true, manage: false }));
});
