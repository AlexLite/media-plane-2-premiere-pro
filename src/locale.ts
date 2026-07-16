import en from "../locales/en.json";
import ru from "../locales/ru.json";
export type MessageKey = keyof typeof en;
const dictionaries = { en, ru } as const;
export function localeName(value = navigator.language): keyof typeof dictionaries { return value.toLowerCase().startsWith("ru") ? "ru" : "en"; }
export function t(key: MessageKey, locale = localeName()): string { return dictionaries[locale][key]; }
export function localeKeys(locale: keyof typeof dictionaries): string[] { return Object.keys(dictionaries[locale]).sort(); }
