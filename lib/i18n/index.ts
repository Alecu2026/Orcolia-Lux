import ro, { type Messages } from "./messages/ro";
import en from "./messages/en";
import ru from "./messages/ru";

export type { Messages };
export type Locale = "ro" | "en" | "ru";

const MESSAGES: Record<Locale, Messages> = { ro, en, ru };

export const LOCALES: Locale[] = ["ro", "en", "ru"];
export const DEFAULT_LOCALE: Locale = "ro";

export function getMessages(locale: string): Messages {
  const l = (LOCALES.includes(locale as Locale) ? locale : DEFAULT_LOCALE) as Locale;
  return MESSAGES[l];
}

export function isValidLocale(locale: string): locale is Locale {
  return LOCALES.includes(locale as Locale);
}
