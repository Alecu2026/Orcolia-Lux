import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { KIND_PREFIXES, type FeedItem, type FeedResponse, type NotificationKind } from "../notification-kind";
import type { Prisma } from "@prisma/client";

export type NotificationRow = {
  id: string;
  title: string;
  body: string | null;
  url: string | null;
  read: boolean;
  createdAt: Date;
};

export async function listNotifications(userId: string, limit = 50): Promise<NotificationRow[]> {
  if (DEMO) return [];
  return prisma.notification.findMany({
    where: { userId },
    select: { id: true, title: true, body: true, url: true, read: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function listNotificationsPaged(
  userId: string,
  page: number,
  pageSize: number,
): Promise<{ items: NotificationRow[]; total: number }> {
  if (DEMO) return { items: [], total: 0 };
  const [items, total] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      select: { id: true, title: true, body: true, url: true, read: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.notification.count({ where: { userId } }),
  ]);
  return { items, total };
}

export async function unreadCount(userId: string): Promise<number> {
  if (DEMO) return 0;
  return prisma.notification.count({ where: { userId, read: false } });
}

/**
 * Fluxul de notificări (inbox): cele mai noi primele, cu filtre (tip, doar necitite) și două direcții — `after` (apar notificări noi) și `before` (derulare spre cele vechi).
 * `unread` = totalul necitit al utilizatorului (nu doar al filtrului), pentru clopoțel.
 */
export async function listNotificationFeed(
  userId: string,
  opts: { before?: Date | null; after?: Date | null; kind?: NotificationKind | null; unreadOnly?: boolean; limit?: number },
): Promise<FeedResponse> {
  if (DEMO) return { items: [], unread: 0, hasMore: false };
  const limit = Math.min(50, Math.max(1, opts.limit ?? 30));
  const where: Prisma.NotificationWhereInput = { userId };
  if (opts.unreadOnly) where.read = false;
  if (opts.kind) where.OR = KIND_PREFIXES[opts.kind].map((p) => ({ url: { startsWith: p } }));
  const range: Prisma.DateTimeFilter = {};
  if (opts.before) range.lt = opts.before;
  if (opts.after) range.gt = opts.after;
  if (opts.before || opts.after) where.createdAt = range;
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      select: { id: true, title: true, body: true, url: true, taskId: true, read: true, createdAt: true },
      // `after`: de la cea mai veche nouă (ca să nu se piardă niciuna dacă sunt mai multe decât limita); altfel cele mai noi primele
      orderBy: { createdAt: opts.after ? "asc" : "desc" },
      take: limit + 1,
    }),
    unreadCount(userId),
  ]);
  const hasMore = rows.length > limit;
  const items: FeedItem[] = rows.slice(0, limit).map((r) => ({ id: r.id, title: r.title, body: r.body, url: r.url, taskId: r.taskId, read: r.read, createdAt: r.createdAt.toISOString() }));
  if (opts.after) items.reverse(); // în inbox: cele mai noi primele
  return { items, unread, hasMore };
}
