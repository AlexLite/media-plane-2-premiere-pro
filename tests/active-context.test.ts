import { describe, expect, it } from "vitest";
import { activeContextKey } from "../src/active-context";

describe("active Premiere context identity", () => {
  it("distinguishes project, sequence, and empty host states", () => {
    expect(activeContextKey({ status: "no-project" })).toBe("no-project");
    expect(activeContextKey({ status: "no-sequence", projectGuid: "project-a" })).toBe("project:project-a:no-sequence");
    expect(activeContextKey({ status: "ready", sequence: { projectGuid: "project-a", id: "sequence-a", name: "A" } })).toBe("project:project-a:sequence:sequence-a");
    expect(activeContextKey({ status: "ready", sequence: { projectGuid: "project-a", id: "sequence-b", name: "B" } })).toBe("project:project-a:sequence:sequence-b");
  });
});
