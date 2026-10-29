// Notificările în aplicație: tipul (după adresa la care duc), forma compactă (tuplu) a listei și valorile partajate între server, API și inbox (cod fără server-only).

export const NOTIFICATION_KINDS = ["tasks", "tickets", "appointments", "meters", "payers", "invoices", "projects", "clients", "calls"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Prefixele adreselor, pe tip (filtrele „Sarcini / Cereri / Programări / …”). */
export const KIND_PREFIXES: Record<NotificationKind, string[]> = {
  tasks: ["/tasks"],
  tickets: ["/tickets"],
  appointments: ["/appointments", "/calendar"],
  meters: ["/contoare"],
  payers: ["/platitori", "/notificari-platitori"],
  invoices: ["/invoices"],
  projects: ["/projects"],
  clients: ["/clients"],
  calls: ["/pbx"],
};

export const isNotificationKind = (v: unknown): v is NotificationKind => typeof v === "string" && (NOTIFICATION_KINDS as readonly string[]).includes(v);

/** Tipul unei notificări după adresa ei (null = altceva). */
export function kindOfNotification(url: string | null): NotificationKind | null {
  if (!url) return null;
  for (const k of NOTIFICATION_KINDS) if (KIND_PREFIXES[k].some((p) => url === p || url.startsWith(`${p}/`) || url.startsWith(`${p}?`))) return k;
  return null;
}

/** Reamintirile și întârzierile (titlul începe cu 🔔 / ⏰): filtrul „Remindere”. */
export const isReminderNotification = (title: string): boolean => /^(🔔|⏰)/.test(title);

/** Id-ul sarcinii / cererii dintr-o adresă „/tasks/<id>” sau „/tickets/<id>”; id-ul programării din „/appointments?id=<id>”. */
export function objectIdOfUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/^\/(?:tasks|tickets)\/([0-9a-f]{24})(?:[/?#]|$)/i) ?? url.match(/^\/appointments\?(?:.*&)?id=([0-9a-f]{24})(?:&|$)/i);
  return m ? m[1] : null;
}

export type FeedItem = {
  id: string;
  title: string;
  body: string | null;
  url: string | null;
  taskId: string | null;
  read: boolean;
  /** ISO */
  createdAt: string;
};

/** `etag`: versiunea structurii listei după aceste notificări (doar la „ce e nou”), ca lista din browser să nu fie descărcată din nou imediat după ele. */
export type FeedResponse = { items: FeedItem[]; unread: number; hasMore: boolean; etag?: string };

// ── Lista completă, compactă: [id, momentul (ms), citită (0/1), titlu, mesaj, adresă] ───────────────────────────────────────────────────────────────
export type NTuple = [string, number, 0 | 1, string, string | null, string | null];

/** Câte notificări (cele mai noi) ajung în lista din browser. */
export const NOTIFICATION_DATASET_MAX = 5000;

export type NotificationDataset = { v: 1; total: number; unread: number; rows: NTuple[] };

export const toTuple = (i: FeedItem): NTuple => [i.id, Date.parse(i.createdAt), i.read ? 1 : 0, i.title, i.body, i.url];

export type NRow = {
  id: string;
  /** momentul, în ms */
  t: number;
  read: boolean;
  title: string;
  body: string | null;
  url: string | null;
  kind: NotificationKind | null;
  reminder: boolean;
  /** Ziua („YYYY-MM-DD”, ora României) pentru grupare / filtrul pe perioadă. */
  day: string;
  /** Text de căutare (litere mici). */
  _h: string;
};

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit" });
export const notificationDay = (ms: number): string => dayFmt.format(ms);

export function decodeNotifications(tuples: NTuple[]): NRow[] {
  return tuples.map((x) => ({
    id: x[0],
    t: x[1],
    read: x[2] === 1,
    title: x[3],
    body: x[4],
    url: x[5],
    kind: kindOfNotification(x[5]),
    reminder: isReminderNotification(x[3]),
    day: notificationDay(x[1]),
    _h: `${x[3]}\n${x[4] ?? ""}`.toLowerCase(),
  }));
}
