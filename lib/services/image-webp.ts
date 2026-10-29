import "server-only";
import { withSharp } from "./image-pool";

const MAX_PX = 1920;
const QUALITY = 80;
/** Sub această mărime nu merită procesarea. */
const MIN_BYTES = 100 * 1024;
/** Doar aceste formate se convertesc (WebP e deja mic, GIF/SVG pot fi animate / vectoriale, HEIC nu se decodează pe server). */
const CONVERT = new Set(["image/jpeg", "image/png"]);

/**
 * Plasă de siguranță pe server: orice poză JPEG/PNG care ajunge necomprimată (alt client, browser fără WebP, coadă offline veche)
 * se redimensionează (max 1920 px), se rotește după EXIF și se salvează ca WebP. Dacă rezultatul nu e mai mic, se păstrează originalul.
 * Orice eroare lasă fișierul nemodificat — încărcarea nu se blochează niciodată din cauza conversiei.
 */
export async function toWebp(file: File): Promise<File> {
  if (!CONVERT.has(file.type) || file.size < MIN_BYTES) return file;
  try {
    const input = Buffer.from(await file.arrayBuffer());
    const out = await withSharp((sharp) =>
      sharp(input, { failOn: "none", sequentialRead: true })
        .rotate()
        .resize({ width: MAX_PX, height: MAX_PX, fit: "inside", withoutEnlargement: true })
        .webp({ quality: QUALITY })
        .toBuffer(),
    );
    if (out.length >= file.size) return file;
    return new File([new Uint8Array(out)], file.name.replace(/\.[^.]+$/, "") + ".webp", { type: "image/webp" });
  } catch {
    return file;
  }
}
