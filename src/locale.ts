import en from "../locales/en.json";
import ru from "../locales/ru.json";
import { interfaceLocale, localeFromLanguage } from "./locale-preference";
export type MessageKey = keyof typeof en;
const dictionaries = { en, ru } as const;
export function localeName(value?: string): keyof typeof dictionaries { return value === undefined ? interfaceLocale() : localeFromLanguage(value); }
export function t(key: MessageKey, locale = localeName()): string { return dictionaries[locale][key]; }
export function localeKeys(locale: keyof typeof dictionaries): string[] { return Object.keys(dictionaries[locale]).sort(); }
