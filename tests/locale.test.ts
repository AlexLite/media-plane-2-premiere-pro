import { describe, expect, it } from "vitest";
import { localeKeys } from "../src/locale";
describe("locales", () => { it("keeps EN/RU keys in parity", () => expect(localeKeys("ru")).toEqual(localeKeys("en"))); });
