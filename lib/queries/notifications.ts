import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";

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
