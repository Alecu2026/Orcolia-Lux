"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { DEMO } from "@/lib/demo";
import { env } from "@/lib/env";
import { isRateLimited } from "@/lib/rate-limit";
import { sendPayerNotificationEmail } from "@/lib/email";
import { withDeliveryMeta } from "@/lib/delivery-log";
import {
  deliverNotificationChunk,
  errText,
  oneLine,
  validateMessage,
  type ChannelOutcome as SvcChannelOutcome,
  type RecipientResult as SvcRecipientResult,
  type SendChunkInput as SvcSendChunkInput,
  type SendChunkResult as SvcSendChunkResult,
} from "@/lib/services/payer-notify-send";
import { sendSms } from "@/lib/sms";
import { sendCall } from "@/lib/call-gateway";
import { listMatchingPayerContacts } from "@/lib/queries/payers";
import { filtersToListOptsAsync } from "@/lib/queries/payer-notify";
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

async function requireSender() {
  const user = await requireUser();
  if (!can(user, "payers.notify")) return { ok: false as const, error: "Fără permisiune de a trimite notificări." };
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
  if (!can(user, "payers.view")) return { ok: false, error: "Fără permisiune." };
  if (DEMO) return { ok: false, error: "Mod demo: conectează o bază de date." };

  const filters = sanitizeFilters((rawFilters ?? {}) as Record<string, unknown>);
  const all = await listMatchingPayerContacts(await filtersToListOptsAsync(filters));
  const capped = all.slice(0, NOTIFY_MAX_RECIPIENTS);
  return {
    ok: true,
    contacts: capped.map((c) => [c.id, (isEmail(c.email) ? 1 : 0) | (normalizePhone(c.phone) ? 2 : 0)]),
    total: all.length,
    truncated: all.length > capped.length,
  };
}

// ── Trimitere (în loturi, apelată în buclă de client) ─────────────────────────────────────────

export type ChannelOutcome = SvcChannelOutcome;
export type RecipientResult = SvcRecipientResult;
export type SendChunkInput = SvcSendChunkInput;
export type SendChunkResult = SvcSendChunkResult;

export async function sendPayerNotificationsChunkAction(input: SendChunkInput): Promise<SendChunkResult> {
  const auth = await requireSender();
  if (!auth.ok) return { ok: false, error: auth.error };
  const { user } = auth;
  return deliverNotificationChunk({ id: user.id, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin }, input);
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
  const callIn = input.call ?? { enabled: false, body: "", voice: "" };
  const msgError = validateMessage({ email: input.email, sms: input.sms, call: callIn });
  if (msgError) return { ok: false, error: msgError };

  const sample = buildVars({
    invoiceLink: `${env.appUrl.replace(/\/$/, "")}/invoice/public/EXEMPLU`,
    name: "Ion Popescu",
    account: "123456",
    amount: 250,
    currency: "MDL",
    invoiceNumber: "AC-0001",
    dueDate: new Date(Date.now() + 10 * 86_400_000),
    address: "str. Exemplu 1",
    issues: "Sigiliu rupt sau lipsă (contor 123456)",
    issueDue: new Date(Date.now() + 10 * 86_400_000),
  });
  const done: string[] = [];
  try {
    if (input.email.enabled) {
      if (!isEmail(user.email)) return { ok: false, error: "Contul tău nu are o adresă de email validă." };
      const company = await prisma.companySettings.findUnique({ where: { singleton: "main" }, select: { companyName: true } });
      await withDeliveryMeta({ kind: "payer.test", toName: user.name }, () => sendPayerNotificationEmail({
        to: user.email,
        subject: `[TEST] ${oneLine(renderTemplate(input.email.subject, sample))}`,
        body: renderTemplate(input.email.body, sample),
        companyName: company?.companyName,
      }));
      done.push(`email la ${user.email}`);
    }
    if (input.sms.enabled) {
      const phone = normalizePhone(input.testPhone);
      if (!phone) return { ok: false, error: "Introdu un număr de telefon valid pentru testul SMS (ex. 069123456)." };
      const rendered = renderTemplate(input.sms.body, sample);
      const reply = await withDeliveryMeta({ kind: "payer.test", toName: user.name }, () => sendSms(phone, input.sms.ascii ? stripLatinDiacritics(rendered) : rendered));
      done.push(`SMS la ${phone}${reply ? ` (răspuns gateway: ${reply})` : ""}`);
    }
    if (callIn.enabled) {
      const phone = normalizePhone(input.testPhone);
      if (!phone) return { ok: false, error: "Introdu un număr de telefon valid pentru testul de apel (ex. 069123456)." };
      const sent = await sendCall(phone, renderTemplate(callIn.body, sample));
      done.push(`apel către ${phone} (trimis la gateway, id ${sent.id}; răspuns: ${sent.reply || "—"})`);
    }
  } catch (e) {
    return { ok: false, error: `Testul a eșuat${done.length ? ` (trimis deja: ${done.join(", ")})` : ""}: ${errText(e)}` };
  }
  return { ok: true, message: `Test trimis: ${done.join(" și ")}.` };
}
