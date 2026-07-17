import "server-only";
import { cookies } from "next/headers";
import { type Locale, DEFAULT_LOCALE, isValidLocale } from "./index";

export const LOCALE_COOKIE = "app-locale";

export async function getLocaleFromCookie(): Promise<Locale> {
  const jar = await cookies();
  const val = jar.get(LOCALE_COOKIE)?.value ?? "";
  return isValidLocale(val) ? val : DEFAULT_LOCALE;
}
