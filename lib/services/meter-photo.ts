import "server-only";
import { DEMO } from "../demo";
import type { PhotoResult } from "../meter-readings";
import { getReading, setReadingPhoto } from "./meter-readings";
import { toWebp } from "./image-webp";
import { deleteStored, meterFolder, storePublic } from "../storage";

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const MAX_PHOTO = 15 * 1024 * 1024;

/** Salvează poza contorului pe discul serverului și o leagă de citire (o poză veche se înlocuiește și se șterge). */
export async function uploadReadingPhoto(readingId: string, original: File): Promise<PhotoResult> {
  const file = original && original.size ? await toWebp(original) : original;
  if (DEMO) return { ok: false, error: "Mod demo." };
  const reading = await getReading(readingId);
  if (!reading) return { ok: false, error: "Citirea nu există. Salvează întâi indexul." };
  if (!file || !file.size) return { ok: false, error: "Nicio poză selectată." };
  if (!PHOTO_TYPES.has(file.type)) return { ok: false, error: "Poza trebuie să fie JPEG, PNG, WebP sau HEIC." };
  if (file.size > MAX_PHOTO) return { ok: false, error: "Poza depășește 15 MB." };

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : file.type.startsWith("image/hei") ? "heic" : "jpg";
  const safe = reading.contor.replace(/[^\w.-]/g, "_").slice(0, 40);
  let blob: { url: string };
  try {
    blob = await storePublic(meterFolder(reading.period), file, `${safe}.${ext}`);
  } catch (e) {
    console.error("[meter-photo] salvarea pe disc a eșuat:", e);
    return { ok: false, error: "Poza nu a putut fi salvată pe server." };
  }
  const res = await setReadingPhoto(reading.id, blob.url, file.name || `${safe}.${ext}`);
  if (!res) return { ok: false, error: "Citirea nu există." };
  if (res.oldUrl) await deleteStored(res.oldUrl);
  return { ok: true, photoUrl: blob.url };
}
