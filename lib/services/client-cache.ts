import "server-only";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { prisma } from "../prisma";
import { DEMO, demoClients } from "../demo";
import { clientEpoch } from "../lookup-memory";
import { CRM_CLIENT_WHERE, CLIENT_LIST_SELECT } from "../queries/clients";
import { decodeClients, type ClientRow, type ClientTuple } from "../clients-snapshot";

/**
 * Clienții de CRM (fără plătitori) ca listă compactă în memoria serverului, comprimată gzip și cu versiune (ETag) — ca la Plătitori: pagina /clients primește doar primele rânduri,
 * iar lista completă vine în browser o singură dată (IndexedDB) și se filtrează / sortează local. Ordinea = cea implicită a paginii (ultima programare, apoi nume).
 *
 * Orice scriere pe Client (și plătitorii sunt Client) marchează lista ca depășită (vezi extensia Prisma din lib/prisma.ts); ea se reface abia la următoarea cerere, o singură dată
 * (cereri simultane așteaptă aceeași construire), iar dacă rezultatul e identic (scrieri doar pe plătitori) versiunea rămâne aceeași și browserele primesc 304.
 * La mai multe procese, fiecare își reface lista cel mult după `MAX_AGE_MS`. Memoria stă în globalThis (pachetele Next de producție nu partajează variabilele de modul).
 */

const MAX_AGE_MS = 60_000; // plasă de siguranță (scrieri făcute în alt proces sau direct în baza de date); în același proces lista se reface imediat la orice scriere

export type ClientSnap = { version: string; builtAt: number; epoch: number; count: number; gz: Buffer; rows: ClientRow[] };
type State = { snap: ClientSnap | null; building: Promise<ClientSnap> | null };
const g = globalThis as unknown as { __clientSnap?: State };
const S: State = (g.__clientSnap ??= { snap: null, building: null });

async function build(): Promise<ClientSnap> {
  const startedAt = Date.now();
  const epoch = clientEpoch();
  let tuples: ClientTuple[];
  if (DEMO) {
    tuples = demoClients.map((c) => [c.id, c.name, c.phone ?? null, c.email ?? null, c.telegramChatId ?? null, c.notes ?? null, c.noShowCount ?? 0, c.lastAppointmentAt ? new Date(c.lastAppointmentAt).getTime() : null, null]);
  } else {
    const rows = await prisma.client.findMany({ where: CRM_CLIENT_WHERE, select: CLIENT_LIST_SELECT });
    // aceeași ordine ca până acum: ultima programare (cele fără, la sfârșit), apoi numele
    rows.sort((a, b) => {
      const x = a.lastAppointmentAt?.getTime() ?? null, y = b.lastAppointmentAt?.getTime() ?? null;
      if (x !== y) return x == null ? 1 : y == null ? -1 : y - x;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    tuples = rows.map((r) => [r.id, r.name, r.phone, r.email, r.telegramChatId, r.notes, r.noShowCount, r.lastAppointmentAt ? r.lastAppointmentAt.getTime() : null, r.consumAddress ?? null]);
  }
  const gz = gzipSync(Buffer.from(JSON.stringify({ v: 1, rows: tuples }), "utf8"), { level: 6 });
  const version = createHash("sha1").update(gz).digest("hex").slice(0, 16);
  // dacă lista n-a schimbat nimic, păstrăm obiectul (și rândurile decodate) existent
  if (S.snap && S.snap.version === version) return { ...S.snap, builtAt: startedAt, epoch };
  const snap: ClientSnap = { version, builtAt: startedAt, epoch, count: tuples.length, gz, rows: decodeClients(tuples) };
  console.log(`[client-cache] reconstruit: ${tuples.length} clienți, ${(gz.length / 1e6).toFixed(2)} MB comprimat, ${Date.now() - startedAt} ms`);
  return snap;
}

/** Lista curentă: din memorie dacă nu s-a scris nimic pe Client de la construire; altfel se reface (o singură dată, cererile simultane o așteaptă). */
export async function getClientSnap(): Promise<ClientSnap> {
  const cur = S.snap;
  if (cur && cur.epoch === clientEpoch() && Date.now() - cur.builtAt < MAX_AGE_MS) return cur;
  if (!S.building) {
    S.building = build()
      .then((snap) => {
        S.snap = snap;
        return snap;
      })
      .finally(() => {
        S.building = null;
      });
  }
  return S.building;
}
