import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeShellMode, normalizeShellView } from "../src/shell-events";

describe("production panel shell", () => {
  it("normalizes persisted or requested views safely", () => {
    expect(normalizeShellView("review")).toBe("review");
    expect(normalizeShellView("media")).toBe("media");
    expect(normalizeShellView("diagnostics")).toBe("diagnostics");
    expect(normalizeShellView("settings")).toBe("settings");
    expect(normalizeShellView("unknown")).toBe("review");
  });
  it("keeps Plane as the safe default mode", () => {
    expect(normalizeShellMode("plane")).toBe("plane");
    expect(normalizeShellMode("freeframe")).toBe("freeframe");
    expect(normalizeShellMode("unknown")).toBe("plane");
  });
  it("contains both modes and all view surfaces", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    for (const id of ["shell-app", "direct-freeframe-app", "user-config-app"]) expect(html.match(new RegExp(`id="${id}"`, "g"))).toHaveLength(1);
    for (const view of ["review", "media", "diagnostics", "settings"]) expect(html.match(new RegExp(`data-shell-view="${view}"`, "g"))).toHaveLength(1);
    for (const mode of ["plane", "freeframe"]) expect(html.match(new RegExp(`data-shell-mode-content="${mode}"`, "g"))).toHaveLength(1);
    for (const bundle of ["shell.js", "main.js", "review-panel.js", "diagnostics-panel.js", "direct-freeframe-panel.js", "user-config-panel.js"]) expect(html).toContain(`dist/${bundle}`);
  });
  it("builds every internal entrypoint", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    for (const entry of ["src/shell.ts", "src/main.ts", "src/review-panel.ts", "src/diagnostics-panel.ts", "src/direct-freeframe-panel.ts", "src/user-config-panel.ts"]) expect(pkg.scripts.build).toContain(entry);
  });
  it("uses only Premiere UXP-compatible layout primitives", () => {
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    expect(css).not.toMatch(/display\s*:\s*grid|grid-template|position\s*:\s*sticky/);
  });
});
