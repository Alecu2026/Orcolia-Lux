import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { currentPeriod } from "../meter-readings";

/**
 * Contoarele marcate LoRaWAN, pentru lista de contoare: id-ul contorului din CRM → ultimul volum primit și luna citirii salvate.
 * Mică (câteva mii de rânduri), ținută scurt în memorie; după fiecare extragere se golește (`invalidateLorawanMap`).
 */
export type LorawanEntry = { volume: number; ts: number; period: string | null };
export type LorawanMap = { version: string; map: Map<string, LorawanEntry> };

const TTL_MS = 60_000;
const g = globalThis as unknown as { __lorawanMap?: { val: LorawanMap | null; at: number; p: Promise<LorawanMap> | null } };
const slot = () => (g.__lorawanMap ??= { val: null, at: 0, p: null });

async function load(): Promise<LorawanMap> {
  const rows = await prisma.lorawanMeter.findMany({
    select: { id: true, volume: true, ts: true, period: true, updatedAt: true },
  });
  const map = new Map<string, LorawanEntry>();
  let max = 0;
  for (const r of rows) {
    map.set(r.id, { volume: r.volume, ts: r.ts.getTime(), period: r.period });
    max = Math.max(max, r.updatedAt.getTime());
  }
  // luna intră în versiune: la trecerea în luna nouă citirea veche nu mai e „curentă”
  return { version: `${map.size}.${max}.${currentPeriod()}`, map };
}

export async function getLorawanMap(): Promise<LorawanMap> {
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
    .catch((e) => {
      console.error("[lorawan] harta contoarelor:", e);
      return s.val ?? { version: "err", map: new Map<string, LorawanEntry>() };
    })
    .finally(() => {
      s.p = null;
    });
  return s.p;
}

export function invalidateLorawanMap(): void {
  const s = slot();
  s.val = null;
  s.at = 0;
}
