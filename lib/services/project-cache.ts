import "server-only";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { lookupEpoch } from "../lookup-memory";
import { ensureIndex } from "../log-count";
import { taskEpoch } from "../task-epoch";
import { PROJECT_DATASET_MAX, decodeProjects, type ProjectCountsPayload, type ProjectItem, type ProjectPayload, type ProjectTuple } from "../projects-snapshot";

/**
 * Proiectele pentru pagina /projects, în memoria serverului:
 *  - LISTA (nume, status, client, adresă …), comprimată gzip și cu versiune (ETag) — ca la Clienți: pagina primește doar primele rânduri, restul vine în browser o singură dată (IndexedDB).
 *    Se reface abia după o scriere pe Project (extensia Prisma din lib/prisma.ts schimbă `lookupEpoch`), o singură dată (cererile simultane așteaptă aceeași construire), cel mult o dată pe minut altfel.
 *  - NUMĂRUL DE SARCINI al fiecărui proiect: o singură agregare în baza de date (nu `_count` pe fiecare proiect, de ~3 ori mai lent), refăcută când se scrie pe Task, dar cel mult o dată pe secundă.
 * Memoria stă în globalThis (pachetele Next de producție nu partajează variabilele de modul).
 */

const MAX_AGE_MS = 60_000;
const COUNTS_MIN_MS = 1000;

export type ProjectSnap = { version: string; builtAt: number; epoch: number; count: number; gz: Buffer; rows: ProjectItem[] };
export type CountsSnap = { version: string; builtAt: number; epoch: number; map: Map<string, number>; gz: Buffer };
type State = { snap: ProjectSnap | null; building: Promise<ProjectSnap> | null; counts: CountsSnap | null; countsBuilding: Promise<CountsSnap> | null };
const g = globalThis as unknown as { __projectCache?: State };
const S: State = (g.__projectCache ??= { snap: null, building: null, counts: null, countsBuilding: null });

async function build(): Promise<ProjectSnap> {
  const startedAt = Date.now();
  const epoch = lookupEpoch();
  const rows = DEMO
    ? []
    : await prisma.project.findMany({
        select: { id: true, seq: true, name: true, description: true, status: true, clientId: true, assigneeId: true, teamId: true, address: true, lat: true, lng: true },
        orderBy: { createdAt: "desc" },
        take: PROJECT_DATASET_MAX,
      });
  const tuples: ProjectTuple[] = rows.map((r) => [r.id, r.seq ?? null, r.name, r.description, r.status, r.clientId, r.assigneeId, r.teamId, r.address ?? null, r.lat ?? null, r.lng ?? null]);
  const gz = gzipSync(Buffer.from(JSON.stringify({ v: 1, rows: tuples } satisfies ProjectPayload), "utf8"), { level: 6 });
  const version = createHash("sha1").update(gz).digest("hex").slice(0, 16);
  // dacă lista n-a schimbat nimic, păstrăm obiectul (și rândurile decodate) existent
  if (S.snap && S.snap.version === version) return { ...S.snap, builtAt: startedAt, epoch };
  console.log(`[project-cache] reconstruit: ${tuples.length} proiecte, ${(gz.length / 1e6).toFixed(2)} MB comprimat, ${Date.now() - startedAt} ms`);
  return { version, builtAt: startedAt, epoch, count: tuples.length, gz, rows: decodeProjects(tuples) };
}

/** Lista curentă: din memorie dacă nu s-a scris nimic pe Project de la construire; altfel se reface (o singură dată). */
export async function getProjectSnap(): Promise<ProjectSnap> {
  const cur = S.snap;
  if (cur && cur.epoch === lookupEpoch() && Date.now() - cur.builtAt < MAX_AGE_MS) return cur;
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

async function buildCounts(): Promise<CountsSnap> {
  const epoch = taskEpoch();
  const startedAt = Date.now();
  const map = new Map<string, number>();
  if (!DEMO) {
    // Indexul pe projectId lipsește dacă baza de date a fost creată fără `db push`: se creează o singură dată (în fundal), iar până atunci agregarea merge fără indicație de index
    // (o „hint” spre un index inexistent ar da eroare și ar strica pagina Proiecte).
    ensureIndex("Task", { projectId: 1 }, "Task_projectId_idx");
    const pipeline = [{ $match: { projectId: { $exists: true, $ne: null } } }, { $group: { _id: "$projectId", n: { $sum: 1 } } }];
    type Row = { _id: { $oid?: string } | string; n: number };
    let res: Row[];
    try {
      // $exists + hint pe indexul projectId: parcurge doar cheile indexului (fără documentele sarcinilor)
      res = (await prisma.task.aggregateRaw({ pipeline, options: { hint: { projectId: 1 } } })) as unknown as Row[];
    } catch (e) {
      if (!/hint|index/i.test(String((e as Error)?.message ?? e))) throw e;
      res = (await prisma.task.aggregateRaw({ pipeline })) as unknown as Row[];
    }
    for (const r of res) {
      const id = typeof r._id === "string" ? r._id : r._id?.$oid;
      if (id) map.set(id, Number(r.n) || 0);
    }
  }
  const counts: ProjectCountsPayload["counts"] = [...map];
  const gz = gzipSync(Buffer.from(JSON.stringify({ v: 1, counts } satisfies ProjectCountsPayload), "utf8"), { level: 6 });
  const version = createHash("sha1").update(gz).digest("hex").slice(0, 16);
  if (S.counts && S.counts.version === version) return { ...S.counts, builtAt: startedAt, epoch };
  return { version, builtAt: startedAt, epoch, map, gz };
}

/** Numărul de sarcini pe proiect: din memorie cât timp nu s-a scris pe Task (sau a trecut mai puțin de o secundă); altfel o agregare nouă. */
export async function getProjectCounts(): Promise<CountsSnap> {
  const cur = S.counts;
  if (cur) {
    const age = Date.now() - cur.builtAt;
    if ((cur.epoch === taskEpoch() && age < MAX_AGE_MS) || age < COUNTS_MIN_MS) return cur;
  }
  if (!S.countsBuilding) {
    S.countsBuilding = buildCounts()
      .then((c) => {
        S.counts = c;
        return c;
      })
      .finally(() => {
        S.countsBuilding = null;
      });
  }
  return S.countsBuilding;
}
