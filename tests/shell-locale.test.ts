import { describe, expect, it } from "vitest";
import { shellLocaleKeys, shellLocaleName, st } from "../src/shell-locale";

describe("shell locale", () => {
  it("keeps EN and RU keys in parity", () => expect(shellLocaleKeys("en")).toEqual(shellLocaleKeys("ru")));
  it("selects Russian only for Russian host locales", () => {
    expect(shellLocaleName("ru-RU")).toBe("ru");
    expect(shellLocaleName("en-US")).toBe("en");
  });
  it("returns localized shell labels", () => {
    expect(st("navDiagnostics", "en")).toBe("Diagnostics");
    expect(st("navDiagnostics", "ru")).toBe("Диагностика");
  });
});
