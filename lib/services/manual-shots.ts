import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { logAudit } from "./audit";
import { optimizeShot } from "./manual-optimize";
import { SHOT_KEYS } from "../manual/content";

/**
 * Pozele din „Manual de utilizare”: câte una pe loc (cheie din lib/manual/content). Poza se OPTIMIZEAZĂ la încărcare (WebP, cel mult 1600 px) și se păstrează chiar în baza de date
 * (model ManualShot, câmpul `data`); se servește din /api/manual/shot/<cheie>. O poză nouă o înlocuiește pe cea veche (adresa se schimbă cu versiunea, ca browserul să nu arate poza veche).
 */

export type ShotInfo = { url: string; by: string; at: string };
export type ShotMap = Record<string, ShotInfo>;

const TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
/** limita pozei trimise (înainte de optimizare) */
const MAX_BYTES = 12 * 1024 * 1024;

type Actor = { id: string; name: string; role: string; isSuperAdmin?: boolean };

/** Adresa pozei, cu versiunea (momentul ultimei schimbări) în adresă: se schimbă la fiecare înlocuire. */
export const shotUrl = (key: string, updatedAt: Date) => `/api/manual/shot/${encodeURIComponent(key)}?v=${updatedAt.getTime()}`;

export async function loadManualShots(): Promise<ShotMap> {
  if (DEMO) return {};
  // fără câmpul `data`: pagina primește doar adresele, pozele se aduc separat (cache în browser)
  const rows = await prisma.manualShot.findMany({ select: { key: true, byName: true, updatedAt: true } });
  const out: ShotMap = {};
  for (const r of rows) out[r.key] = { url: shotUrl(r.key, r.updatedAt), by: r.byName, at: r.updatedAt.toISOString() };
  return out;
}

export type SaveShotResult = { ok: true; shot: ShotInfo } | { ok: false; error: string };

export async function saveManualShot(user: Actor, key: string, original: File | null): Promise<SaveShotResult> {
  if (DEMO) return { ok: false, error: "Mod demo: conectează o bază de date." };
  if (typeof key !== "string" || !SHOT_KEYS.has(key)) return { ok: false, error: "Loc necunoscut în manual." };
  if (!original || !original.size) return { ok: false, error: "Nicio poză aleasă." };
  if (!TYPES.has(original.type)) return { ok: false, error: "Poza trebuie să fie PNG, JPEG sau WebP." };
  if (original.size > MAX_BYTES) return { ok: false, error: "Poza depășește 12 MB." };

  let opt;
  try {
    opt = await optimizeShot(Buffer.from(await original.arrayBuffer()));
  } catch (e) {
    console.error("[manual] optimizarea pozei a eșuat:", String((e as Error)?.message ?? e).slice(0, 160));
    return { ok: false, error: "Poza nu a putut fi citită. Încearcă un fișier PNG sau JPEG valid." };
  }
  const name = (original.name || `${key}.png`).slice(0, 120);
  const data = { data: new Uint8Array(opt.buf), mime: opt.mime, size: opt.buf.length, width: opt.width, height: opt.height, name, byId: user.id, byName: user.name };
  const row = await prisma.manualShot.upsert({
    where: { key },
    create: { key, ...data },
    update: data,
    select: { key: true, byName: true, updatedAt: true },
  });
  await logAudit(
    { id: user.id, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin },
    { action: "manual.shot_set", module: "Manual", objectId: key, objectName: key, newValue: `${name} · ${Math.round(opt.buf.length / 1024)} KB` },
  ).catch(() => {});
  return { ok: true, shot: { url: shotUrl(row.key, row.updatedAt), by: row.byName, at: row.updatedAt.toISOString() } };
}

export async function removeManualShot(user: Actor, key: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (DEMO) return { ok: false, error: "Mod demo: conectează o bază de date." };
  if (typeof key !== "string" || !SHOT_KEYS.has(key)) return { ok: false, error: "Loc necunoscut în manual." };
  const del = await prisma.manualShot.deleteMany({ where: { key } });
  if (del.count > 0) {
    await logAudit(
      { id: user.id, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin },
      { action: "manual.shot_remove", module: "Manual", objectId: key, objectName: key },
    ).catch(() => {});
  }
  return { ok: true };
}

/** Octeții pozei (pentru servire și pentru PDF); null = nu există. */
export async function readManualShot(key: string): Promise<{ data: Buffer; mime: string; updatedAt: Date } | null> {
  if (DEMO || !SHOT_KEYS.has(key)) return null;
  const r = await prisma.manualShot.findUnique({ where: { key }, select: { data: true, mime: true, updatedAt: true } });
  return r ? { data: Buffer.from(r.data), mime: r.mime, updatedAt: r.updatedAt } : null;
}

/** Toate pozele cu datele lor (pentru exportul pachetului de poze: de pe serverul de lucru în producție). */
export async function readAllManualShotsFull(): Promise<{ key: string; mime: string; name: string; width: number | null; height: number | null; data: Uint8Array }[]> {
  if (DEMO) return [];
  const rows = await prisma.manualShot.findMany({ select: { key: true, mime: true, name: true, width: true, height: true, data: true }, orderBy: { key: "asc" } });
  return rows.map((r) => ({ key: r.key, mime: r.mime, name: r.name, width: r.width, height: r.height, data: new Uint8Array(r.data) }));
}

/** Toate pozele, ca octeți (pentru exportul PDF). */
export async function readAllManualShots(): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  if (DEMO) return out;
  const rows = await prisma.manualShot.findMany({ select: { key: true, data: true } });
  for (const r of rows) out.set(r.key, Buffer.from(r.data));
  return out;
}
