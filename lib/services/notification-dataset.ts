import "server-only";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { NOTIFICATION_DATASET_MAX, type NTuple, type NotificationDataset } from "../notification-kind";

/**
 * Lista completă a notificărilor unui utilizator (cele mai noi 5000), compactă și comprimată — STRATUL 3 din cache (server): se construiește o singură dată pe versiune
 * și se ține în memorie; versiunea (total, necitite, cea mai nouă) se află din 3 interogări mici pe index, deci o cerere condiționată („304”) nu citește notificările.
 * Straturile din browser: memorie → IndexedDB (vezi useNotificationDataset).
 */

export type NotificationDatasetBlob = { version: string; etag: string; gz: Buffer };

/** `version` = totul (inclusiv starea citit / necitit: pentru memoria serverului); `structure` = doar total + cea mai nouă (ETag: ce se schimbă când vin / dispar notificări). */
type Version = { version: string; structure: string; total: number; unread: number };
const cache = new Map<string, NotificationDatasetBlob>();
const MAX_USERS = 200;

/** Versiunea listei: se schimbă la orice notificare nouă, citire sau ștergere. Ieftină (3 interogări pe index). */
export async function notificationVersion(userId: string): Promise<Version> {
  if (DEMO) return { version: "demo", structure: "demo", total: 0, unread: 0 };
  const [total, unread, newest] = await Promise.all([
    prisma.notification.count({ where: { userId } }),
    prisma.notification.count({ where: { userId, read: false } }),
    prisma.notification.findFirst({ where: { userId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  const newestMs = newest?.createdAt.getTime() ?? 0;
  const h = (x: string) => createHash("sha1").update(x).digest("base64url").slice(0, 16);
  return { version: h(`${total}|${unread}|${newestMs}`), structure: h(`${total}|${newestMs}`), total, unread };
}

/** Lista compactă gzip pentru versiunea dată (din memorie dacă a mai fost construită). */
export async function getNotificationDataset(userId: string, v: Version): Promise<NotificationDatasetBlob> {
  const hit = cache.get(userId);
  if (hit && hit.version === v.version) return hit;
  const rows = DEMO
    ? []
    : await prisma.notification.findMany({
        where: { userId },
        select: { id: true, title: true, body: true, url: true, read: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: NOTIFICATION_DATASET_MAX,
      });
  const tuples: NTuple[] = rows.map((r) => [r.id, r.createdAt.getTime(), r.read ? 1 : 0, r.title, r.body, r.url]);
  const body: NotificationDataset = { v: 1, total: v.total, unread: v.unread, rows: tuples };
  const gz = gzipSync(Buffer.from(JSON.stringify(body), "utf8"), { level: 6 });
  const blob = { version: v.version, etag: `W/"n-${v.structure}"`, gz };
  if (cache.size >= MAX_USERS) cache.delete(cache.keys().next().value as string);
  cache.set(userId, blob);
  return blob;
}
