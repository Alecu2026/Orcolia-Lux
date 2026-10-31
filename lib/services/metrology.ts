import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { contractKey } from "../contract-expiry";

/**
 * Datele verificărilor metrologice (MeterMetrology: o înregistrare pe contor, introdusă manual de personal). Harta „id contor → data ultimei verificări” se alipește la lista
 * de contoare (vezi meter-cache) și se citește rar, deci o ținem în memorie; versiunea (număr de înregistrări + ultima modificare) intră în cheia listei alipite, astfel încât
 * orice modificare — făcută pe oricare instanță — refac lista. Memoria e păstrată în globalThis: pachetele Next de producție nu partajează variabilele de modul.
 */

export type MetrologyMap = { version: string; map: Map<string, string> };

const TTL_MS = 5_000;
type Slot = { at: number; p: Promise<MetrologyMap> | null; val: MetrologyMap | null };
const g = globalThis as unknown as { __metroMap?: Slot };
const slot = (): Slot => (g.__metroMap ??= { at: 0, p: null, val: null });

/** Aruncă harta din memorie (după o modificare locală): următoarea citire o reia din baza de date. */
export function dropMetrologyCache(): void {
  const s = slot();
  s.at = 0;
  s.val = null;
}

async function load(): Promise<MetrologyMap> {
  const [agg, rows] = await Promise.all([
    prisma.meterMetrology.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
    prisma.meterMetrology.findMany({ select: { meterId: true, verifiedAt: true } }),
  ]);
  const map = new Map<string, string>();
  for (const r of rows) {
    const k = contractKey(r.verifiedAt);
    if (k) map.set(r.meterId, k);
  }
  return { version: `${agg._count._all}.${agg._max.updatedAt?.getTime() ?? 0}`, map };
}

export async function getMetrologyMap(): Promise<MetrologyMap> {
  if (DEMO) return { version: "demo", map: new Map() };
  const s = slot();
  if (s.val && Date.now() - s.at < TTL_MS) return s.val;
  if (s.p) return s.p;
  s.p = load()
    .then((v) => {
      s.val = v;
      s.at = Date.now();
      return v;
    })
    .finally(() => {
      s.p = null;
    });
  return s.p;
}
