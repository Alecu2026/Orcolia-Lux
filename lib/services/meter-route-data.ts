import "server-only";
import type { ReadingRoute } from "@prisma/client";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { subscriberKey, parseMeterId } from "../queries/meters";
import type { RouteDto } from "../meter-routes";

export const toRouteDto = (r: ReadingRoute): RouteDto => ({
  id: r.id,
  name: r.name,
  sectors: r.sectors,
  localities: r.localities,
  streets: r.streets,
  readerId: r.readerId,
  startDay: r.startDay,
  endDay: r.endDay,
  order: r.order,
  active: r.active,
});

export async function listRoutes(): Promise<RouteDto[]> {
  if (DEMO) return [];
  const rows = await prisma.readingRoute.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  return rows.map(toRouteDto);
}

// ── Sectorul din 1C („Участок”) pe abonat, din ultima înregistrare 1C a fiecărui abonat ─────────────────────────────────

let sectorCache: { at: number; map: Map<string, string> } | null = null;
const SECTOR_TTL_MS = 15 * 60_000;

/** Cheia abonatului (prefixul id-ului contorului) → sectorul („Участок”) din ultima lui înregistrare 1C. Doar abonații cu sector completat. */
export async function getSectorMap(): Promise<Map<string, string>> {
  if (DEMO) return new Map();
  if (sectorCache && Date.now() - sectorCache.at < SECTOR_TTL_MS) return sectorCache.map;
  const recs = await prisma.oneCRecord.findMany({ select: { contPersonal: true, nrContract: true, nume: true, dataDoc: true, sectorUchastok: true } });
  const best = new Map<string, { d: string; s: string | null }>();
  for (const r of recs) {
    const k = subscriberKey(r);
    const d = r.dataDoc ?? "";
    const prev = best.get(k);
    if (!prev || d > prev.d) best.set(k, { d, s: r.sectorUchastok?.trim() || null });
  }
  const map = new Map<string, string>();
  for (const [k, v] of best) if (v.s) map.set(k, v.s);
  sectorCache = { at: Date.now(), map };
  return map;
}

/** Sectorul 1C al unui contor (după id-ul lui). */
export const sectorOfMeter = (id: string, map: Map<string, string>): string | null => {
  const p = parseMeterId(id);
  return p ? (map.get(p.subKey) ?? null) : null;
};
