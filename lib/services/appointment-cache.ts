import "server-only";
import { gzipSync } from "node:zlib";
import { unstable_cache } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { DEMO, demoAppointments } from "../demo";
import { apptEpoch, lookupEpoch } from "../lookup-memory";
import { LIST_SELECT, type AppointmentListItem } from "../queries/appointments";
import { toVM } from "../view";
import { APPT_MONTH_RE, encodeAppt, type ApptMonth, type ApptPayload } from "../appt-snapshot";

/**
 * Programările unui utilizator (create de el SAU în care e „pentru"), pe luni — ca să nu încarce toată istoria la fiecare deschidere a paginii (cresc cu anii):
 *
 *  - MANIFEST: lunile cu programări + câte are fiecare + versiunea (număr + ultima modificare), dintr-o singură agregare în baza de date; ținut în memorie până la prima scriere pe Appointment;
 *  - LUNA: snapshot-ul unei luni (tupluri compacte, gzip), construit la cerere și ținut în memorie pe (utilizator, lună, versiune) — versiunea o știm din manifest, deci
 *    browserul care are deja luna aceea (IndexedDB) nu cere nimic, iar o lună veche, neatinsă, nu se mai reconstruiește niciodată;
 *  - FEREASTRA: programările apropiate (azi ± câteva zile) pentru prima afișare, direct din baza de date (index pe utilizator + dată).
 *
 * Orice scriere pe Appointment (și orice scriere pe User — numele) golește manifestele din memorie (vezi extensia Prisma din lib/prisma.ts). Memoria stă în globalThis
 * (pachetele Next de producție nu partajează variabilele de modul). La mai multe procese, un manifest poate fi vechi cel mult `MANIFEST_TTL_MS`.
 */

const MANIFEST_TTL_MS = 60_000;
const NAMES_TTL_MS = 30_000;
const SHARDS_MAX = 300;
const WINDOW_CAP = 400;

type Manifest = { at: number; epoch: number; months: ApptMonth[] };
type Shard = { gz: Buffer; version: string };
type State = {
  manifests: Map<string, Manifest>;
  loading: Map<string, Promise<ApptMonth[]>>;
  shards: Map<string, Shard>;
  building: Map<string, Promise<Shard>>;
  names: { at: number; epoch: number; map: Map<string, string> } | null;
  namesLoading: Promise<Map<string, string>> | null;
};
const g = globalThis as unknown as { __apptCache?: State };
const S: State = (g.__apptCache ??= { manifests: new Map(), loading: new Map(), shards: new Map(), building: new Map(), names: null, namesLoading: null });

async function userNames(): Promise<Map<string, string>> {
  const epoch = apptEpoch();
  if (S.names && S.names.epoch === epoch && Date.now() - S.names.at < NAMES_TTL_MS) return S.names.map;
  if (!S.namesLoading) {
    S.namesLoading = prisma.user
      .findMany({ select: { id: true, name: true } })
      .then((rows) => {
        const map = new Map(rows.map((u) => [u.id, u.name]));
        S.names = { at: Date.now(), epoch, map };
        return map;
      })
      .finally(() => {
        S.namesLoading = null;
      });
  }
  return S.namesLoading;
}

/**
 * „Ale mele" = create de mine SAU în care sunt „pentru". Un singur `$or` nu folosește bine indexele (userId + dată, assigneeId + dată): două interogări paralele, fiecare pe indexul ei,
 * cu a doua fără programările create de mine (ca cele create de mine și asignate tot mie să nu apară de două ori).
 */
const partsOf = (userId: string): Prisma.AppointmentWhereInput[] => [{ userId }, { assigneeId: userId, userId: { not: userId } }];

/** Id → nume pentru toți utilizatorii (și cei dezactivați), în memorie ~30 s; se golește la orice scriere pe User. */
export async function getUserNameMap(): Promise<Record<string, string>> {
  return Object.fromEntries(await userNames());
}

/** Utilizatorii activi (cu rol și permisiuni), pentru lista „Pentru" a programărilor; cache între cereri, golit odată cu lista de utilizatori (eticheta „users"). */
export const apptPeople = unstable_cache(
  async () => prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, role: true, permissions: true } }),
  ["appt-people"],
  { tags: ["users"], revalidate: 300 },
);

const ms = (v: unknown): number => {
  if (v && typeof v === "object") {
    const d = (v as { $date?: unknown }).$date;
    if (typeof d === "string") return Date.parse(d) || 0;
    if (typeof d === "number") return d;
    if (d && typeof d === "object") return Number((d as { $numberLong?: string }).$numberLong) || 0;
  }
  return typeof v === "string" ? Date.parse(v) || 0 : 0;
};

/** Lunile utilizatorului (cea mai recentă prima). O singură agregare; în memorie până la următoarea scriere pe Appointment. */
export async function getApptManifest(userId: string): Promise<ApptMonth[]> {
  if (DEMO) return [];
  const hit = S.manifests.get(userId);
  if (hit && hit.epoch === apptEpoch() && Date.now() - hit.at < MANIFEST_TTL_MS) return hit.months;
  const flying = S.loading.get(userId);
  if (flying) return flying;
  const epoch = apptEpoch();
  const p = (async () => {
    const group = { $group: { _id: { $substrBytes: ["$dateKey", 0, 7] }, n: { $sum: 1 }, u: { $max: "$updatedAt" } } };
    const [a, b] = (await Promise.all([
      prisma.appointment.aggregateRaw({ pipeline: [{ $match: { userId: { $oid: userId } } }, group] }),
      prisma.appointment.aggregateRaw({ pipeline: [{ $match: { assigneeId: { $oid: userId }, userId: { $ne: { $oid: userId } } } }, group] }),
    ])) as unknown as { _id: string | null; n: number; u: unknown }[][];
    const acc = new Map<string, { n: number; u: number }>();
    for (const r of [...a, ...b]) {
      if (!r._id || !APPT_MONTH_RE.test(r._id)) continue;
      const cur = acc.get(r._id) ?? { n: 0, u: 0 };
      acc.set(r._id, { n: cur.n + r.n, u: Math.max(cur.u, ms(r.u)) });
    }
    const months = [...acc.entries()]
      .map(([month, v]) => ({ month, count: v.n, version: `${v.n}.${v.u.toString(36)}` }))
      .sort((x, y) => y.month.localeCompare(x.month));
    if (epoch === apptEpoch()) {
      S.manifests.set(userId, { at: Date.now(), epoch, months });
      if (S.manifests.size > 2000) S.manifests.delete(S.manifests.keys().next().value as string);
    }
    return months;
  })().finally(() => {
    S.loading.delete(userId);
  });
  S.loading.set(userId, p);
  return p;
}

/** Programările apropiate (de la `fromKey` la `toKey`, cele mai multe `WINDOW_CAP`), pentru prima afișare a paginii. */
export async function listApptWindow(userId: string, fromKey: string, toKey: string): Promise<AppointmentListItem[]> {
  if (DEMO) return demoAppointments();
  const parts = await Promise.all(
    partsOf(userId).map((w) =>
      prisma.appointment.findMany({ where: { AND: [w, { dateKey: { gte: fromKey, lte: toKey } }] }, select: LIST_SELECT, orderBy: { startAt: "desc" }, take: WINDOW_CAP }),
    ),
  );
  return parts.flat().sort((x, y) => y.startAt.getTime() - x.startAt.getTime()).slice(0, WINDOW_CAP);
}

/** Snapshot-ul unei luni (varianta comprimată + versiunea din manifest); null dacă utilizatorul n-are programări în luna aceea. */
export async function getApptShard(userId: string, tz: string, month: string): Promise<Shard | null> {
  if (DEMO || !APPT_MONTH_RE.test(month)) return null;
  const info = (await getApptManifest(userId)).find((m) => m.month === month);
  if (!info) return null;
  const key = `${userId}|${tz}|${month}|${info.version}|${lookupEpoch()}`; // numele schimbate (utilizatori) refac luna
  const hit = S.shards.get(key);
  if (hit) {
    S.shards.delete(key);
    S.shards.set(key, hit); // cel mai recent folosit
    return hit;
  }
  let b = S.building.get(key);
  if (!b) {
    b = (async () => {
      const [parts, names] = await Promise.all([
        Promise.all(
          partsOf(userId).map((w) =>
            prisma.appointment.findMany({ where: { AND: [w, { dateKey: { gte: `${month}-01`, lte: `${month}-31` } }] }, select: LIST_SELECT, orderBy: { startAt: "asc" } }),
          ),
        ),
        userNames(),
      ]);
      const rows = parts.flat().sort((x, y) => x.startAt.getTime() - y.startAt.getTime());
      const nameObj = Object.fromEntries(names);
      const used: Record<string, string> = {};
      const tuples = rows.map((a) => {
        const vm = toVM(a, tz, nameObj);
        if (vm.creatorId && nameObj[vm.creatorId]) used[vm.creatorId] = nameObj[vm.creatorId];
        if (vm.assigneeId && nameObj[vm.assigneeId]) used[vm.assigneeId] = nameObj[vm.assigneeId];
        return encodeAppt(vm);
      });
      const payload: ApptPayload = { v: 1, month, names: used, rows: tuples };
      const gz = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 6 });
      const shard: Shard = { gz, version: info.version }; // ETag = versiunea din manifest: o lună neschimbată primește 304 fără să se mai construiască
      S.shards.set(key, shard);
      while (S.shards.size > SHARDS_MAX) S.shards.delete(S.shards.keys().next().value as string);
      return shard;
    })().finally(() => {
      S.building.delete(key);
    });
    S.building.set(key, b);
  }
  return b;
}
