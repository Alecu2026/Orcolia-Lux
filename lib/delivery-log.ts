import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { after } from "next/server";
import { prisma } from "./prisma";
import { DEMO } from "./demo";

/**
 * Jurnalul trimiterilor (email, SMS, Telegram, push, notificări în aplicație). `logDelivery` se apelează din funcțiile de trimitere de nivel jos, deci prinde orice trimitere.
 * Contextul („ce fel de mesaj e”, „către cine”, „pentru ce obiect”) se pune cu `withDeliveryMeta` în jurul trimiterii și îl completează automat; cine a declanșat
 * mesajul se află singur din sesiune (acțiune a unui utilizator) sau din sursa cron / timer / bot. Jurnalul nu poate strica niciodată trimiterea: orice eroare aici e înghițită.
 */

export type DeliveryChannel = "EMAIL" | "SMS" | "TELEGRAM" | "PUSH" | "INAPP";
export type DeliveryStatus = "SENT" | "FAILED" | "SKIPPED";

export type DeliveryMeta = {
  kind?: string;
  source?: string;
  toUserId?: string | null;
  toClientId?: string | null;
  toName?: string | null;
  fromUserId?: string | null;
  fromName?: string | null;
  objectType?: string | null;
  objectId?: string | null;
  objectName?: string | null;
  campaignId?: string | null;
};

export type DeliveryEntry = DeliveryMeta & {
  channel: DeliveryChannel;
  status: DeliveryStatus;
  to?: string | null;
  fromAddr?: string | null;
  subject?: string | null;
  body?: string | null;
  bodyHtml?: string | null;
  error?: string | null;
  providerId?: string | null;
  durationMs?: number | null;
};

const als = new AsyncLocalStorage<DeliveryMeta>();

/** Rulează `fn` cu un context care se adaugă automat la fiecare trimitere făcută înăuntru (contextele imbricate se combină). */
export function withDeliveryMeta<T>(meta: DeliveryMeta, fn: () => Promise<T>): Promise<T> {
  return als.run({ ...(als.getStore() ?? {}), ...meta }, fn);
}

// Plafoane mici: clusterul de bază de date e mic și partajat, iar jurnalul crește cu fiecare mesaj trimis.
const MAX_TEXT = 8_000;
const MAX_HTML = 20_000;
/** Tipurile trimise în masă: HTML-ul e același șablon pentru toți (textul simplu rămâne), deci nu-l păstrăm de mii de ori. */
const BULK_KINDS = new Set(["payer.campaign"]);
/** Notificările în aplicație / push: titlul ajunge (textul e deja în tabelul de notificări). */
const TITLE_ONLY = new Set(["INAPP", "PUSH"]);
const cut = (v: string | null | undefined, max: number) => (v == null ? null : v.length > max ? `${v.slice(0, max)}…` : v);

/** Codurile de verificare (autentificare / resetare parolă) nu se păstrează în jurnal: cifrele din mesaj se maschează. */
function maskCodes(v: string | null | undefined): string | null {
  return v == null ? null : v.replace(/\b\d{4,8}\b/g, "••••••");
}

function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.length > 600 ? `${m.slice(0, 600)}…` : m;
}
export { errText as deliveryErrorText };

/** Cine a declanșat trimiterea: utilizatorul din sesiune (dacă suntem într-o cerere a lui), altfel nimeni (sistem / cron). */
async function sessionActor(): Promise<{ id: string; name: string } | null> {
  try {
    const { getCurrentUser } = await import("./dal");
    const u = await getCurrentUser();
    return u ? { id: u.id, name: u.name } : null;
  } catch {
    return null; // în afara unei cereri (cron, timer, bot) nu există sesiune
  }
}

export async function logDelivery(e: DeliveryEntry): Promise<void> {
  if (DEMO) return;
  try {
    const ctx = als.getStore() ?? {};
    const m = { ...ctx, ...e };
    let fromUserId = m.fromUserId ?? null;
    let fromName = m.fromName ?? null;
    let source = m.source ?? null;
    if (!fromUserId && !source) {
      const a = await sessionActor();
      if (a) {
        fromUserId = a.id;
        fromName = a.name;
        source = "web";
      }
    }
    const secret = m.kind === "verification.code";
    const data = {
      channel: e.channel,
      status: e.status,
      kind: m.kind ?? null,
      source: source ?? "system",
      toUserId: m.toUserId || null,
      toClientId: m.toClientId || null,
      toName: m.toName ?? null,
      to: e.to ?? null,
      fromUserId: fromUserId || null,
      fromName: fromName ?? (fromUserId ? null : "Sistem"),
      fromAddr: e.fromAddr ?? null,
      subject: cut(secret ? maskCodes(e.subject) : e.subject, 500),
      body: TITLE_ONLY.has(e.channel) ? null : cut(secret ? maskCodes(e.body) : e.body, MAX_TEXT),
      bodyHtml: BULK_KINDS.has(m.kind ?? "") || TITLE_ONLY.has(e.channel) ? null : cut(secret ? maskCodes(e.bodyHtml) : e.bodyHtml, MAX_HTML),
      objectType: m.objectType ?? null,
      objectId: m.objectId ?? null,
      objectName: cut(m.objectName ?? null, 300),
      campaignId: m.campaignId ?? null,
      error: cut(e.error ?? null, 1000),
      providerId: cut(e.providerId ?? null, 300),
      durationMs: e.durationMs != null ? Math.round(e.durationMs) : null,
    };
    const write = () => prisma.deliveryLog.create({ data }).then(() => undefined).catch(() => undefined);
    try {
      after(write);
    } catch {
      void write();
    }
  } catch {
    // jurnalul nu are voie să strice trimiterea
  }
}

type MailOpts = { from?: unknown; to?: unknown; subject?: unknown; text?: unknown; html?: unknown };
const addrOf = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map((x) => addrOf(x) ?? "").filter(Boolean).join(", ");
  if (typeof v === "object" && "address" in (v as object)) return String((v as { address: unknown }).address ?? "");
  return String(v);
};

/** Învelește un transport nodemailer: fiecare `sendMail` (reușit sau nu) intră în jurnal. Eroarea e aruncată mai departe neschimbată. */
export function wrapMailTransport<T extends { sendMail: (opts: never) => Promise<unknown> }>(transport: T, meta?: DeliveryMeta): T {
  const orig = transport.sendMail.bind(transport) as (opts: MailOpts) => Promise<{ messageId?: string } | undefined>;
  (transport as unknown as { sendMail: typeof orig }).sendMail = (opts: MailOpts) => (meta ? withDeliveryMeta(meta, () => send(opts)) : send(opts));
  const send = async (opts: MailOpts) => {
    const t0 = Date.now();
    const base = {
      channel: "EMAIL" as const,
      to: addrOf(opts.to),
      fromAddr: addrOf(opts.from),
      subject: typeof opts.subject === "string" ? opts.subject : null,
      body: typeof opts.text === "string" ? opts.text : null,
      bodyHtml: typeof opts.html === "string" ? opts.html : null,
    };
    try {
      const info = await orig(opts);
      await logDelivery({ ...base, status: "SENT", providerId: info?.messageId ?? null, durationMs: Date.now() - t0 });
      return info;
    } catch (err) {
      await logDelivery({ ...base, status: "FAILED", error: errText(err), durationMs: Date.now() - t0 });
      throw err;
    }
  };
  return transport;
}
