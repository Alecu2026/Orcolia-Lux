import "server-only";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import type { AccountTuple } from "../portal-accounts";

/**
 * Lista conturilor din portal (toți plătitorii cu cont personal sau contract), ținută în memoria serverului, comprimată gzip și cu versiune (ETag), ca la Plătitori și Contoare:
 * pagina nu mai citește ~19.000 de rânduri la fiecare deschidere și nu le mai trimite în HTML, iar browserul le păstrează (IndexedDB) și le reîntreabă condiționat (304).
 * Se reface când se schimbă ceva (activare, resetare, modificarea unui plătitor — vezi `invalidatePortalAccounts`) și cel târziu după 60 de secunde: ultima logare se schimbă
 * la fiecare autentificare și nu invalidează lista la fiecare, deci poate fi în urmă cu cel mult un minut. Memoria e în globalThis (pachetele Next nu partajează variabilele de modul).
 */

const TTL_MS = 60_000;
const collator = new Intl.Collator("ro");

export type PortalAccountsSnap = { version: string; builtAt: number; gz: Buffer; tuples: AccountTuple[] };
type Slot = { snap: PortalAccountsSnap | null; building: Promise<PortalAccountsSnap> | null; dirtyAt: number };
const g = globalThis as unknown as { __portalAccounts?: Slot };
const slot = (): Slot => (g.__portalAccounts ??= { snap: null, building: null, dirtyAt: 0 });

/** Ceva s-a schimbat în conturile din portal: următoarea citire reface lista. Nu aruncă niciodată. */
export function invalidatePortalAccounts(): void {
  slot().dirtyAt = Date.now();
}

async function build(): Promise<PortalAccountsSnap> {
  const startedAt = Date.now();
  const clients = DEMO
    ? []
    : await prisma.client.findMany({
        where: { OR: [{ meterSeries: { not: null } }, { apaCanalContract: { not: null } }] },
        select: { id: true, name: true, meterSeries: true, apaCanalContract: true, email: true, portalPasswordHash: true, portalActivatedAt: true, portalLastLoginAt: true, createdAt: true },
      });
  // fără orderBy în baza de date (sortarea pe zeci de mii de rânduri depășește limita MongoDB): sortăm aici, o singură dată
  const tuples = clients
    .map((c): AccountTuple => [c.id, c.name, c.meterSeries, c.apaCanalContract, c.email || null, c.portalPasswordHash ? 1 : 0, c.portalActivatedAt?.getTime() ?? null, c.portalLastLoginAt?.getTime() ?? null, c.createdAt.getTime()])
    .sort((a, b) => collator.compare(a[1], b[1]));
  const gz = gzipSync(Buffer.from(JSON.stringify({ v: 1, rows: tuples }), "utf8"), { level: 6 });
  const snap: PortalAccountsSnap = { version: createHash("sha1").update(gz).digest("hex").slice(0, 16), builtAt: startedAt, gz, tuples };
  console.log(`[portal-accounts] listă reconstruită: ${tuples.length} conturi, ${(gz.length / 1e3).toFixed(0)} KB comprimat, ${Date.now() - startedAt} ms`);
  return snap;
}

export async function getPortalAccountsSnap(): Promise<PortalAccountsSnap> {
  const s = slot();
  const fresh = s.snap && s.snap.builtAt > s.dirtyAt && Date.now() - s.snap.builtAt < TTL_MS;
  if (fresh && s.snap) return s.snap;
  // o singură reconstruire la un moment dat; cine cere între timp o așteaptă (nu pornește alta)
  if (!s.building) {
    s.building = build()
      .then((snap) => {
        s.snap = snap;
        return snap;
      })
      .finally(() => {
        s.building = null;
      });
  }
  return s.building;
}
