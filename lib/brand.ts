/**
 * Culorile brandului AquaCRM (luate din siglă) — UN SINGUR loc pentru tot ce nu poate citi variabilele CSS: emailuri, PDF-uri, manifest, bara telefonului, imaginea de previzualizare, harta.
 * Interfața (Tailwind: bg-brand, text-brand, bg-brand-soft …) citește aceleași valori din variabilele CSS din app/globals.css (--color-brand, --color-brand-strong, --color-brand-soft);
 * dacă schimbi o culoare aici, schimb-o și acolo (`npm run check:brand` verifică dacă sunt la fel).
 */
export const BRAND = {
  /** butoane, linkuri active, antete */
  brand: "#0b5bd3",
  /** hover pe butoane, text pe fundal deschis de brand */
  strong: "#063f9a",
  /** fundal deschis de brand (chip-uri, evidențieri) și text deschis pe antet albastru */
  soft: "#dbeafe",
  /** tentă foarte deschisă (fundaluri de casete în PDF) */
  tint: "#eff6ff",
  /** variantele pentru tema întunecată (contrast bun pe fundal închis) */
  darkBrand: "#3b82f6",
  darkStrong: "#2563eb",
  darkSoft: "#0b2a5e",
  darkText: "#93c5fd",
  /** albastrul închis din siglă: fundalul ecranului de pornire al aplicației instalate, copertele */
  navy: "#012a86",
  navyDeep: "#02154f",
  /** accentul cyan din siglă („CRM”) */
  cyan: "#33ccff",
} as const;
