import "server-only";
import { withSharp } from "./image-pool";

/**
 * Optimizarea pozelor din „Manual de utilizare” (la fiecare încărcare, indiferent de mărime): se rotește după EXIF, se micșorează la cel mult 1600 px lățime (nu se mărește niciodată),
 * se face WebP (calitatea 82; dacă iese peste `maxBytes` — poze foarte „încărcate” — se reia cu calitate mai mică și lățime mai mică). Textul din screenshot-uri rămâne lizibil.
 * Poza optimizată e cea care se păstrează în baza de date; originalul nu se păstrează.
 */

export const MANUAL_MAX_WIDTH = 1600;
/** peste atât, o poză optimizată se mai micșorează (o poză stă într-un document MongoDB și numără la cota bazei de date) */
export const MANUAL_MAX_BYTES = 1_500_000;

export type Optimized = { buf: Buffer; width: number; height: number; mime: "image/webp" };

export async function optimizeShot(input: Buffer, maxBytes = MANUAL_MAX_BYTES): Promise<Optimized> {
  // o poză deja optimizată (WebP, în limite, fără rotire EXIF) se păstrează întocmai: la import dintr-un pachet exportat nu se mai pierde calitate la fiecare trecere
  const meta = await withSharp((sharp) => sharp(input, { failOn: "none" }).metadata());
  if (meta.format === "webp" && meta.width && meta.height && meta.width <= MANUAL_MAX_WIDTH && input.length <= maxBytes && (meta.orientation ?? 1) === 1) {
    return { buf: input, width: meta.width, height: meta.height, mime: "image/webp" };
  }
  // treptele: (lățime, calitate) — se oprește la prima care încape sub limită; ultima se acceptă oricum
  const steps: [number, number][] = [
    [MANUAL_MAX_WIDTH, 82],
    [MANUAL_MAX_WIDTH, 70],
    [1280, 70],
    [1024, 62],
  ];
  let last: Optimized | null = null;
  for (const [width, quality] of steps) {
    const out = await withSharp(async (sharp) => {
      const { data, info } = await sharp(input, { failOn: "none" })
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality })
        .toBuffer({ resolveWithObject: true });
      return { buf: data, width: info.width, height: info.height, mime: "image/webp" as const };
    });
    last = out;
    if (out.buf.length <= maxBytes) break;
  }
  return last as Optimized;
}
