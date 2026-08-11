import en from "../locales/shell-en.json";
import ru from "../locales/shell-ru.json";
import { interfaceLocale, localeFromLanguage } from "./locale-preference";

export type ShellMessageKey = keyof typeof en;
const dictionaries = { en, ru } as const;

export function shellLocaleName(value?: string): keyof typeof dictionaries {
  return value === undefined ? interfaceLocale() : localeFromLanguage(value);
}

export function st(key: ShellMessageKey, locale = shellLocaleName()): string {
  return dictionaries[locale][key];
}

export function shellLocaleKeys(locale: keyof typeof dictionaries): string[] {
  return Object.keys(dictionaries[locale]).sort();
}
