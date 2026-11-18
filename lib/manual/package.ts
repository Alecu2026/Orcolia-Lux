import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

/**
 * Pachetul cu pozele manualului (ZIP): exportul de pe un server (de lucru) și importul pe altul (producție). Conține `manifest.json` și câte un fișier de poză pe loc (`poze/<cheie>.webp`).
 * Pozele se potrivesc după CHEIE (aceeași în cod pe ambele servere), deci la import ajung singure la locul lor. Cod partajat: serverul construiește pachetul, browserul îl citește la import.
 */

export const PACKAGE_APP = "manual-poze";
export const PACKAGE_VERSION = 1;
const KEY_RE = /^[a-z0-9-]{1,80}$/;
const MAX_SHOT_BYTES = 12 * 1024 * 1024;
const MAX_ENTRIES = 1000;
const MIMES = new Set(["image/webp", "image/png", "image/jpeg"]);
const EXT: Record<string, string> = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg" };

export type PackageShot = { key: string; mime: string; name: string; width: number | null; height: number | null; data: Uint8Array };

type ManifestEntry = { key: string; file: string; mime: string; name: string; width: number | null; height: number | null; bytes: number };
type Manifest = { app: string; version: number; exportedAt: string; count: number; shots: ManifestEntry[] };

/** Construiește pachetul ZIP (fără compresie: pozele sunt deja WebP). */
export function buildPackage(shots: PackageShot[], exportedAt: Date = new Date()): Uint8Array {
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  const entries: ManifestEntry[] = [];
  for (const s of shots) {
    const file = `poze/${s.key}.${EXT[s.mime] ?? "webp"}`;
    files[file] = [s.data, { level: 0 }];
    entries.push({ key: s.key, file, mime: s.mime, name: s.name, width: s.width, height: s.height, bytes: s.data.length });
  }
  const manifest: Manifest = { app: PACKAGE_APP, version: PACKAGE_VERSION, exportedAt: exportedAt.toISOString(), count: entries.length, shots: entries };
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  return zipSync(files);
}

export type ReadPackage = { ok: true; shots: PackageShot[]; skipped: { key: string; reason: string }[]; exportedAt: string } | { ok: false; error: string };

/** Citește și validează pachetul. Nu ține cont de ce locuri există în manual (asta o verifică serverul la fiecare poză); respinge doar ce nu e un pachet valid. */
export function readPackage(zip: Uint8Array): ReadPackage {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip, { filter: (f) => f.originalSize <= MAX_SHOT_BYTES || f.name === "manifest.json" });
  } catch {
    return { ok: false, error: "Fișierul nu este un pachet ZIP valid." };
  }
  if (Object.keys(files).length > MAX_ENTRIES) return { ok: false, error: "Pachetul conține prea multe fișiere." };
  const raw = files["manifest.json"];
  if (!raw) return { ok: false, error: "Pachetul nu are manifest.json: nu e un export al pozelor din manual." };
  let m: Manifest;
  try {
    m = JSON.parse(strFromU8(raw)) as Manifest;
  } catch {
    return { ok: false, error: "manifest.json este stricat." };
  }
  if (!m || m.app !== PACKAGE_APP) return { ok: false, error: "Pachetul nu este un export al pozelor din manual." };
  if (m.version !== PACKAGE_VERSION) return { ok: false, error: "Versiunea pachetului nu e recunoscută (exportă din nou de pe serverul sursă)." };
  if (!Array.isArray(m.shots)) return { ok: false, error: "manifest.json este stricat." };

  const shots: PackageShot[] = [];
  const skipped: { key: string; reason: string }[] = [];
  for (const e of m.shots) {
    const key = typeof e?.key === "string" ? e.key : "";
    if (!KEY_RE.test(key)) { skipped.push({ key: key.slice(0, 40), reason: "cheie invalidă" }); continue; }
    const data = typeof e.file === "string" ? files[e.file] : undefined;
    if (!data || data.length === 0) { skipped.push({ key, reason: "lipsește fișierul pozei" }); continue; }
    if (!MIMES.has(e.mime)) { skipped.push({ key, reason: "format neacceptat" }); continue; }
    if (data.length > MAX_SHOT_BYTES) { skipped.push({ key, reason: "poza depășește 12 MB" }); continue; }
    shots.push({ key, mime: e.mime, name: typeof e.name === "string" ? e.name.slice(0, 120) : `${key}.webp`, width: typeof e.width === "number" ? e.width : null, height: typeof e.height === "number" ? e.height : null, data });
  }
  return { ok: true, shots, skipped, exportedAt: typeof m.exportedAt === "string" ? m.exportedAt : "" };
}
