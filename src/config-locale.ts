import en from "../locales/config-en.json";
import ru from "../locales/config-ru.json";
import { interfaceLocale, localeFromLanguage } from "./locale-preference";
export type ConfigMessageKey = keyof typeof en;
const dictionaries = { en, ru } as const;
export function configLocaleName(value?: string): keyof typeof dictionaries { return value === undefined ? interfaceLocale() : localeFromLanguage(value); }
export function ct(key: ConfigMessageKey, locale = configLocaleName()): string { return dictionaries[locale][key]; }
export function configLocaleKeys(locale: keyof typeof dictionaries): string[] { return Object.keys(dictionaries[locale]).sort(); }
