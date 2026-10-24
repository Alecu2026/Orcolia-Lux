import type { Locale } from "./index";
import { EN } from "./dict/en";
import { RU } from "./dict/ru";

export type TVars = Record<string, string | number>;
/** Traducere: primește textul ÎN ROMÂNĂ (cheia) și, opțional, valori pentru {nume} din text. Dacă lipsește o traducere, rămâne româna. */
export type TFn = (ro: string, vars?: TVars) => string;

type Pattern = { re: RegExp; names: string[] };

/** Chei cu {nume} → expresii regulate, ca să se poată traduce și mesajele venite gata completate de la server („…depășește 1000 de caractere”). */
function buildPatterns(dict: Record<string, string>): Map<string, Pattern> {
  const out = new Map<string, Pattern>();
  // Cheile cu cel mai mult text fix primele: potrivirea cea mai specifică câștigă.
  const keys = Object.keys(dict)
    .filter((k) => /\{\w+\}/.test(k))
    .sort((x, y) => y.replace(/\{\w+\}/g, "").length - x.replace(/\{\w+\}/g, "").length);
  for (const key of keys) {
    const names: string[] = [];
    const src = key
      .split(/(\{\w+\})/)
      .map((part) => {
        const m = /^\{(\w+)\}$/.exec(part);
        if (m) { names.push(m[1]); return "(.+?)"; }
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("");
    out.set(key, { re: new RegExp("^" + src + "$"), names });
  }
  return out;
}

const patternCache = new WeakMap<Record<string, string>, Map<string, Pattern>>();

function matchPattern(dict: Record<string, string>, ro: string): string | null {
  let pats = patternCache.get(dict);
  if (!pats) { pats = buildPatterns(dict); patternCache.set(dict, pats); }
  for (const [key, { re, names }] of pats) {
    const m = re.exec(ro);
    if (!m) continue;
    const vals: Record<string, string> = {};
    names.forEach((n, i) => { vals[n] = m[i + 1]; });
    return dict[key].replace(/\{(\w+)\}/g, (x, k: string) => (k in vals ? vals[k] : x));
  }
  return null;
}

export function makeT(locale: Locale): TFn {
  const dict: Record<string, string> | null = locale === "en" ? EN : locale === "ru" ? RU : null;
  return (ro, vars) => {
    let s = dict ? dict[ro] || (vars ? "" : matchPattern(dict, ro) ?? "") || ro : ro;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
    return s;
  };
}

/** Eticheta BCP-47 pentru formatarea datelor/numerelor în limba aleasă. */
export function dateTag(locale: Locale): string {
  return locale === "en" ? "en-GB" : locale === "ru" ? "ru-RU" : "ro-RO";
}
