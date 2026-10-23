import "server-only";
import { prisma } from "../prisma";

/**
 * Toți clienții (doar id + nume), în memorie ~60 s, cu un singur calcul în zbor. \`id in [mii de id-uri]\` e foarte lent pe MongoDB (~2 s la 2.700 de id-uri),
 * iar toată lista (~19.000 de clienți) se citește în ~0,4 s: pentru liste mari de id-uri e mai ieftin să citim tot o dată și să căutăm în hartă.
 */
const TTL_MS = 60_000;
const g = globalThis as unknown as { __clientNames?: { at: number; m: Map<string, string> }; __clientNamesP?: Promise<Map<string, string>> };

export async function allClientNames(): Promise<Map<string, string>> {
  const c = g.__clientNames;
  if (c && Date.now() - c.at < TTL_MS) return c.m;
  if (!g.__clientNamesP) {
    g.__clientNamesP = prisma.client
      .findMany({ select: { id: true, name: true } })
      .then((rows) => {
        const m = new Map(rows.map((r) => [r.id, r.name]));
        g.__clientNames = { at: Date.now(), m };
        return m;
      })
      .finally(() => {
        g.__clientNamesP = undefined;
      });
  }
  return g.__clientNamesP;
}

/** Numele pentru un set de id-uri: puține → interogare directă; multe → din harta tuturor clienților. */
export async function clientNamesFor(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  if (ids.length > 150) {
    const all = await allClientNames();
    for (const id of ids) {
      const n = all.get(id);
      if (n != null) out.set(id, n);
    }
    return out;
  }
  const rows = await prisma.client.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  for (const c of rows) out.set(c.id, c.name);
  return out;
}
