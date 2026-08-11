import { describe, expect, it } from "vitest";
import { localeFromLanguage, resolveInterfaceLocale } from "../src/locale-preference";

describe("interface locale preference", () => {
  it("defaults from the host language", () => {
    expect(localeFromLanguage("ru-RU")).toBe("ru");
    expect(localeFromLanguage("en-US")).toBe("en");
  });

  it("prefers an explicit saved RU or EN selection", () => {
    expect(resolveInterfaceLocale("ru", "en-US")).toBe("ru");
    expect(resolveInterfaceLocale("en", "ru-RU")).toBe("en");
    expect(resolveInterfaceLocale("invalid", "ru-RU")).toBe("ru");
  });
});
