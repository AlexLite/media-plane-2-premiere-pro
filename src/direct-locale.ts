import en from "../locales/direct-en.json";
import ru from "../locales/direct-ru.json";
import { interfaceLocale, localeFromLanguage } from "./locale-preference";

export type DirectMessageKey = keyof typeof en;
const dictionaries = { en, ru } as const;
export function directLocaleName(value?: string): keyof typeof dictionaries { return value === undefined ? interfaceLocale() : localeFromLanguage(value); }
export function dt(key: DirectMessageKey, locale = directLocaleName()): string { return dictionaries[locale][key]; }
export function directLocaleKeys(locale: keyof typeof dictionaries): string[] { return Object.keys(dictionaries[locale]).sort(); }
