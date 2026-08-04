export type InterfaceLocale = "en" | "ru";

export const INTERFACE_LOCALE_KEY = "plane-freeframe-interface-locale-v1";
export const INTERFACE_LOCALE_EVENT = "plane-freeframe:interface-locale";

export function localeFromLanguage(value: string): InterfaceLocale {
  return value.toLowerCase().startsWith("ru") ? "ru" : "en";
}

export function resolveInterfaceLocale(stored: string | null | undefined, hostLanguage: string): InterfaceLocale {
  return stored === "ru" || stored === "en" ? stored : localeFromLanguage(hostLanguage);
}

export function interfaceLocale(
  storage: Pick<Storage, "getItem"> = window.localStorage,
  hostLanguage: string = navigator.language,
): InterfaceLocale {
  return resolveInterfaceLocale(storage.getItem(INTERFACE_LOCALE_KEY), hostLanguage);
}

export function setInterfaceLocale(locale: InterfaceLocale, storage: Pick<Storage, "setItem"> = window.localStorage): void {
  storage.setItem(INTERFACE_LOCALE_KEY, locale);
  window.dispatchEvent(new CustomEvent<InterfaceLocale>(INTERFACE_LOCALE_EVENT, { detail: locale }));
}
