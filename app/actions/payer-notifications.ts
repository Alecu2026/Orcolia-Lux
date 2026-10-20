"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { DEMO } from "@/lib/demo";
import { env } from "@/lib/env";
import { isRateLimited } from "@/lib/rate-limit";
import { logAudit } from "@/lib/services/audit";
import { sendPayerNotificationEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { placePbxCall } from "@/lib/pbx-api";
import { listMatchingPayerContacts } from "@/lib/queries/payers";
import { filtersToListOpts } from "@/lib/queries/payer-notify";
import {
  NOTIFY_CHUNK_SIZE,
  NOTIFY_MAX_CALL_BODY,
  NOTIFY_MAX_EMAIL_BODY,
  NOTIFY_MAX_RECIPIENTS,
  NOTIFY_MAX_SMS_BODY,
  NOTIFY_MAX_SUBJECT,
  buildVars,
  isEmail,
  normalizePhone,
  renderTemplate,
  sanitizeFilters,
  stripLatinDiacritics,
  usesTokens,
  type NotifyVars,
} from "@/lib/payer-notify";

/** Cel mult `max` apeluri către PBX în același timp (robotul/PBX-ul nu primesc 5 deodată). */
function limiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((r) => waiting.push(r));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
const dialLimit = limiter(2);
const CALLER_RE = /^[w.@-]{1,64}$/;

/** Pagina e `maxDuration = 60` (vezi page.tsx) — un lot de 25 destinatari încape confortabil. */
const CONCURRENCY = 5;

async function requireSender() {
  const user = await requireUser();
  if (!can(user, "clients.edit")) return { ok: false as const, error: "Fără permisiune de a trimite notificări." };
  if (DEMO) return { ok: false as const, error: "Mod demo: conectează o bază de date." };
  return { ok: true as const, user };
}

// ── Selectare „toți din filtru" ───────────────────────────────────────────────────────────────

export type ResolvedTargets =
  | {
      ok: true;
      /** [id, steaguri] — 1 = are email valid, 2 = are telefon valid. */
      contacts: [string, number][];
      total: number;
      truncated: boolean;
    }
  | { ok: false; error: string };

/** Toți plătitorii care respectă filtrele (cu steagurile de contact), pentru „Selectează toți cei N din filtru". */
export async function resolveNotifyFilterAction(rawFilters: unknown): Promise<ResolvedTargets> {
  const user = await requireUser();
  if (!can(user, "clients.view")) return { ok: false, error: "Fără permisiune." };
  if (DEMO) return { ok: false, error: "Mod demo: conectează o bază de date." };

  const filters = sanitizeFilters((rawFilters ?? {}) as Record<string, unknown>);
  const all = await listMatchingPayerContacts(filtersToListOpts(filters));
  const capped = all.slice(0, NOTIFY_MAX_RECIPIENTS);
  return {
    ok: true,
    contacts: capped.map((c) => [c.id, (isEmail(c.email) ? 1 : 0) | (normalizePhone(c.phone) ? 2 : 0)]),
    total: all.length,
    truncated: all.length > capped.length,
  };
}

// ── Trimitere (în loturi, apelată în buclă de client) ─────────────────────────────────────────

export type ChannelOutcome = { status: "sent" | "failed" | "skipped"; detail?: string };
export type RecipientResult = { id: string; name: string; email: ChannelOutcome; sms: ChannelOutcome; call: ChannelOutcome };

export type SendChunkInput = {
  /** Generat pe client, identic pentru toate loturile unei trimiteri — face retrimiterea unui lot idempotentă. */
  campaignId: string;
  /** Al câtelea lot e (0 = primul; doar atunci se scrie intrarea în Audit Logs). */
  index: number;
  /** Câți destinatari are în total campania (doar pentru Audit Logs). */
  totalPlanned: number;
  ids: string[];
  email: { enabled: boolean; subject: string; body: string };
  sms: { enabled: boolean; body: string; ascii: boolean };
  /** `caller` = extensia PBX care face apelul (robotul), ex. "robot". */
  call: { enabled: boolean; body: string; voice: string; caller?: string };
};

export type SendChunkResult = { ok: true; results: RecipientResult[] } | { ok: false; error: string };

const ID_RE = /^[0-9a-f]{24}$/i;
const CAMPAIGN_RE = /^[\w-]{8,64}$/;
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
const errText = (e: unknown) => (e instanceof Error ? e.message : "Eroare necunoscută").slice(0, 200);

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

function validateMessage(input: Pick<SendChunkInput, "email" | "sms" | "call">): string | null {
  const { email, sms, call } = input;
  if (!email.enabled && !sms.enabled && !call?.enabled) return "Alege cel puțin un canal (email, SMS sau apel).";
  if (call?.enabled) {
    if (!call.body.trim()) return "Mesajul apelului este gol.";
    if (call.body.length > NOTIFY_MAX_CALL_BODY) return `Mesajul apelului depășește ${NOTIFY_MAX_CALL_BODY} de caractere.`;
    if (!env.voice.enabled) return "Apelurile prin PBX nu sunt configurate (PBX_API_KEY).";
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

export async function sendPayerNotificationsChunkAction(input: SendChunkInput): Promise<SendChunkResult> {
  const auth = await requireSender();
  if (!auth.ok) return { ok: false, error: auth.error };
  const { user } = auth;

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

  const [clients, invoices, already, company, queuedAlready] = await Promise.all([
    prisma.client.findMany({
      where: {
        id: { in: ids },
        OR: [{ meterSeries: { not: null } }, { apaCanalContract: { not: null } }],
      },
      select: { id: true, name: true, meterSeries: true, apaCanalContract: true, email: true, phone: true, consumAddress: true },
    }),
    needsInvoice
      ? prisma.invoice.findMany({
          where: { clientId: { in: ids } },
          orderBy: { issueDate: "desc" },
          select: { clientId: true, number: true, grandTotal: true, currency: true, dueDate: true },
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
      name: c.name,
      account: c.meterSeries ?? c.apaCanalContract,
      amount: inv?.grandTotal ?? null,
      currency: inv?.currency ?? null,
      invoiceNumber: inv?.number ?? null,
      dueDate: inv?.dueDate ?? null,
      address: c.consumAddress,
    });
    const base = { campaignId: input.campaignId, clientId: c.id, clientName: c.name, userId: user.id, userName: user.name };

    if (email.enabled) {
      if (alreadySent.has(`${c.id}:EMAIL`)) {
        res.email = { status: "skipped", detail: "Deja trimis în această campanie" };
      } else if (!isEmail(c.email)) {
        res.email = { status: "skipped", detail: "Fără email valid" };
      } else {
        const subject = oneLine(renderTemplate(email.subject, vars));
        const body = renderTemplate(email.body, vars);
        try {
          await sendPayerNotificationEmail({ to: c.email.trim(), subject, body, companyName: company?.companyName });
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
          await sendSms(phone, body);
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
        // Se pune în coadă (jurnal + reîncercări din /pbx → Notificări apel) și apelul pornește IMEDIAT prin extensia PBX aleasă
        // (robotul): PBX-ul o sună, iar robotul sună plătitorul, redă înregistrarea și închide. Dacă apelul nu pornește,
        // rândul rămâne în coadă și se poate suna din nou de acolo.
        const text = renderTemplate(call.body, vars);
        const caller = CALLER_RE.test(call.caller ?? "") ? (call.caller as string) : env.pbx.callUser || "robot";
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
            const callId = await dialLimit(() => placePbxCall(phone, caller));
            await prisma.notifyCall
              .update({ where: { id: rowId }, data: { status: "dialing", callId, operator: caller, dialedAt: new Date() } })
              .catch((e) => console.error("[notify] apel nesalvat:", e));
            res.call = { status: "sent", detail: "apel pornit" };
            notifiedIds.add(c.id);
            logs.push({ ...base, channel: "CALL", to: phone, status: "SENT", error: null, subject: `apelant ${caller}`, body: text });
          } catch (e) {
            res.call = { status: "failed", detail: `${errText(e)} (rămâne în coadă)` };
            logs.push({ ...base, channel: "CALL", to: phone, status: "FAILED", error: errText(e), subject: `apelant ${caller}`, body: text });
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

  if (input.index === 0) {
    const channels = [email.enabled ? "email" : null, sms.enabled ? "SMS" : null, call.enabled ? "apel" : null].filter(Boolean).join(" + ");
    await logAudit(
      { id: user.id, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin },
      {
        action: "payer.notify",
        module: "Notifications",
        objectId: input.campaignId,
        objectName: `Notificare plătitori (${channels}) către ${Math.max(0, Math.floor(input.totalPlanned) || ids.length)} destinatari`,
        newValue: email.enabled ? oneLine(email.subject).slice(0, 120) : (sms.enabled ? sms.body : call.body).slice(0, 120),
      },
    );
  }

  return { ok: true, results: ids.map((id) => results.get(id)!).filter(Boolean) };
}

// ── Mesaj de test ──────────────────────────────────────────────────────────────────────────────

export type TestResult = { ok: true; message: string } | { ok: false; error: string };

/** Trimite mesajul, cu date de exemplu, pe emailul operatorului (și/sau pe un telefon ales) — înainte de trimiterea în masă. */
export async function sendTestNotificationAction(input: {
  email: { enabled: boolean; subject: string; body: string };
  sms: { enabled: boolean; body: string; ascii: boolean };
  call?: { enabled: boolean; body: string; voice: string };
  testPhone: string;
}): Promise<TestResult> {
  const auth = await requireSender();
  if (!auth.ok) return { ok: false, error: auth.error };
  const { user } = auth;
  if (isRateLimited(`payer-notify-test:${user.id}`, 10, 10 * 60_000)) {
    return { ok: false, error: "Prea multe teste — încearcă din nou peste câteva minute." };
  }
  // Apelul nu se testează de aici (e cu operator) — se pornește din /pbx → Notificări apel.
  const msgError = validateMessage({ email: input.email, sms: input.sms, call: { enabled: false, body: "", voice: "" } });
  if (msgError) return { ok: false, error: msgError };

  const sample = buildVars({
    name: "Ion Popescu",
    account: "123456",
    amount: 250,
    currency: "MDL",
    invoiceNumber: "AC-0001",
    dueDate: new Date(Date.now() + 10 * 86_400_000),
    address: "str. Exemplu 1",
  });
  const done: string[] = [];
  try {
    if (input.email.enabled) {
      if (!isEmail(user.email)) return { ok: false, error: "Contul tău nu are o adresă de email validă." };
      const company = await prisma.companySettings.findUnique({ where: { singleton: "main" }, select: { companyName: true } });
      await sendPayerNotificationEmail({
        to: user.email,
        subject: `[TEST] ${oneLine(renderTemplate(input.email.subject, sample))}`,
        body: renderTemplate(input.email.body, sample),
        companyName: company?.companyName,
      });
      done.push(`email la ${user.email}`);
    }
    if (input.sms.enabled) {
      const phone = normalizePhone(input.testPhone);
      if (!phone) return { ok: false, error: "Introdu un număr de telefon valid pentru testul SMS (ex. 069123456)." };
      const rendered = renderTemplate(input.sms.body, sample);
      const reply = await sendSms(phone, input.sms.ascii ? stripLatinDiacritics(rendered) : rendered);
      done.push(`SMS la ${phone}${reply ? ` (răspuns gateway: ${reply})` : ""}`);
    }
  } catch (e) {
    return { ok: false, error: `Testul a eșuat${done.length ? ` (trimis deja: ${done.join(", ")})` : ""}: ${errText(e)}` };
  }
  return { ok: true, message: `Test trimis: ${done.join(" și ")}.` };
}
