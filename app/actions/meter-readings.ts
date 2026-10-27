"use server";

import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { DEMO } from "@/lib/demo";
import { parseIndex, type PhotoResult, type SaveReadingResult } from "@/lib/meter-readings";
import { getReading, saveReading, setReadingPhoto } from "@/lib/services/meter-readings";

/**
 * Citiri lunare din teren — acțiuni pentru persoana responsabilă (permisiunea „Citiri contoare”). Logica stă în lib/services/meter-readings.ts
 * (într-un fișier „use server” fiecare funcție exportată poate fi apelată de oricine din browser, deci aici sunt doar punțile verificate).
 */

const num = (v: FormDataEntryValue | null): number | null => {
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Salvează (sau corectează) citirea de luna aceasta: index în m³ + locația de la momentul citirii. */
export async function saveMeterReadingAction(formData: FormData): Promise<SaveReadingResult> {
  const user = await requireUser();
  if (!can(user, "meters.read")) return { ok: false, error: "Fără permisiune." };
  const meterId = String(formData.get("meterId") ?? "");
  if (!meterId || meterId.length > 300) return { ok: false, error: "Contor invalid." };
  const value = parseIndex(String(formData.get("value") ?? ""));
  if (value == null) return { ok: false, error: "Index invalid. Scrie un număr (m³), ex. 1234,5." };
  return saveReading(
    { id: user.id, name: user.name },
    {
      meterId,
      value,
      lat: num(formData.get("lat")),
      lng: num(formData.get("lng")),
      accuracy: num(formData.get("accuracy")),
      confirmed: formData.get("confirmed") === "1",
      address: typeof formData.get("address") === "string" ? String(formData.get("address")) : null,
    },
  );
}

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const MAX_PHOTO = 15 * 1024 * 1024;

/** Poza contorului pentru o citire deja salvată (se poate înlocui). */
export async function uploadMeterPhotoAction(formData: FormData): Promise<PhotoResult> {
  const user = await requireUser();
  if (!can(user, "meters.read")) return { ok: false, error: "Fără permisiune." };
  if (DEMO) return { ok: false, error: "Mod demo." };
  const reading = await getReading(String(formData.get("readingId") ?? ""));
  if (!reading) return { ok: false, error: "Citirea nu există. Salvează întâi indexul." };
  const file = formData.get("file") as File | null;
  if (!file || !file.size) return { ok: false, error: "Nicio poză selectată." };
  if (!PHOTO_TYPES.has(file.type)) return { ok: false, error: "Poza trebuie să fie JPEG, PNG, WebP sau HEIC." };
  if (file.size > MAX_PHOTO) return { ok: false, error: "Poza depășește 15 MB." };

  const { env } = await import("@/lib/env");
  if (!env.blob.enabled) return { ok: false, error: "Stocarea fișierelor nu este configurată (BLOB_READ_WRITE_TOKEN lipsă)." };
  const { put, del } = await import("@vercel/blob");
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : file.type.startsWith("image/hei") ? "heic" : "jpg";
  const safe = reading.contor.replace(/[^\w.-]/g, "_").slice(0, 40);
  const blob = await put(`meters/${reading.period}/${safe}-${Date.now()}.${ext}`, file, { access: "public", addRandomSuffix: true });
  const res = await setReadingPhoto(reading.id, blob.url, file.name || `${safe}.${ext}`);
  if (!res) return { ok: false, error: "Citirea nu există." };
  // poza veche (înlocuită) se șterge din stocare; un eșec aici nu strică salvarea
  if (res.oldUrl) await del(res.oldUrl).catch(() => {});
  return { ok: true, photoUrl: blob.url };
}
