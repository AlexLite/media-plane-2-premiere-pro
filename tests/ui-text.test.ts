import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("localized panel text", () => {
  it("does not embed visible alphabetic UI text directly in panel templates", () => {
    const sources = ["shell.ts", "main.ts", "review-panel.ts", "diagnostics-panel.ts"].map(file => readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8")).join("\n");
    const directText = [...sources.matchAll(/<(?:h1|h2|h3|p|label|button|option|strong|span)[^>]*>\s*([A-Za-zА-Яа-я][^<]*)</g)].map(match => match[1]);
    const textualAttributes = [...sources.matchAll(/<(?:input|select|button|textarea)[^>]*(?:placeholder|title|aria-label)="([^"]*[A-Za-zА-Яа-я][^"]*)"/g)].map(match => match[1]);
    expect({ directText, textualAttributes }).toEqual({ directText: [], textualAttributes: [] });
  });
});
