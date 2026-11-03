import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";

/**
 * Neregulile DESCHISE ale contoarelor (MeterIssue fără dată de rezolvare): harta „id contor → tipul celei mai noi” se alipește la lista de contoare (vezi meter-cache), ca pagina
 * /contoare să poată filtra după neregulă. Se citește rar, deci o ținem în memorie; versiunea (câte sunt deschise + ultima raportare / rezolvare) intră în cheia listei alipite, deci
 * orice modificare — făcută pe oricare instanță — refac lista. Memoria e păstrată în globalThis: pachetele Next de producție nu partajează variabilele de modul.
 */

export type IssueMap = { version: string; map: Map<string, string> };

const TTL_MS = 5_000;
type Slot = { at: number; p: Promise<IssueMap> | null; val: IssueMap | null };
const g = globalThis as unknown as { __issueMap?: Slot };
const slot = (): Slot => (g.__issueMap ??= { at: 0, p: null, val: null });

/** Aruncă harta din memorie (după o raportare / rezolvare locală): următoarea citire o reia din baza de date. */
export function dropIssueMapCache(): void {
  const s = slot();
  s.at = 0;
  s.val = null;
}

async function load(): Promise<IssueMap> {
  const [agg, open] = await Promise.all([
    prisma.meterIssue.aggregate({ _count: { _all: true }, _max: { createdAt: true, resolvedAt: true } }),
    // cele mai vechi primele: la un contor cu mai multe nereguli deschise rămâne cea mai nouă
    prisma.meterIssue.findMany({ where: { resolvedAt: null }, select: { meterId: true, kind: true }, orderBy: { reportedAt: "asc" } }),
  ]);
  const map = new Map<string, string>();
  for (const i of open) map.set(i.meterId, i.kind);
  return { version: `${agg._count._all}.${open.length}.${agg._max.createdAt?.getTime() ?? 0}.${agg._max.resolvedAt?.getTime() ?? 0}`, map };
}

export async function getIssueMap(): Promise<IssueMap> {
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
