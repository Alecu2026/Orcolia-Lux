import "server-only";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { encodeTaskNames, loadChangedTaskTuples, loadTaskTuples, taskListStamp, taskViewFilter, type TaskFilter, type TaskStamp } from "../queries/tasks";
import { taskEpoch } from "../task-epoch";
import { can, canUseAllScope, type PermissionSubject } from "../permissions";
import type { TaskTuple } from "../task-dataset";

/**
 * Cache pe server al listei COMPLETE de task-uri / tichete (format compact + gzip), una per (tip, scop, vizibilitate).
 *
 * - La FIECARE cerere se verifică o „amprentă” ieftină (număr de rânduri + ultima modificare; o singură agregare, ~zeci de ms). Nu ne bazăm pe un
 *   interval de încredere: pe mai multe instanțe (Vercel) o modificare făcută pe una trebuie să se vadă imediat pe cealaltă — altfel lista completă
 *   ar acoperi cu date vechi primele rânduri proaspete din HTML (modificarea proprie ar „dispărea” o clipă).
 * - Când amprenta s-a schimbat, NU se recitește toată colecția (secunde la zeci de mii de rânduri): se aduc doar rândurile modificate de la ultima
 *   amprentă și se pun peste lista din memorie. Verificarea de siguranță: numărul de rânduri din memorie + cele noi trebuie să iasă egal cu cel din
 *   baza de date; altfel (ștergeri, rânduri care ies din „scope”, prea multe modificări) se reconstruiește tot.
 * - Reconstruirea e single-flight și o cerere se alătură doar unei construiri pornite pe ACEEAȘI amprentă.
 * - ETag = hash-ul conținutului → același conținut = 304, chiar dacă lista a fost refăcută.
 */

export type DatasetKind = "TASK" | "TICKET";

type Entry = {
  epoch: number;
  stamp: TaskStamp;
  /** Rândurile după id (sursa din care se compune răspunsul). */
  map: Map<string, TaskTuple>;
  /** Când a început construirea acestei versiuni (o versiune mai veche nu o înlocuiește pe una mai nouă). */
  startedAt: number;
  /** Ultima citire COMPLETĂ din baza de date. */
  fullAt: number;
  /** Ultima compunere a răspunsului (numele de utilizatori/proiecte/clienți se reîmprospătează la ea). */
  encodedAt: number;
  etag: string;
  gz: Buffer;
  count: number;
};

const NAMES_REFRESH_MS = 60_000; // numele redenumite (utilizatori, proiecte, clienți) nu ating colecția Task: refacem răspunsul din memorie
const FULL_REBUILD_MS = 10 * 60_000; // plasă de siguranță: o dată la 10 minute recitim tot
const DELTA_OVERLAP_MS = 5_000; // rândurile modificate cu puțin înainte de ultima amprentă se citesc din nou (ceasuri ușor decalate între instanțe)
const DELTA_MAX = 3000; // peste atâtea rânduri modificate deodată (ex. import) recitim tot
const MAX_ENTRIES = 16;

type Running = { sk: string; epoch: number; promise: Promise<Entry> };
const g = globalThis as unknown as { __taskDs?: Map<string, Entry>; __taskDsP?: Map<string, Running> };
const cache = (g.__taskDs ??= new Map());
const inflight = (g.__taskDsP ??= new Map());

type User = PermissionSubject & { id: string; teamIds?: string[]; taskViewScope: string; taskViewTeamIds: string[]; taskViewMemberIds: string[] };

/** Scop + tip → filtrul listei pentru acest utilizator, sau null dacă nu are voie. Aceeași regulă ca pagina (/tasks, /tickets). */
export function datasetFilter(user: User, kind: DatasetKind, scopeIn: string): TaskFilter | null {
  if (!can(user, kind === "TICKET" ? "tickets.view" : "tasks.view")) return null;
  const scope = (["mine", "all", "created"].includes(scopeIn) && !(scopeIn === "all" && !canUseAllScope(user)) ? scopeIn : "mine") as "mine" | "all" | "created";
  return {
    scope,
    userId: user.id,
    teamIds: user.teamIds,
    ...taskViewFilter(user),
    types: [kind],
  };
}

/** Cheia cache-ului: două conturi care văd exact aceleași rânduri (ex. doi administratori pe „Toate”) împart aceeași listă. */
function keyOf(f: TaskFilter, kind: DatasetKind): string {
  const shared = f.scope === "all" && f.viewScope !== "RESTRICTED";
  const parts = {
    kind,
    scope: f.scope,
    user: shared ? "*" : f.userId,
    teams: f.scope === "mine" ? [...(f.teamIds ?? [])].sort() : [],
    view: f.viewScope ?? "ALL",
    vt: f.viewScope === "RESTRICTED" ? [...(f.viewTeamIds ?? [])].sort() : [],
    vm: f.viewScope === "RESTRICTED" ? [...(f.viewMemberIds ?? [])].sort() : [],
    hide: !!f.hideClientNames,
  };
  return createHash("sha1").update(JSON.stringify(parts)).digest("hex").slice(0, 20);
}

const stampKey = (s: TaskStamp) => `${s.count}:${s.max}`;

/** Lista din memorie → răspunsul comprimat (cele mai noi primele + dicționarul de nume). */
async function encode(map: Map<string, TaskTuple>, filter: TaskFilter): Promise<{ etag: string; gz: Buffer; count: number }> {
  const rows = [...map.values()].sort((a, b) => b[20] - a[20] || (a[0] < b[0] ? 1 : -1));
  const names = await encodeTaskNames(rows, !!filter.hideClientNames);
  const json = JSON.stringify({ v: 1, rows, names });
  return { etag: `"${createHash("sha1").update(json).digest("hex").slice(0, 20)}"`, gz: gzipSync(json, { level: 6 }), count: rows.length };
}

function store(key: string, entry: Entry) {
  const existing = cache.get(key);
  // O construire mai veche, terminată după una mai nouă, nu are voie s-o înlocuiască.
  if (existing && existing.startedAt > entry.startedAt) return;
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
}

async function refresh(key: string, filter: TaskFilter, cur: Entry | undefined, stamp: TaskStamp, epoch: number): Promise<Entry> {
  const now = Date.now();
  const startedAt = now;
  let map: Map<string, TaskTuple> | null = null;
  let fullAt = now;
  if (cur && now - cur.fullAt < FULL_REBUILD_MS) {
    // Doar ce s-a modificat de la ultima amprentă.
    const changed = await loadChangedTaskTuples(filter, Math.max(0, cur.stamp.max - DELTA_OVERLAP_MS), DELTA_MAX);
    if (changed) {
      const next = new Map(cur.map);
      let added = 0;
      for (const t of changed) {
        if (!next.has(t[0])) added++;
        next.set(t[0], t);
      }
      // Dacă ceva a IEȘIT din listă (șters, reasignat altcuiva) sau amprenta s-a mișcat în timp ce citeam, numărătoarea nu mai iese: recitim tot.
      if (cur.map.size + added === stamp.count) {
        map = next;
        fullAt = cur.fullAt;
      }
    }
  }
  if (!map) map = new Map((await loadTaskTuples(filter)).map((t) => [t[0], t]));
  const enc = await encode(map, filter);
  const entry: Entry = { epoch, stamp, map, startedAt, fullAt, encodedAt: Date.now(), ...enc };
  store(key, entry);
  return entry;
}

export async function getTaskDataset(user: User, kind: DatasetKind, scope: string): Promise<Entry | null> {
  const filter = datasetFilter(user, kind, scope);
  if (!filter) return null;
  const key = keyOf(filter, kind);
  // Amprenta CURENTĂ a colecției, citită la fiecare cerere: tot ce s-a scris înainte de această cerere trebuie să se vadă.
  const epoch = taskEpoch();
  const stamp = await taskListStamp(filter);
  const sk = stampKey(stamp);
  const cur = cache.get(key);
  if (cur && cur.epoch === epoch && stampKey(cur.stamp) === sk) {
    if (Date.now() - cur.encodedAt < NAMES_REFRESH_MS) return cur;
    // Aceleași rânduri, dar de ceva vreme: refacem doar răspunsul (nume noi), fără baza de date.
    const running = inflight.get(key);
    if (running && running.sk === sk && running.epoch === epoch) return running.promise;
    const promise: Promise<Entry> = (async () => {
      const startedAt = Date.now();
      const enc = await encode(cur.map, filter);
      const entry: Entry = { ...cur, startedAt, encodedAt: Date.now(), ...enc };
      store(key, entry);
      return entry;
    })().finally(() => {
      if (inflight.get(key)?.promise === promise) inflight.delete(key);
    });
    inflight.set(key, { sk, epoch, promise });
    return promise;
  }
  // O construire deja pornită poate fi folosită DOAR dacă a pornit pe aceeași stare (aceeași amprentă): altfel cererea ar primi o listă
  // făcută înainte de o modificare recentă (de ex. propria ei modificare ar „dispărea” din listă).
  const running = inflight.get(key);
  if (running && running.sk === sk && running.epoch === epoch) return running.promise;
  const promise: Promise<Entry> = refresh(key, filter, cur, stamp, epoch).finally(() => {
    if (inflight.get(key)?.promise === promise) inflight.delete(key);
  });
  inflight.set(key, { sk, epoch, promise });
  return promise;
}
