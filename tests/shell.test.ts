import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeShellView } from "../src/shell-events";

describe("production panel shell", () => {
  it("normalizes persisted or requested views safely", () => {
    expect(normalizeShellView("review")).toBe("review");
    expect(normalizeShellView("media")).toBe("media");
    expect(normalizeShellView("diagnostics")).toBe("diagnostics");
    expect(normalizeShellView("unknown")).toBe("review");
    expect(normalizeShellView(null)).toBe("review");
  });

  it("contains one shell and three view surfaces", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    expect(html.match(/id="shell-app"/g)).toHaveLength(1);
    expect(html.match(/data-shell-view="review"/g)).toHaveLength(1);
    expect(html.match(/data-shell-view="media"/g)).toHaveLength(1);
    expect(html.match(/data-shell-view="diagnostics"/g)).toHaveLength(1);
    for (const bundle of ["shell.js", "main.js", "review-panel.js", "diagnostics-panel.js"]) expect(html).toContain(`dist/${bundle}`);
  });

  it("builds every internal entrypoint", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    for (const entry of ["src/shell.ts", "src/main.ts", "src/review-panel.ts", "src/diagnostics-panel.ts"]) expect(pkg.scripts.build).toContain(entry);
  });
});
