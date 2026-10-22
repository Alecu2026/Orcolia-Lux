import type { Locale } from "./index";
import { EN } from "./dict/en";
import { RU } from "./dict/ru";

export type TVars = Record<string, string | number>;
/** Traducere: primește textul ÎN ROMÂNĂ (cheia) și, opțional, valori pentru {nume} din text. Dacă lipsește o traducere, rămâne româna. */
export type TFn = (ro: string, vars?: TVars) => string;

export function makeT(locale: Locale): TFn {
  const dict: Record<string, string> | null = locale === "en" ? EN : locale === "ru" ? RU : null;
  return (ro, vars) => {
    let s = (dict && dict[ro]) || ro;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
    return s;
  };
}

/** Eticheta BCP-47 pentru formatarea datelor/numerelor în limba aleasă. */
export function dateTag(locale: Locale): string {
  return locale === "en" ? "en-GB" : locale === "ru" ? "ru-RU" : "ro-RO";
}
