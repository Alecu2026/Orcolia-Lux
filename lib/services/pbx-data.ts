import "server-only";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { prisma } from "../prisma";
import { ensureIndex } from "../log-count";
import {
  PBX_DATASET_MAX, PBX_DELTA_MAX, PBX_HEAD_ROWS, decodeCall, decodeNotify,
  type NotifyCallRow, type NotifyTuple, type PbxCallRow, type PbxKind, type PbxPayload, type PbxTuple,
} from "../pbx-data";

/**
 * Apelurile PBX și coada de apeluri către plătitori, pentru pagina /pbx.
 *
 *  - Lista COMPLETĂ (până la `PBX_DATASET_MAX` rânduri) stă în memoria serverului ca JSON comprimat gzip, cu versiune (ETag); se reface în fundal cel mult o dată la `MAX_AGE_MS`
 *    (cine o cere între timp primește imediat versiunea existentă). Nu trebuie să fie proaspătă: browserul aduce oricum diferența.
 *  - DIFERENȚA („delta"): doar rândurile modificate după un moment dat (interogare pe indexul `updatedAt`) — de câțiva bytes, nu zeci de mii de rânduri. Un apel are 5–10 mesaje de la PBX,
 *    deci rândurile se schimbă des; din acest motiv lista nu se invalidează la fiecare scriere, ci se completează cu diferența.
 *  - `count` (numărul real de rânduri) lasă browserul să observe ștergeri făcute în altă parte și să ceară lista completă.
 * Memoria stă în globalThis (pachetele Next de producție nu partajează variabilele de modul).
 */

const MAX_AGE_MS = 5 * 60_000;
const MIN_REBUILD_MS = 15_000;
/** Rândurile modificate chiar înainte de momentul cerut se retrimit (ceasuri / scrieri în curs): aplicarea lor în browser e idempotentă. */
const OVERLAP_MS = 5000;

type Bits = { status: string | null; state: string | null; dur: number | null; rec: 0 | 1; rating: number | null };
type Snap = { version: string; builtAt: number; cursor: number; count: number; gz: Buffer; byCall: Map<string, Bits> };
type State = { snap: Snap | null; building: Promise<Snap> | null };
const g = globalThis as unknown as { __pbxData?: Record<PbxKind, State> };
const S = (g.__pbxData ??= { calls: { snap: null, building: null }, notify: { snap: null, building: null } });

const CALL_SELECT = {
  id: true, callId: true, direction: true, phone: true, phoneE164: true, diversion: true, pbxUser: true, ext: true, status: true, state: true, durationSec: true, waitSec: true,
  startAt: true, firstSeenAt: true, lastCmd: true, eventCount: true, clientId: true, clientName: true, recordingUrl: true, rating: true, groupName: true, lineName: true, note: true, updatedAt: true,
} as const;

type CallRec = {
  id: string; callId: string; direction: string | null; phone: string | null; phoneE164: string | null; diversion: string | null; pbxUser: string | null; ext: string | null; status: string | null;
  state: string | null; durationSec: number | null; waitSec: number | null; startAt: Date | null; firstSeenAt: Date; lastCmd: string | null; eventCount: number; clientId: string | null;
  clientName: string | null; recordingUrl: string | null; rating: number | null; groupName: string | null; lineName: string | null; note: string | null; updatedAt: Date;
};
const callTuple = (c: CallRec, address: string | null = null): PbxTuple => [
  c.id, c.callId, c.direction, c.phone, c.phoneE164, c.diversion, c.pbxUser, c.ext, c.status, c.state, c.durationSec, c.waitSec, (c.startAt ?? c.firstSeenAt).getTime(), c.lastCmd, c.eventCount,
  c.clientId, c.clientName, c.recordingUrl ? 1 : 0, c.rating, c.groupName, c.lineName, c.note, c.updatedAt.getTime(), address,
];

/** Adresa (de consum) a clienților potriviți cu apelurile: interogări mici, pe id, doar pentru clienții care apar în rândurile cerute. */
async function addressesFor(rows: { clientId: string | null }[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => r.clientId).filter((x): x is string => !!x))];
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 500) {
    const found = await prisma.client.findMany({ where: { id: { in: ids.slice(i, i + 500) } }, select: { id: true, consumAddress: true } });
    for (const c of found) if (c.consumAddress) out.set(c.id, c.consumAddress);
  }
  return out;
}
const bitsOf = (c: Pick<CallRec, "status" | "state" | "durationSec" | "recordingUrl" | "rating">): Bits => ({ status: c.status, state: c.state, dur: c.durationSec, rec: c.recordingUrl ? 1 : 0, rating: c.rating });

type NotifyRec = {
  id: string; campaignId: string; clientId: string; clientName: string; phone: string; text: string; createdAt: Date; dialedAt: Date | null; operator: string | null; callId: string | null;
  status: string; note: string | null; userName: string; updatedAt: Date;
};
const NOT_BITS: Bits = { status: null, state: null, dur: null, rec: 0, rating: null };
const notifyTuple = (q: NotifyRec, b: Bits | undefined): NotifyTuple => {
  const x = b ?? NOT_BITS;
  return [
    q.id, q.campaignId, q.clientId, q.clientName, q.phone, q.text, q.createdAt.getTime(), q.dialedAt ? q.dialedAt.getTime() : null, q.operator, q.callId, q.status, q.note, q.userName,
    x.status, x.state, x.dur, x.rec, x.rating, q.updatedAt.getTime(),
  ];
};

async function rawCount(collection: string): Promise<number> {
  try {
    const r = (await prisma.$runCommandRaw({ count: collection })) as { n?: number };
    return Number(r.n) || 0;
  } catch {
    return -1; // necunoscut: browserul sare peste verificarea de număr
  }
}

/** Starea apelurilor PBX pentru un set de callId (rezultatul apelului către plătitor): interogări mici, pe indexul unic callId. */
async function bitsFor(callIds: string[], into: Map<string, Bits>): Promise<void> {
  const ids = [...new Set(callIds)].filter((x) => !into.has(x));
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await prisma.pbxCall.findMany({ where: { callId: { in: ids.slice(i, i + 500) } }, select: { callId: true, status: true, state: true, durationSec: true, recordingUrl: true, rating: true } });
    for (const r of rows) into.set(r.callId, bitsOf(r));
  }
}

async function buildCalls(): Promise<Snap> {
  const startedAt = Date.now();
  const [rows, count] = await Promise.all([prisma.pbxCall.findMany({ select: CALL_SELECT, orderBy: { updatedAt: "desc" }, take: PBX_DATASET_MAX }), rawCount("PbxCall")]);
  const addr = await addressesFor(rows);
  const tuples = rows.map((r) => callTuple(r, r.clientId ? addr.get(r.clientId) ?? null : null));
  const byCall = new Map<string, Bits>();
  for (const c of rows) byCall.set(c.callId, bitsOf(c));
  return pack(startedAt, tuples, count, byCall);
}

async function buildNotify(): Promise<Snap> {
  void ensureIndex("NotifyCall", { updatedAt: 1 }, "NotifyCall_updatedAt_idx");
  // starea apelurilor PBX din lista de apeluri din memorie; cursorul = al acelei liste (diferența ulterioară corectează orice întârziere)
  const calls = await getSnap("calls");
  const [rows, count] = await Promise.all([prisma.notifyCall.findMany({ orderBy: { createdAt: "desc" }, take: PBX_DATASET_MAX }), rawCount("NotifyCall")]);
  const byCall = new Map(calls.byCall);
  const missing = rows.map((r) => r.callId).filter((x): x is string => !!x && !byCall.has(x)).slice(0, 4000);
  await bitsFor(missing, byCall);
  const tuples = rows.map((q) => notifyTuple(q, q.callId ? byCall.get(q.callId) : undefined));
  return pack(Math.min(Date.now(), calls.cursor), tuples, count, new Map());
}

function pack(cursor: number, tuples: unknown[], count: number, byCall: Map<string, Bits>): Snap {
  const gz = gzipSync(Buffer.from(JSON.stringify({ v: 1, rows: tuples, cursor, count } satisfies PbxPayload<unknown>), "utf8"), { level: 6 });
  return { version: createHash("sha1").update(gz).digest("hex").slice(0, 16), builtAt: Date.now(), cursor, count, gz, byCall };
}

/** Lista completă din memorie (cea existentă se servește imediat chiar dacă e mai veche — se reface în fundal); prima oară se așteaptă construirea. */
export async function getSnap(kind: PbxKind, fresh = false): Promise<Snap> {
  const st = S[kind];
  // `fresh`: browserul a observat o diferență (rânduri șterse, prea multe schimbări) sau a cerut explicit — se reface acum, dar nu mai des de o dată la `MIN_REBUILD_MS`
  const stale = !st.snap || Date.now() - st.snap.builtAt > (fresh ? MIN_REBUILD_MS : MAX_AGE_MS);
  if (stale && !st.building) {
    const t0 = Date.now();
    st.building = (kind === "calls" ? buildCalls() : buildNotify())
      .then((snap) => {
        st.snap = snap;
        console.log(`[pbx-data] ${kind}: ${snap.count} rânduri, ${(snap.gz.length / 1e6).toFixed(2)} MB comprimat, ${Date.now() - t0} ms`);
        return snap;
      })
      .finally(() => {
        st.building = null;
      });
  }
  if (fresh && st.building) return st.building;
  return st.snap ?? (st.building as Promise<Snap>);
}

/** Primele rânduri (cele mai recent modificate), proaspete din baza de date, pentru ca pagina să se afișeze imediat — restul vine din lista completă din browser. */
export async function callsHead(): Promise<{ rows: PbxCallRow[]; count: number }> {
  const [rows, count] = await Promise.all([prisma.pbxCall.findMany({ select: CALL_SELECT, orderBy: { updatedAt: "desc" }, take: PBX_HEAD_ROWS }), rawCount("PbxCall")]);
  const addr = await addressesFor(rows);
  return { rows: rows.map((r) => decodeCall(callTuple(r, r.clientId ? addr.get(r.clientId) ?? null : null))), count };
}

export async function notifyHead(): Promise<{ rows: NotifyCallRow[]; count: number }> {
  const [rows, count] = await Promise.all([prisma.notifyCall.findMany({ orderBy: { createdAt: "desc" }, take: PBX_HEAD_ROWS }), rawCount("NotifyCall")]);
  const bits = new Map<string, Bits>();
  await bitsFor(rows.map((r) => r.callId).filter((x): x is string => !!x), bits);
  return { rows: rows.map((q) => decodeNotify(notifyTuple(q, q.callId ? bits.get(q.callId) : undefined))), count };
}

/** Rândurile modificate după `since` (ms). Prea multe → `reset`: browserul cere lista completă. */
export async function pbxDelta(kind: PbxKind, since: number): Promise<PbxPayload<PbxTuple | NotifyTuple>> {
  const cursor = Date.now(); // luat ÎNAINTE de citire: ce se scrie în timpul citirii e retrimis data viitoare (suprapunerea)
  const from = new Date(Math.max(0, since - OVERLAP_MS));
  if (kind === "calls") {
    const [rows, count] = await Promise.all([
      prisma.pbxCall.findMany({ where: { updatedAt: { gt: from } }, select: CALL_SELECT, orderBy: { updatedAt: "asc" }, take: PBX_DELTA_MAX + 1 }),
      rawCount("PbxCall"),
    ]);
    if (rows.length > PBX_DELTA_MAX) return { v: 1, rows: [], cursor, count, reset: true };
    const addr = await addressesFor(rows);
    return { v: 1, rows: rows.map((r) => callTuple(r, r.clientId ? addr.get(r.clientId) ?? null : null)), cursor, count };
  }
  void ensureIndex("NotifyCall", { updatedAt: 1 }, "NotifyCall_updatedAt_idx");
  const [own, pbxChanged, count] = await Promise.all([
    prisma.notifyCall.findMany({ where: { updatedAt: { gt: from } }, orderBy: { updatedAt: "asc" }, take: PBX_DELTA_MAX + 1 }),
    prisma.pbxCall.findMany({ where: { updatedAt: { gt: from } }, select: { callId: true, status: true, state: true, durationSec: true, recordingUrl: true, rating: true }, take: PBX_DELTA_MAX + 1 }),
    rawCount("NotifyCall"),
  ]);
  if (own.length > PBX_DELTA_MAX || pbxChanged.length > PBX_DELTA_MAX) return { v: 1, rows: [], cursor, count, reset: true };
  // rândurile din coadă ale căror apeluri PBX s-au schimbat (rezultat, durată, înregistrare) se retrimit și ele
  const byId = new Map(own.map((q) => [q.id, q] as const));
  if (pbxChanged.length > 0) {
    const ids = pbxChanged.map((c) => c.callId);
    for (let i = 0; i < ids.length; i += 500) {
      const more = await prisma.notifyCall.findMany({ where: { callId: { in: ids.slice(i, i + 500) } } });
      for (const q of more) byId.set(q.id, q);
    }
  }
  const bits = new Map<string, Bits>(pbxChanged.map((c) => [c.callId, bitsOf(c)] as const));
  await bitsFor([...byId.values()].map((q) => q.callId).filter((x): x is string => !!x), bits);
  return { v: 1, rows: [...byId.values()].map((q) => notifyTuple(q, q.callId ? bits.get(q.callId) : undefined)), cursor, count };
}
