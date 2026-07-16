import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("localized panel text", () => {
  it("does not embed visible alphabetic UI text directly in main.ts templates", () => {
    const source = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    const directText = [...source.matchAll(/<(?:h1|h2|p|label|button|option|strong|span)[^>]*>\s*([A-Za-zА-Яа-я][^<]*)</g)].map(match => match[1]);
    const textualAttributes = [...source.matchAll(/<(?:input|select|button)[^>]*(?:placeholder|title|aria-label)="([^"]*[A-Za-zА-Яа-я][^"]*)"/g)].map(match => match[1]);
    expect({ directText, textualAttributes }).toEqual({ directText: [], textualAttributes: [] });
  });
});
