import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import type { Prisma } from "@prisma/client";
import { zonedToUtc } from "../date";
import { AUDIT_ALL_CAP, AUDIT_NEXT_CHUNK, AUDIT_PAGE_SIZES, AUDIT_DEFAULT_PAGE_SIZE, type AuditFilterState } from "../audit-meta";

export type AuditLogRow = {
  id: string;
  userId: string | null;
  userName: string;
  userRole: string;
  action: string;
  module: string;
  objectId: string | null;
  objectName: string | null;
  oldValue: string | null;
  newValue: string | null;
  ip: string | null;
  userAgent: string | null;
  details: string | null;
  path: string | null;
  createdAt: Date;
};

/** Rândul din listă: valorile lungi sunt tăiate (textul întreg se citește în pop-up). */
export type AuditListRow = Omit<AuditLogRow, "userAgent" | "details" | "path"> & { hasDetails: boolean };

export type AuditFilter = {
  userId?: string;
  role?: string; // "ADMIN" | "STAFF" | "SUPER"
  action?: string;
  module?: string;
  from?: Date;
  to?: Date;
  /** Caută în utilizator, obiect, IP și valorile veche / nouă. */
  search?: string;
  /** Doar jurnalele cu modificări pe câmpuri. */
  withChanges?: boolean;
  page?: number;
  pageSize?: number;
  /** Totalul se numără din nou (nu din memorie). */
  fresh?: boolean;
};

const LIST_CLIP = 260;

export function normalizeAuditPageSize(v: unknown): number {
  const n = Number(v);
  return (AUDIT_PAGE_SIZES as readonly number[]).includes(n) ? n : AUDIT_DEFAULT_PAGE_SIZE;
}

function buildWhere(filter: AuditFilter): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = [];
  if (filter.userId) and.push({ userId: filter.userId });
  if (filter.role) and.push({ userRole: { contains: filter.role, mode: "insensitive" } });
  if (filter.action) and.push({ action: filter.action });
  if (filter.module) and.push({ module: filter.module });
  if (filter.from || filter.to) {
    and.push({ createdAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } });
  }
  if (filter.withChanges) and.push({ details: { not: null } });
  const s = filter.search?.trim().slice(0, 80);
  if (s && s.length >= 2) {
    and.push({
      OR: [
        { objectName: { contains: s, mode: "insensitive" } },
        { userName: { contains: s, mode: "insensitive" } },
        { ip: { contains: s } },
        { oldValue: { contains: s, mode: "insensitive" } },
        { newValue: { contains: s, mode: "insensitive" } },
        { objectId: s.length === 24 ? s : "__none__" },
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

const clip = (v: string | null) => (v && v.length > LIST_CLIP ? `${v.slice(0, LIST_CLIP)}…` : v);

const LIST_SELECT = {
  id: true, userId: true, userName: true, userRole: true, action: true, module: true, objectId: true, objectName: true,
  oldValue: true, newValue: true, ip: true, createdAt: true,
  // doar ca să știm dacă pop-up-ul are ce arăta în plus (nu trimitem textul în listă)
  details: true,
} as const;

/**
 * Totalul pentru un filtru, ținut în memorie ~20 s: trecerea de la o pagină la alta (același filtru) nu mai numără din nou toată colecția.
 * Un jurnal nou apărut între timp întârzie cel mult 20 s în total — rândurile în sine vin mereu proaspete.
 */
const COUNT_TTL_MS = 20_000;
const countMemo = new Map<string, { n: number; at: number }>();
async function countCached(where: Prisma.AuditLogWhereInput, fresh = false): Promise<number> {
  const key = JSON.stringify(where);
  const hit = countMemo.get(key);
  // „Reîmprospătează” (fresh) sare peste memorie: totalul apare exact, nu cel de acum câteva secunde
  if (!fresh && hit && Date.now() - hit.at < COUNT_TTL_MS) return hit.n;
  const n = await prisma.auditLog.count({ where });
  if (countMemo.size >= 40) countMemo.delete(countMemo.keys().next().value as string);
  countMemo.set(key, { n, at: Date.now() });
  return n;
}

/**
 * „Toate”: jurnalele aduse pe bucăți, cu cursor (id-ul ultimului jurnal primit) — fiecare bucată costă la fel, oricât de adânc ai fi în listă
 * (spre deosebire de `skip`, care numără rândurile sărite). Se oprește la AUDIT_ALL_CAP jurnale.
 */
export async function listAuditChunk(
  filter: AuditFilter,
  opts: { cursor?: string; limit?: number; loaded?: number; fresh?: boolean },
): Promise<{ items: AuditListRow[]; total: number; nextCursor: string | null; capped: boolean }> {
  if (DEMO) return { items: [], total: 0, nextCursor: null, capped: false };
  const where = buildWhere(filter);
  const cursor = opts.cursor && /^[0-9a-f]{24}$/i.test(opts.cursor) ? opts.cursor : undefined;
  const limit = Math.min(AUDIT_NEXT_CHUNK, Math.max(1, Math.floor(opts.limit ?? 1000)));
  const room = Math.max(0, AUDIT_ALL_CAP - (opts.loaded ?? 0));
  const take = Math.min(limit, room);
  const [rows, total] = await Promise.all([
    take > 0
      ? prisma.auditLog.findMany({
          where,
          select: LIST_SELECT,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: take + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        })
      : Promise.resolve([]),
    // prima bucată numără proaspăt (totalul din antet să fie exact); următoarele folosesc memoria, ca totalul să rămână același cât se încarcă
    countCached(where, opts.fresh || !cursor),
  ]);
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const items = page.map(({ details, ...r }): AuditListRow => ({ ...r, oldValue: clip(r.oldValue), newValue: clip(r.newValue), hasDetails: !!details }));
  const loaded = (opts.loaded ?? 0) + items.length;
  const capped = hasMore && loaded >= AUDIT_ALL_CAP;
  return { items, total, nextCursor: hasMore && !capped ? (page[page.length - 1]?.id ?? null) : null, capped };
}

/** O pagină de jurnale (cele mai noi primele) + totalul pentru paginare. Citește doar coloanele din listă. */
export async function listAuditLogs(
  filter: AuditFilter,
): Promise<{ items: AuditListRow[]; total: number; hasMore: boolean; page: number; pageSize: number; totalPages: number }> {
  const pageSize = normalizeAuditPageSize(filter.pageSize);
  if (DEMO) return { items: [], total: 0, hasMore: false, page: 1, pageSize, totalPages: 0 };
  const where = buildWhere(filter);
  const wanted = Math.max(1, Math.floor(filter.page ?? 1));

  const fetchPage = (n: number) =>
    prisma.auditLog.findMany({
      where,
      select: LIST_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (n - 1) * pageSize,
      take: pageSize,
    });
  let [rows, total] = await Promise.all([fetchPage(wanted), countCached(where, filter.fresh)]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(wanted, totalPages);
  // pagină peste ultima (ex. link vechi, sau filtre care au redus rezultatele): se întoarce ultima pagină, nu una goală
  if (page !== wanted && total > 0) rows = await fetchPage(page);
  const items = rows.map(({ details, ...r }): AuditListRow => ({ ...r, oldValue: clip(r.oldValue), newValue: clip(r.newValue), hasDetails: !!details }));
  return { items, total, hasMore: page < totalPages, page, pageSize, totalPages };
}

/** Un jurnal întreg (pop-up) + ce s-a mai întâmplat cu același obiect. */
export async function getAuditLogDetail(id: string): Promise<{ row: AuditLogRow; history: AuditListRow[]; sameUser: AuditListRow[] } | null> {
  if (DEMO || !/^[0-9a-f]{24}$/i.test(id)) return null;
  const row = await prisma.auditLog.findUnique({ where: { id } });
  if (!row) return null;
  const toList = ({ details, userAgent: _ua, path: _p, ...r }: AuditLogRow): AuditListRow => {
    void _ua; void _p;
    return { ...r, oldValue: clip(r.oldValue), newValue: clip(r.newValue), hasDetails: !!details };
  };
  const [history, sameUser] = await Promise.all([
    row.objectId
      ? prisma.auditLog.findMany({ where: { objectId: row.objectId, id: { not: id } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 15 })
      : Promise.resolve([] as AuditLogRow[]),
    // ce a mai făcut aceeași persoană în jurul acelui moment (±10 minute)
    row.userId
      ? prisma.auditLog.findMany({
          where: { userId: row.userId, id: { not: id }, createdAt: { gte: new Date(row.createdAt.getTime() - 600_000), lte: new Date(row.createdAt.getTime() + 600_000) } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 10,
        })
      : Promise.resolve([] as AuditLogRow[]),
  ]);
  return { row, history: history.map(toList), sameUser: sameUser.map(toList) };
}

export async function exportAuditLogs(filter: Omit<AuditFilter, "page" | "pageSize">): Promise<AuditLogRow[]> {
  if (DEMO) return [];
  return prisma.auditLog.findMany({ where: buildWhere(filter), orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10_000 });
}

/** Starea filtrelor din adresă / API → filtrul pentru baza de date (zilele se socotesc în fusul firmei: 00:00 – 23:59:59). */
export function filterFromState(f: AuditFilterState, page?: number, pageSize?: number): AuditFilter {
  const dayEnd = f.to ? new Date(zonedToUtc(f.to, "23:59", "Europe/Bucharest").getTime() + 59_999) : undefined;
  return {
    userId: f.user || undefined,
    role: f.role || undefined,
    action: f.action || undefined,
    module: f.module || undefined,
    from: f.from ? zonedToUtc(f.from, "00:00", "Europe/Bucharest") : undefined,
    to: dayEnd,
    search: f.q || undefined,
    withChanges: f.changes || undefined,
    page,
    pageSize,
  };
}

/** Toți utilizatorii (și cei dezactivați / cu jurnale vechi) pentru filtrul „Utilizator”. */
export async function auditUserOptions(): Promise<{ id: string; name: string }[]> {
  if (DEMO) return [];
  return prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
}
