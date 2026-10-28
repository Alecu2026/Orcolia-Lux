// Constante și funcții partajate pentru Jurnalul notificărilor (folosite și pe server, și în browser).

export const DELIVERY_CHANNELS = ["EMAIL", "SMS", "TELEGRAM", "PUSH", "INAPP"] as const;
export type DeliveryChannelKey = (typeof DELIVERY_CHANNELS)[number];
export const CHANNEL_LABEL: Record<string, string> = { EMAIL: "Email", SMS: "SMS", TELEGRAM: "Telegram", PUSH: "Push", INAPP: "În aplicație" };
export const CHANNEL_ICON: Record<string, string> = { EMAIL: "✉️", SMS: "💬", TELEGRAM: "✈️", PUSH: "🔔", INAPP: "📥" };

export const DELIVERY_STATUSES = ["SENT", "FAILED", "SKIPPED"] as const;
export const STATUS_LABEL: Record<string, string> = { SENT: "Trimis", FAILED: "Eșuat", SKIPPED: "Omis" };
export const STATUS_CLS: Record<string, string> = {
  SENT: "bg-st-done/12 text-st-done",
  FAILED: "bg-st-cancelled/12 text-st-cancelled",
  SKIPPED: "bg-st-progress/15 text-st-progress",
};
export const CHANNEL_CLS: Record<string, string> = {
  EMAIL: "bg-sky-100 text-sky-800",
  SMS: "bg-amber-100 text-amber-800",
  TELEGRAM: "bg-cyan-100 text-cyan-800",
  PUSH: "bg-purple-100 text-purple-700",
  INAPP: "bg-slate-100 text-slate-700",
};

export const KIND_LABEL: Record<string, string> = {
  "task.reminder": "Reamintire sarcină",
  "task.overdue": "Sarcină în întârziere",
  "invoice.email": "Factură pe email",
  "verification.code": "Cod de verificare",
  "appointment.reminder": "Reamintire programare",
  "payer.campaign": "Notificare plătitori",
  "payer.test": "Test notificare plătitori",
  "ticket.message": "Mesaj tichet către client",
  "ticket.ack": "Confirmare primire tichet",
  "ticket.reply": "Răspuns la tichet (email)",
  "ticket.autoclose": "Tichet închis automat",
  "app.notification": "Notificare aplicație",
};
export const KIND_OPTIONS = Object.entries(KIND_LABEL).map(([key, label]) => ({ key, label }));
export const kindLabel = (k: string | null | undefined, t: (s: string) => string = (x) => x) => (k ? t(KIND_LABEL[k] ?? k) : t("Nespecificat"));

export const SOURCE_OPTIONS = [
  { key: "web", label: "Acțiune a unui utilizator" },
  { key: "cron", label: "Cron (zilnic / reamintiri / email)" },
  { key: "timer", label: "Temporizator server" },
  { key: "bot", label: "Bot Telegram" },
  { key: "system", label: "Sistem" },
];
export function sourceLabel(src: string, t: (s: string) => string = (x) => x): string {
  if (src === "web") return t("Acțiune utilizator");
  if (src === "timer") return t("Temporizator server");
  if (src === "bot") return t("Bot Telegram");
  if (src === "cron:daily") return t("Cron zilnic");
  if (src === "cron:reminders") return t("Cron reamintiri");
  if (src === "cron:imap") return t("Cron email");
  if (src.startsWith("cron")) return t("Cron");
  return t("Sistem");
}

export const OBJECT_TYPES = [
  { key: "task", label: "Sarcină" },
  { key: "ticket", label: "Tichet" },
  { key: "invoice", label: "Factură" },
  { key: "client", label: "Plătitor / client" },
  { key: "appointment", label: "Programare" },
];

/** Link spre obiectul legat de mesaj (null = nu există pagină). */
export function deliveryObjectHref(type: string | null, id: string | null): string | null {
  if (!type || !id) return null;
  if (type === "task") return `/tasks/${id}`;
  if (type === "ticket") return `/tickets/${id}`;
  if (type === "client") return `/platitori/${id}`;
  return null;
}

/** Textul unui mesaj Telegram (HTML simplu) fără etichete, pentru citit. */
export function stripTags(s: string | null | undefined): string {
  return (s ?? "").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// ── Filtrele paginii (în adresă și în API) ──
export type DeliveryFilterState = {
  q: string;
  channel: string;
  status: string;
  kind: string;
  source: string;
  /** cine a declanșat trimiterea (utilizator) */
  sender: string;
  /** destinatar: utilizator */
  recipient: string;
  objectType: string;
  /** „YYYY-MM-DD” (ziua în fusul firmei) */
  from: string;
  to: string;
  /** doar probleme: eșuate + omise */
  problems: boolean;
  /** doar cu conținut (corp / subiect) */
  campaign: string;
};

export const EMPTY_DELIVERY_FILTERS: DeliveryFilterState = { q: "", channel: "", status: "", kind: "", source: "", sender: "", recipient: "", objectType: "", from: "", to: "", problems: false, campaign: "" };

export function sanitizeDeliveryState(raw: Record<string, unknown>): DeliveryFilterState {
  const str = (v: unknown, max = 80) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
  const oid = (v: unknown) => (/^[0-9a-f]{24}$/i.test(str(v, 30)) ? str(v, 30) : "");
  const one = (v: unknown, allowed: readonly string[]) => (allowed.includes(str(v, 40)) ? str(v, 40) : "");
  const src = str(raw.source, 30);
  return {
    q: str(raw.q),
    channel: one(raw.channel, DELIVERY_CHANNELS),
    status: one(raw.status, DELIVERY_STATUSES),
    kind: one(raw.kind, KIND_OPTIONS.map((k) => k.key)),
    source: SOURCE_OPTIONS.some((s) => s.key === src) ? src : "",
    sender: oid(raw.sender),
    recipient: oid(raw.recipient),
    objectType: one(raw.objectType, OBJECT_TYPES.map((o) => o.key)),
    from: day(raw.from),
    to: day(raw.to),
    problems: raw.problems === "1" || raw.problems === true,
    campaign: str(raw.campaign, 60).replace(/[^\w-]/g, ""),
  };
}

export function countActiveDeliveryFilters(f: DeliveryFilterState): number {
  return (f.q ? 1 : 0) + (f.channel ? 1 : 0) + (f.status ? 1 : 0) + (f.kind ? 1 : 0) + (f.source ? 1 : 0) + (f.sender ? 1 : 0) + (f.recipient ? 1 : 0) + (f.objectType ? 1 : 0) + (f.from || f.to ? 1 : 0) + (f.problems ? 1 : 0) + (f.campaign ? 1 : 0);
}

export const DELIVERY_PAGE_SIZES = [20, 50, 100, 200, 500, 1000] as const;
export const DELIVERY_DEFAULT_PAGE_SIZE = 50;
export type DeliveryPs = number | "all";
export const DELIVERY_ALL_CAP = 50_000;
export const DELIVERY_FIRST_CHUNK = 1000;
export const DELIVERY_NEXT_CHUNK = 5000;
export const DELIVERY_PS_COOKIE = "delivery-ps";
export function normalizeDeliveryPs(v: unknown): DeliveryPs {
  if (v === "all") return "all";
  const n = Number(v);
  return (DELIVERY_PAGE_SIZES as readonly number[]).includes(n) ? n : DELIVERY_DEFAULT_PAGE_SIZE;
}

export function deliveryStateToParams(f: DeliveryFilterState, extra?: { page?: number; ps?: DeliveryPs }): URLSearchParams {
  const p = new URLSearchParams();
  for (const k of ["q", "channel", "status", "kind", "source", "sender", "recipient", "objectType", "from", "to", "campaign"] as const) if (f[k]) p.set(k, f[k]);
  if (f.problems) p.set("problems", "1");
  if (extra?.page && extra.page > 1) p.set("page", String(extra.page));
  if (extra?.ps && extra.ps !== DELIVERY_DEFAULT_PAGE_SIZE) p.set("ps", String(extra.ps));
  return p;
}
