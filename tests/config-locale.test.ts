import { describe, expect, it } from "vitest";
import { configLocaleKeys, ct } from "../src/config-locale";

describe("user config locale", () => {
  it("keeps English and Russian dictionaries in parity", () => {
    expect(configLocaleKeys("en")).toEqual(configLocaleKeys("ru"));
    expect(ct("title", "ru")).toBe("Настройки пользователя");
  });
});
