import "server-only";
import { invalidatePayers } from "./payer-cache";
import { prisma } from "../prisma";
import { env } from "../env";
import { logAudit } from "./audit";
import { sendPayerNotificationEmail } from "../email";
import { withDeliveryMeta } from "../delivery-log";
import { sendSms } from "../sms";
import { sendCall } from "../call-gateway";
import { openIssuesByClient } from "./meter-issues";
import { ISSUE_LABELS } from "../meter-issues";
import {
  NOTIFY_CHUNK_SIZE,
  NOTIFY_MAX_CALL_BODY,
  NOTIFY_MAX_EMAIL_BODY,
  NOTIFY_MAX_SMS_BODY,
  NOTIFY_MAX_SUBJECT,
  buildVars,
  isEmail,
  normalizePhone,
  renderTemplate,
  stripLatinDiacritics,
  usesTokens,
  type NotifyVars,
} from "../payer-notify";

/** Pagina e `maxDuration = 60` (vezi page.tsx) — un lot de 25 destinatari încape confortabil. */
const CONCURRENCY = 5;


// ── Trimitere (în loturi, apelată în buclă de client) ─────────────────────────────────────────

export type ChannelOutcome = { status: "sent" | "failed" | "skipped"; detail?: string };
export type RecipientResult = { id: string; name: string; email: ChannelOutcome; sms: ChannelOutcome; call: ChannelOutcome; /** Foaia PDF de tipărit (generată separat, vezi /api/platitori/notificari/pdf). */ pdf?: ChannelOutcome };

export type SendChunkInput = {
  /** Generat pe client, identic pentru toate loturile unei trimiteri — face retrimiterea unui lot idempotentă. */
  campaignId: string;
  /** Al câtelea lot e (0 = primul; doar atunci se scrie intrarea în Audit Logs). */
  index: number;
  /** Câți destinatari are în total campania (doar pentru Audit Logs). */
  totalPlanned: number;
  ids: string[];
  /** Cine primește: plătitorii (implicit) sau clienții obișnuiți (fără plătitori). */
  audience?: "payers" | "clients";
  email: { enabled: boolean; subject: string; body: string };
  sms: { enabled: boolean; body: string; ascii: boolean };
  call: { enabled: boolean; body: string; voice: string };
};

export type SendChunkResult = { ok: true; results: RecipientResult[] } | { ok: false; error: string };

const ID_RE = /^[0-9a-f]{24}$/i;
const CAMPAIGN_RE = /^[\w-]{8,64}$/;
export const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
export const errText = (e: unknown) => (e instanceof Error ? e.message : "Eroare necunoscută").slice(0, 200);

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

export function validateMessage(input: Pick<SendChunkInput, "email" | "sms" | "call">): string | null {
  const { email, sms, call } = input;
  if (!email.enabled && !sms.enabled && !call?.enabled) return "Alege cel puțin un canal (email, SMS sau apel).";
  if (call?.enabled) {
    if (!call.body.trim()) return "Mesajul apelului este gol.";
    if (call.body.length > NOTIFY_MAX_CALL_BODY) return `Mesajul apelului depășește ${NOTIFY_MAX_CALL_BODY} de caractere.`;
    if (!env.voice.enabled) return "Apelurile nu sunt configurate (CALL_HTTP_URL / SMS_HTTP_URL pe accahul.md și tokenul).";
  }
  if (email.enabled) {
    if (!oneLine(email.subject)) return "Subiectul emailului este obligatoriu.";
    if (!email.body.trim()) return "Mesajul emailului este gol.";
    if (email.subject.length > NOTIFY_MAX_SUBJECT) return `Subiectul depășește ${NOTIFY_MAX_SUBJECT} de caractere.`;
    if (email.body.length > NOTIFY_MAX_EMAIL_BODY) return `Emailul depășește ${NOTIFY_MAX_EMAIL_BODY} de caractere.`;
    if (!env.smtp.enabled) return "Emailul nu este configurat (SMTP_*).";
  }
  if (sms.enabled) {
    if (!sms.body.trim()) return "Mesajul SMS este gol.";
    if (sms.body.length > NOTIFY_MAX_SMS_BODY) return `SMS-ul depășește ${NOTIFY_MAX_SMS_BODY} de caractere.`;
    if (!env.sms.enabled) return "SMS-ul nu este configurat (TWILIO_* sau SMS_HTTP_URL).";
  }
  return null;
}

/** Textul {neregula} (până la 3 nereguli) și cel mai apropiat {termen_remediere} din neregulile deschise ale plătitorului. */
function issueVars(list: { contor: string; kind: keyof typeof ISSUE_LABELS; dueAt: string | null }[] | undefined): { issues: string | null; issueDue: string | null } {
  if (!list || list.length === 0) return { issues: null, issueDue: null };
  const text = list.slice(0, 3).map((i) => `${ISSUE_LABELS[i.kind]} (contor ${i.contor})`).join("; ") + (list.length > 3 ? ` și încă ${list.length - 3}` : "");
  const due = list.map((i) => i.dueAt).filter((d): d is string => !!d).sort()[0] ?? null;
  return { issues: text, issueDue: due };
}

/** Cine trimite (utilizatorul care a apăsat butonul sau, la o programare, cel care a creat-o). */
export type Sender = { id: string; name: string; role: string; isSuperAdmin: boolean };

/**
 * Trimite un lot de notificări (email / SMS / apel) către plătitori sau clienți și scrie jurnalul. Folosit de acțiunea din pagină (lot cu lot, apelată de browser)
 * și de programările care rulează singure (cron).
 */
export async function deliverNotificationChunk(user: Sender, input: SendChunkInput): Promise<SendChunkResult> {

  if (!input || !CAMPAIGN_RE.test(input.campaignId ?? "")) return { ok: false, error: "Campanie invalidă." };
  const ids = [...new Set(Array.isArray(input.ids) ? input.ids : [])];
  if (ids.length === 0) return { ok: true, results: [] };
  if (ids.length > NOTIFY_CHUNK_SIZE * 2 || ids.some((id) => typeof id !== "string" || !ID_RE.test(id))) {
    return { ok: false, error: "Lot invalid." };
  }
  const msgError = validateMessage(input);
  if (msgError) return { ok: false, error: msgError };

  const { email, sms } = input;
  const call = input.call ?? { enabled: false, body: "", voice: "" };
  const needsInvoice = usesTokens(email.subject, email.body, sms.body, call.body);
  // {neregula} / {termen_remediere}: neregulile deschise ale contoarelor plătitorului
  const needsIssues = [email.subject, email.body, sms.body, call.body].some((tp) => /\{(neregula|termen_remediere)\}/.test(tp ?? ""));
  const issuesBy = needsIssues ? await openIssuesByClient(ids) : new Map<string, { contor: string; kind: keyof typeof ISSUE_LABELS; dueAt: string | null }[]>();

  const [clients, invoices, already, company, queuedAlready] = await Promise.all([
    prisma.client.findMany({
      where: {
        id: { in: ids },
        ...(input.audience === "clients"
          ? { NOT: [{ meterSeries: { not: null } }, { apaCanalContract: { not: null } }] }
          : { OR: [{ meterSeries: { not: null } }, { apaCanalContract: { not: null } }] }),
      },
      select: { id: true, name: true, meterSeries: true, apaCanalContract: true, email: true, phone: true, consumAddress: true },
    }),
    needsInvoice
      ? prisma.invoice.findMany({
          where: { clientId: { in: ids } },
          orderBy: { issueDate: "desc" },
          select: { clientId: true, number: true, grandTotal: true, currency: true, dueDate: true, publicToken: true },
        })
      : Promise.resolve([]),
    prisma.payerNotificationLog.findMany({
      where: { campaignId: input.campaignId, clientId: { in: ids }, status: "SENT" },
      select: { clientId: true, channel: true },
    }),
    prisma.companySettings.findUnique({ where: { singleton: "main" }, select: { companyName: true } }),
    call.enabled
      ? prisma.notifyCall.findMany({ where: { campaignId: input.campaignId, clientId: { in: ids } }, select: { clientId: true } })
      : Promise.resolve([]),
  ]);
  const callQueued = new Set(queuedAlready.map((q) => q.clientId));

  const latestInvoice = new Map<string, (typeof invoices)[number]>();
  for (const inv of invoices) if (inv.clientId && !latestInvoice.has(inv.clientId)) latestInvoice.set(inv.clientId, inv);
  const alreadySent = new Set(already.map((a) => `${a.clientId}:${a.channel}`));
  const byId = new Map(clients.map((c) => [c.id, c]));

  const logs: {
    campaignId: string; clientId: string; clientName: string; channel: string; to: string;
    status: string; error: string | null; subject: string | null; body: string; userId: string; userName: string;
  }[] = [];
  const notifiedIds = new Set<string>();
  const results = new Map<string, RecipientResult>();

  await pool(ids, CONCURRENCY, async (id) => {
    const c = byId.get(id);
    const res: RecipientResult = {
      id,
      name: c?.name ?? "—",
      email: { status: "skipped", detail: c ? undefined : "Plătitor inexistent" },
      sms: { status: "skipped", detail: c ? undefined : "Plătitor inexistent" },
      call: { status: "skipped", detail: c ? undefined : "Plătitor inexistent" },
    };
    results.set(id, res);
    if (!c) return;

    const inv = latestInvoice.get(c.id);
    const vars: NotifyVars = buildVars({
      invoiceLink: inv?.publicToken ? `${env.appUrl.replace(/\/$/, "")}/invoice/public/${inv.publicToken}` : null,
      name: c.name,
      account: c.meterSeries ?? c.apaCanalContract,
      amount: inv?.grandTotal ?? null,
      currency: inv?.currency ?? null,
      invoiceNumber: inv?.number ?? null,
      dueDate: inv?.dueDate ?? null,
      address: c.consumAddress,
      ...issueVars(issuesBy.get(c.id)),
    });
    const base = { campaignId: input.campaignId, clientId: c.id, clientName: c.name, userId: user.id, userName: user.name };
    const dmeta = { kind: "payer.campaign", campaignId: input.campaignId, toClientId: c.id, toName: c.name, objectType: "client", objectId: c.id };

    if (email.enabled) {
      if (alreadySent.has(`${c.id}:EMAIL`)) {
        res.email = { status: "skipped", detail: "Deja trimis în această campanie" };
      } else if (!isEmail(c.email)) {
        res.email = { status: "skipped", detail: "Fără email valid" };
      } else {
        const subject = oneLine(renderTemplate(email.subject, vars));
        const body = renderTemplate(email.body, vars);
        try {
          const emailTo = c.email.trim();
          await withDeliveryMeta(dmeta, () => sendPayerNotificationEmail({ to: emailTo, subject, body, companyName: company?.companyName }));
          res.email = { status: "sent" };
          notifiedIds.add(c.id);
          logs.push({ ...base, channel: "EMAIL", to: c.email.trim(), status: "SENT", error: null, subject, body });
        } catch (e) {
          res.email = { status: "failed", detail: errText(e) };
          logs.push({ ...base, channel: "EMAIL", to: c.email.trim(), status: "FAILED", error: errText(e), subject, body });
        }
      }
    }

    if (sms.enabled) {
      const phone = normalizePhone(c.phone);
      if (alreadySent.has(`${c.id}:SMS`)) {
        res.sms = { status: "skipped", detail: "Deja trimis în această campanie" };
      } else if (!phone) {
        res.sms = { status: "skipped", detail: "Fără telefon valid" };
      } else {
        const rendered = renderTemplate(sms.body, vars);
        const body = sms.ascii ? stripLatinDiacritics(rendered) : rendered;
        try {
          await withDeliveryMeta(dmeta, () => sendSms(phone, body));
          res.sms = { status: "sent" };
          notifiedIds.add(c.id);
          logs.push({ ...base, channel: "SMS", to: phone, status: "SENT", error: null, subject: null, body });
        } catch (e) {
          res.sms = { status: "failed", detail: errText(e) };
          logs.push({ ...base, channel: "SMS", to: phone, status: "FAILED", error: errText(e), subject: null, body });
        }
      }
    }

    if (call.enabled) {
      const phone = normalizePhone(c.phone);
      if (callQueued.has(c.id)) {
        res.call = { status: "skipped", detail: "Deja în coada de apeluri a acestei campanii" };
      } else if (!phone) {
        res.call = { status: "skipped", detail: "Fără telefon valid" };
      } else {
        // Apelul pleacă acum la gateway-ul de apeluri (ca SMS-ul). Rândul rămâne în registrul din /pbx → Notificări apel;
        // dacă gateway-ul respinge cererea, rândul rămâne „în coadă" (poate fi exportat pentru autoinformarea PBX).
        const text = renderTemplate(call.body, vars);
        let rowId: string | null = null;
        try {
          const row = await prisma.notifyCall.create({
            data: { campaignId: input.campaignId, clientId: c.id, clientName: c.name, phone, text, status: "queued", userId: user.id, userName: user.name },
            select: { id: true },
          });
          rowId = row.id;
        } catch (e) {
          res.call = { status: "failed", detail: errText(e) };
        }
        if (rowId) {
          try {
            const sent = await sendCall(phone, text);
            await prisma.notifyCall
              .update({ where: { id: rowId }, data: { status: "sent", callId: sent.id, operator: "gateway", dialedAt: new Date() } })
              .catch((e) => console.error("[notify] apel nesalvat:", e));
            res.call = { status: "sent", detail: "trimis la gateway" };
            notifiedIds.add(c.id);
            logs.push({ ...base, channel: "CALL", to: phone, status: "SENT", error: null, subject: null, body: text });
          } catch (e) {
            res.call = { status: "failed", detail: `${errText(e)} (rămâne în coadă)` };
            logs.push({ ...base, channel: "CALL", to: phone, status: "FAILED", error: errText(e), subject: null, body: text });
          }
        }
      }
    }
  });

  // Jurnalul și „ultima notificare" se scriu DUPĂ trimitere; dacă scrierea eșuează, mesajele au plecat deja —
  // nu transformăm asta într-o eroare a lotului (clientul ar crede că nu s-a trimis nimic).
  const now = new Date();
  await Promise.all([
    logs.length ? prisma.payerNotificationLog.createMany({ data: logs }).catch((e) => console.error("[notify] jurnal:", e)) : null,
    notifiedIds.size
      ? prisma.client
          .updateMany({ where: { id: { in: [...notifiedIds] } }, data: { lastNotifiedAt: now } })
          .catch((e) => console.error("[notify] lastNotifiedAt:", e))
      : null,
  ]);

  if (notifiedIds.size) await invalidatePayers({ soft: true });

  if (input.index === 0) {
    const channels = [email.enabled ? "email" : null, sms.enabled ? "SMS" : null, call.enabled ? "apel" : null].filter(Boolean).join(" + ");
    await logAudit(
      { id: user.id, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin },
      {
        action: "payer.notify",
        module: "Notifications",
        objectId: input.campaignId,
        objectName: `Notificare ${input.audience === "clients" ? "clienți" : "plătitori"} (${channels}) către ${Math.max(0, Math.floor(input.totalPlanned) || ids.length)} destinatari`,
        newValue: email.enabled ? oneLine(email.subject).slice(0, 120) : (sms.enabled ? sms.body : call.body).slice(0, 120),
      },
    );
  }

  return { ok: true, results: ids.map((id) => results.get(id)!).filter(Boolean) };
}

