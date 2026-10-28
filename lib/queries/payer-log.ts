import "server-only";
import type { PayerNotificationLog, Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { DELIVERY_ALL_CAP, DELIVERY_NEXT_CHUNK } from "../delivery-meta";
import { normalizeDeliveryPageSize, type DeliveryFilter, type DeliveryFullRow, type DeliveryListRow } from "./delivery";

/**
 * Jurnalul „Notificări plătitori”: TOATE trimiterile făcute din pagina Notificări plătitori (email, SMS, apel vocal), așa cum se salvează în PayerNotificationLog —
 * istoricul permanent (fără ștergere automată), cu cine a trimis, către cine, mesajul și rezultatul. Rândurile se prezintă în aceeași formă ca jurnalul
 * general (DeliveryListRow / DeliveryFullRow), deci aceeași interfață (filtre, pop-up, „Toate” pe bucăți, export) se folosește pentru ambele.
 */

const PREVIEW = 160;

const toFull = (r: PayerNotificationLog): DeliveryFullRow => ({
  id: r.id,
  channel: r.channel,
  status: r.status,
  kind: "payer.campaign",
  source: "web",
  toUserId: null,
  toClientId: r.clientId,
  toName: r.clientName,
  to: r.to,
  fromUserId: r.userId,
  fromName: r.userName,
  fromAddr: null,
  subject: r.subject,
  body: r.body,
  bodyHtml: null,
  objectType: "client",
  objectId: r.clientId,
  objectName: r.clientName,
  campaignId: r.campaignId,
  error: r.error,
  providerId: null,
  durationMs: null,
  createdAt: r.createdAt,
});

function toList(r: PayerNotificationLog): DeliveryListRow {
  const { body, bodyHtml, providerId, fromAddr, ...rest } = toFull(r);
  void bodyHtml;
  void providerId;
  void fromAddr;
  const text = (body ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return { ...rest, preview: text ? (text.length > PREVIEW ? `${text.slice(0, PREVIEW)}…` : text) : null, hasHtml: false };
}

function buildWhere(f: DeliveryFilter): Prisma.PayerNotificationLogWhereInput {
  const and: Prisma.PayerNotificationLogWhereInput[] = [];
  if (f.channel) and.push({ channel: f.channel });
  if (f.status) and.push({ status: f.status });
  if (f.problems && !f.status) and.push({ status: { not: "SENT" } });
  if (f.sender) and.push({ userId: f.sender });
  if (f.campaign) and.push({ campaignId: f.campaign });
  if (f.from || f.to) and.push({ createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } });
  const s = f.search?.trim().slice(0, 80);
  if (s && s.length >= 2) {
    and.push({
      OR: [
        { clientName: { contains: s, mode: "insensitive" } },
        { to: { contains: s, mode: "insensitive" } },
        { subject: { contains: s, mode: "insensitive" } },
        { body: { contains: s, mode: "insensitive" } },
        { error: { contains: s, mode: "insensitive" } },
        { userName: { contains: s, mode: "insensitive" } },
        ...(/^[0-9a-f]{24}$/i.test(s) ? [{ clientId: s }] : []),
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

const COUNT_TTL_MS = 20_000;
const countMemo = new Map<string, { n: number; at: number }>();
async function countCached(where: Prisma.PayerNotificationLogWhereInput, fresh = false): Promise<number> {
  const key = JSON.stringify(where);
  const hit = countMemo.get(key);
  if (!fresh && hit && Date.now() - hit.at < COUNT_TTL_MS) return hit.n;
  const n = await prisma.payerNotificationLog.count({ where });
  if (countMemo.size >= 40) countMemo.delete(countMemo.keys().next().value as string);
  countMemo.set(key, { n, at: Date.now() });
  return n;
}

const ORDER = [{ createdAt: "desc" }, { id: "desc" }] as const;

export async function listPayerLog(f: DeliveryFilter): Promise<{ items: DeliveryListRow[]; total: number; hasMore: boolean; page: number; pageSize: number; totalPages: number }> {
  const pageSize = normalizeDeliveryPageSize(f.pageSize);
  if (DEMO) return { items: [], total: 0, hasMore: false, page: 1, pageSize, totalPages: 0 };
  const where = buildWhere(f);
  const wanted = Math.max(1, Math.floor(f.page ?? 1));
  const fetchPage = (n: number) => prisma.payerNotificationLog.findMany({ where, orderBy: [...ORDER], skip: (n - 1) * pageSize, take: pageSize });
  let [rows, total] = await Promise.all([fetchPage(wanted), countCached(where, f.fresh)]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(wanted, totalPages);
  if (page !== wanted && total > 0) rows = await fetchPage(page);
  return { items: rows.map(toList), total, hasMore: page < totalPages, page, pageSize, totalPages };
}

/** „Toate”: bucăți cu cursor (id-ul ultimului rând primit), până la DELIVERY_ALL_CAP rânduri. */
export async function listPayerLogChunk(
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
      ? prisma.payerNotificationLog.findMany({ where, orderBy: [...ORDER], take: take + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) })
      : Promise.resolve([] as PayerNotificationLog[]),
    countCached(where, opts.fresh || !cursor),
  ]);
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const capped = hasMore && (opts.loaded ?? 0) + page.length >= DELIVERY_ALL_CAP;
  return { items: page.map(toList), total, nextCursor: hasMore && !capped ? (page[page.length - 1]?.id ?? null) : null, capped };
}

export async function getPayerLogDetail(id: string): Promise<{ row: DeliveryFullRow; sameRecipient: DeliveryListRow[]; sameObject: DeliveryListRow[]; campaign: { total: number; sent: number; failed: number; skipped: number } | null } | null> {
  if (DEMO || !/^[0-9a-f]{24}$/i.test(id)) return null;
  const row = await prisma.payerNotificationLog.findUnique({ where: { id } });
  if (!row) return null;
  const [sameRecipient, camp] = await Promise.all([
    prisma.payerNotificationLog.findMany({ where: { clientId: row.clientId, id: { not: id } }, orderBy: [...ORDER], take: 12 }),
    prisma.payerNotificationLog.groupBy({ by: ["status"], where: { campaignId: row.campaignId }, _count: { _all: true } }),
  ]);
  const n = (s: string) => camp.find((g) => g.status === s)?._count._all ?? 0;
  return {
    row: toFull(row),
    sameRecipient: sameRecipient.map(toList),
    sameObject: [],
    campaign: { total: camp.reduce((a, g) => a + g._count._all, 0), sent: n("SENT"), failed: n("FAILED"), skipped: n("SKIPPED") },
  };
}

/** Câte trimiteri în ultimele 24 h, pe canal și status (rezumatul de deasupra listei); ținut ~15 s în memorie. */
let summaryMemo: { at: number; v: Record<string, Record<string, number>> } | null = null;
export async function payerLogSummary(): Promise<Record<string, Record<string, number>>> {
  if (DEMO) return {};
  if (summaryMemo && Date.now() - summaryMemo.at < 15_000) return summaryMemo.v;
  const groups = await prisma.payerNotificationLog.groupBy({ by: ["channel", "status"], where: { createdAt: { gte: new Date(Date.now() - 86_400_000) } }, _count: { _all: true } });
  const v: Record<string, Record<string, number>> = {};
  for (const g of groups) (v[g.channel] ??= {})[g.status] = g._count._all;
  summaryMemo = { at: Date.now(), v };
  return v;
}

export async function exportPayerLog(f: Omit<DeliveryFilter, "page" | "pageSize">): Promise<DeliveryFullRow[]> {
  if (DEMO) return [];
  const rows = await prisma.payerNotificationLog.findMany({ where: buildWhere(f), orderBy: [...ORDER], take: 10_000 });
  return rows.map(toFull);
}
