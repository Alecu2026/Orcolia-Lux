import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import type { Prisma } from "@prisma/client";
import { zonedToUtc } from "../date";
import {
  DELIVERY_ALL_CAP,
  DELIVERY_DEFAULT_PAGE_SIZE,
  DELIVERY_NEXT_CHUNK,
  DELIVERY_PAGE_SIZES,
  type DeliveryFilterState,
} from "../delivery-meta";

export type DeliveryFullRow = {
  id: string;
  channel: string;
  status: string;
  kind: string | null;
  source: string;
  toUserId: string | null;
  toClientId: string | null;
  toName: string | null;
  to: string | null;
  fromUserId: string | null;
  fromName: string | null;
  fromAddr: string | null;
  subject: string | null;
  body: string | null;
  bodyHtml: string | null;
  objectType: string | null;
  objectId: string | null;
  objectName: string | null;
  campaignId: string | null;
  error: string | null;
  providerId: string | null;
  durationMs: number | null;
  createdAt: Date;
};
/** Rândul din listă: fără HTML, cu mesajul tăiat (textul întreg se citește în pop-up). */
export type DeliveryListRow = Omit<DeliveryFullRow, "bodyHtml" | "body" | "providerId" | "fromAddr"> & { preview: string | null; hasHtml: boolean };

export type DeliveryFilter = {
  channel?: string; status?: string; kind?: string; source?: string; sender?: string; recipient?: string; objectType?: string;
  /** Restricție fixă pe tipuri (jurnalul plătitorilor): rândurile din alte tipuri nu se văd, indiferent de filtre. */
  kinds?: readonly string[];
  campaign?: string; from?: Date; to?: Date; problems?: boolean; search?: string; page?: number; pageSize?: number;
  /** Totalul se numără din nou (nu din memorie). */
  fresh?: boolean;
};

const PREVIEW = 160;
export function normalizeDeliveryPageSize(v: unknown): number {
  const n = Number(v);
  return (DELIVERY_PAGE_SIZES as readonly number[]).includes(n) ? n : DELIVERY_DEFAULT_PAGE_SIZE;
}

function buildWhere(f: DeliveryFilter): Prisma.DeliveryLogWhereInput {
  const and: Prisma.DeliveryLogWhereInput[] = [];
  if (f.channel) and.push({ channel: f.channel });
  if (f.status) and.push({ status: f.status });
  if (f.problems && !f.status) and.push({ status: { in: ["FAILED", "SKIPPED"] } });
  if (f.kind) and.push({ kind: f.kind });
  if (f.kinds?.length) and.push({ kind: { in: [...f.kinds] } });
  if (f.source) and.push(f.source === "cron" ? { source: { startsWith: "cron" } } : { source: f.source });
  if (f.sender) and.push({ fromUserId: f.sender });
  if (f.recipient) and.push({ toUserId: f.recipient });
  if (f.objectType) and.push({ objectType: f.objectType });
  if (f.campaign) and.push({ campaignId: f.campaign });
  if (f.from || f.to) and.push({ createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } });
  const s = f.search?.trim().slice(0, 80);
  if (s && s.length >= 2) {
    and.push({
      OR: [
        { to: { contains: s, mode: "insensitive" } },
        { toName: { contains: s, mode: "insensitive" } },
        { subject: { contains: s, mode: "insensitive" } },
        { body: { contains: s, mode: "insensitive" } },
        { error: { contains: s, mode: "insensitive" } },
        { objectName: { contains: s, mode: "insensitive" } },
        { fromName: { contains: s, mode: "insensitive" } },
        { providerId: { contains: s } },
        ...(/^[0-9a-f]{24}$/i.test(s) ? [{ objectId: s }, { campaignId: s }] : []),
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

const LIST_SELECT = {
  id: true, channel: true, status: true, kind: true, source: true, toUserId: true, toClientId: true, toName: true, to: true,
  fromUserId: true, fromName: true, subject: true, body: true, bodyHtml: true, objectType: true, objectId: true, objectName: true, campaignId: true,
  error: true, durationMs: true, createdAt: true,
} as const;

type ListRaw = Prisma.DeliveryLogGetPayload<{ select: typeof LIST_SELECT }>;
function toList({ body, bodyHtml, ...r }: ListRaw): DeliveryListRow {
  const text = (body ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return { ...r, preview: text ? (text.length > PREVIEW ? `${text.slice(0, PREVIEW)}…` : text) : null, hasHtml: !!bodyHtml };
}

/** Totalul pentru un filtru, ținut ~20 s (trecerea de la o pagină la alta nu numără din nou toată colecția). */
const COUNT_TTL_MS = 20_000;
const countMemo = new Map<string, { n: number; at: number }>();
async function countCached(where: Prisma.DeliveryLogWhereInput, fresh = false): Promise<number> {
  const key = JSON.stringify(where);
  const hit = countMemo.get(key);
  // „Reîmprospătează” (fresh) sare peste memorie: totalul apare exact, nu cel de acum câteva secunde
  if (!fresh && hit && Date.now() - hit.at < COUNT_TTL_MS) return hit.n;
  const n = await prisma.deliveryLog.count({ where });
  if (countMemo.size >= 40) countMemo.delete(countMemo.keys().next().value as string);
  countMemo.set(key, { n, at: Date.now() });
  return n;
}

export async function listDelivery(f: DeliveryFilter): Promise<{ items: DeliveryListRow[]; total: number; hasMore: boolean; page: number; pageSize: number; totalPages: number }> {
  const pageSize = normalizeDeliveryPageSize(f.pageSize);
  if (DEMO) return { items: [], total: 0, hasMore: false, page: 1, pageSize, totalPages: 0 };
  const where = buildWhere(f);
  const wanted = Math.max(1, Math.floor(f.page ?? 1));
  const fetchPage = (n: number) =>
    prisma.deliveryLog.findMany({ where, select: LIST_SELECT, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (n - 1) * pageSize, take: pageSize });
  let [rows, total] = await Promise.all([fetchPage(wanted), countCached(where, f.fresh)]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(wanted, totalPages);
  if (page !== wanted && total > 0) rows = await fetchPage(page);
  return { items: rows.map(toList), total, hasMore: page < totalPages, page, pageSize, totalPages };
}

/** „Toate”: bucăți cu cursor (id-ul ultimului rând primit), până la DELIVERY_ALL_CAP rânduri. */
export async function listDeliveryChunk(
  f: DeliveryFilter,
  opts: { cursor?: string; limit?: number; loaded?: number; fresh?: boolean },
): Promise<{ items: DeliveryListRow[]; total: number; nextCursor: string | null; capped: boolean }> {
  if (DEMO) return { items: [], total: 0, nextCursor: null, capped: false };
  const where = buildWhere(f);
  const cursor = opts.cursor && /^[0-9a-f]{24}$/i.test(opts.cursor) ? opts.cursor : undefined;
  const limit = Math.min(DELIVERY_NEXT_CHUNK, Math.max(1, Math.floor(opts.limit ?? 1000)));
  const take = Math.min(limit, Math.max(0, DELIVERY_ALL_CAP - (opts.loaded ?? 0)));
  const [rows, total] = await Promise.all([
    take > 0
      ? prisma.deliveryLog.findMany({ where, select: LIST_SELECT, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: take + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) })
      : Promise.resolve([] as ListRaw[]),
    // prima bucată numără proaspăt (totalul din antet să fie exact); următoarele folosesc memoria, ca totalul să rămână același cât se încarcă
    countCached(where, opts.fresh || !cursor),
  ]);
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const capped = hasMore && (opts.loaded ?? 0) + page.length >= DELIVERY_ALL_CAP;
  return { items: page.map(toList), total, nextCursor: hasMore && !capped ? (page[page.length - 1]?.id ?? null) : null, capped };
}

/** Un mesaj întreg (pop-up) + alte mesaje către același destinatar / pentru același obiect / din aceeași campanie. */
export async function getDeliveryDetail(id: string, kinds?: readonly string[]): Promise<{ row: DeliveryFullRow; sameRecipient: DeliveryListRow[]; sameObject: DeliveryListRow[]; campaign: { total: number; sent: number; failed: number; skipped: number } | null } | null> {
  if (DEMO || !/^[0-9a-f]{24}$/i.test(id)) return null;
  const row = await prisma.deliveryLog.findUnique({ where: { id } });
  if (!row) return null;
  // jurnal restricționat: un mesaj din alt tip nu există (nici măcar după id)
  if (kinds?.length && !(row.kind && kinds.includes(row.kind))) return null;
  const only: Prisma.DeliveryLogWhereInput = kinds?.length ? { kind: { in: [...kinds] } } : {};
  const recipientWhere: Prisma.DeliveryLogWhereInput | null = row.toClientId ? { toClientId: row.toClientId } : row.toUserId ? { toUserId: row.toUserId } : row.to ? { to: row.to } : null;
  const [sameRecipient, sameObject, camp] = await Promise.all([
    recipientWhere ? prisma.deliveryLog.findMany({ where: { AND: [recipientWhere, { id: { not: id } }, only] }, select: LIST_SELECT, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 12 }) : Promise.resolve([] as ListRaw[]),
    row.objectId ? prisma.deliveryLog.findMany({ where: { AND: [{ objectId: row.objectId, id: { not: id } }, only] }, select: LIST_SELECT, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 12 }) : Promise.resolve([] as ListRaw[]),
    row.campaignId ? prisma.deliveryLog.groupBy({ by: ["status"], where: { AND: [{ campaignId: row.campaignId }, only] }, _count: { _all: true } }) : Promise.resolve(null),
  ]);
  const campaign = camp
    ? { total: camp.reduce((s, g) => s + g._count._all, 0), sent: camp.find((g) => g.status === "SENT")?._count._all ?? 0, failed: camp.find((g) => g.status === "FAILED")?._count._all ?? 0, skipped: camp.find((g) => g.status === "SKIPPED")?._count._all ?? 0 }
    : null;
  return { row, sameRecipient: sameRecipient.map(toList), sameObject: sameObject.map(toList), campaign };
}

/** Câte trimiteri în ultimele 24 h, pe canal și status (rezumatul de deasupra listei); ținut ~15 s în memorie. */
const summaryMemo = new Map<string, { at: number; v: Record<string, Record<string, number>> }>();
export async function deliverySummary(kinds?: readonly string[]): Promise<Record<string, Record<string, number>>> {
  if (DEMO) return {};
  const mk = kinds?.join(",") ?? "";
  const hit = summaryMemo.get(mk);
  if (hit && Date.now() - hit.at < 15_000) return hit.v;
  const groups = await prisma.deliveryLog.groupBy({ by: ["channel", "status"], where: { createdAt: { gte: new Date(Date.now() - 86_400_000) }, ...(kinds?.length ? { kind: { in: [...kinds] } } : {}) }, _count: { _all: true } });
  const v: Record<string, Record<string, number>> = {};
  for (const g of groups) (v[g.channel] ??= {})[g.status] = g._count._all;
  summaryMemo.set(mk, { at: Date.now(), v });
  return v;
}

export async function exportDelivery(f: Omit<DeliveryFilter, "page" | "pageSize">): Promise<DeliveryFullRow[]> {
  if (DEMO) return [];
  return prisma.deliveryLog.findMany({ where: buildWhere(f), orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10_000 });
}

export function deliveryFilterFromState(s: DeliveryFilterState, page?: number, pageSize?: number, kinds?: readonly string[]): DeliveryFilter {
  return {
    kinds,
    channel: s.channel || undefined,
    status: s.status || undefined,
    // un tip ales în afara celor permise nu dă rezultate din alte tipuri: restricția fixă rămâne
    kind: s.kind && (!kinds?.length || kinds.includes(s.kind)) ? s.kind : undefined,
    source: s.source || undefined,
    sender: s.sender || undefined,
    recipient: s.recipient || undefined,
    objectType: s.objectType || undefined,
    campaign: s.campaign || undefined,
    from: s.from ? zonedToUtc(s.from, "00:00", "Europe/Bucharest") : undefined,
    to: s.to ? new Date(zonedToUtc(s.to, "23:59", "Europe/Bucharest").getTime() + 59_999) : undefined,
    problems: s.problems || undefined,
    search: s.q || undefined,
    page,
    pageSize,
  };
}
