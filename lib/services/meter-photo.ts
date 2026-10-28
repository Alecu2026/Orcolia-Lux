import "server-only";
import { DEMO } from "../demo";
import type { PhotoResult } from "../meter-readings";
import { getReading, setReadingPhoto } from "./meter-readings";

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const MAX_PHOTO = 15 * 1024 * 1024;

/** Încarcă poza contorului în stocare și o leagă de citire (o poză veche se înlocuiește și se șterge). */
export async function uploadReadingPhoto(readingId: string, file: File): Promise<PhotoResult> {
  if (DEMO) return { ok: false, error: "Mod demo." };
  const reading = await getReading(readingId);
  if (!reading) return { ok: false, error: "Citirea nu există. Salvează întâi indexul." };
  if (!file || !file.size) return { ok: false, error: "Nicio poză selectată." };
  if (!PHOTO_TYPES.has(file.type)) return { ok: false, error: "Poza trebuie să fie JPEG, PNG, WebP sau HEIC." };
  if (file.size > MAX_PHOTO) return { ok: false, error: "Poza depășește 15 MB." };

  const { env } = await import("../env");
  if (!env.blob.enabled) return { ok: false, error: "Stocarea fișierelor nu este configurată (BLOB_READ_WRITE_TOKEN lipsă)." };
  const { put, del } = await import("@vercel/blob");
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : file.type.startsWith("image/hei") ? "heic" : "jpg";
  const safe = reading.contor.replace(/[^\w.-]/g, "_").slice(0, 40);
  const blob = await put(`meters/${reading.period}/${safe}-${Date.now()}.${ext}`, file, { access: "public", addRandomSuffix: true });
  const res = await setReadingPhoto(reading.id, blob.url, file.name || `${safe}.${ext}`);
  if (!res) return { ok: false, error: "Citirea nu există." };
  if (res.oldUrl) await del(res.oldUrl).catch(() => {});
  return { ok: true, photoUrl: blob.url };
}
