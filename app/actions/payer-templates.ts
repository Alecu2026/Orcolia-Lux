"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { DEMO } from "@/lib/demo";
import {
  NOTIFY_MAX_CALL_BODY,
  NOTIFY_MAX_EMAIL_BODY,
  NOTIFY_MAX_SMS_BODY,
  NOTIFY_VOICES,
  NOTIFY_MAX_SUBJECT,
  NOTIFY_MAX_TEMPLATES,
  NOTIFY_MAX_TEMPLATE_NAME,
  type PayerTemplate,
  type PayerTemplateDraft,
} from "@/lib/payer-notify";

export type TemplateResult = { ok: true; template: PayerTemplate } | { ok: false; error: string };
export type TemplateDeleteResult = { ok: true } | { ok: false; error: string };

const ID_RE = /^[0-9a-f]{24}$/i;
const str = (v: unknown) => (typeof v === "string" ? v : "");

async function guard() {
  const user = await requireUser();
  if (!can(user, "clients.edit")) return { ok: false as const, error: "Fără permisiune." };
  if (DEMO) return { ok: false as const, error: "Mod demo: conectează o bază de date." };
  return { ok: true as const, user };
}

function clean(input: PayerTemplateDraft): { data: PayerTemplateDraft } | { error: string } {
  const data = {
    name: str(input?.name).trim(),
    subject: str(input?.subject).replace(/[\r\n]+/g, " ").trim(),
    email: str(input?.email),
    sms: str(input?.sms),
    call: str(input?.call),
    voice: NOTIFY_VOICES.some((v) => v.id === input?.voice) ? str(input?.voice) : "",
  };
  if (!data.name) return { error: "Dă un nume șablonului." };
  if (data.name.length > NOTIFY_MAX_TEMPLATE_NAME) return { error: `Numele depășește ${NOTIFY_MAX_TEMPLATE_NAME} de caractere.` };
  if (data.subject.length > NOTIFY_MAX_SUBJECT) return { error: "Subiectul e prea lung." };
  if (data.email.length > NOTIFY_MAX_EMAIL_BODY) return { error: "Mesajul emailului e prea lung." };
  if (data.sms.length > NOTIFY_MAX_SMS_BODY) return { error: "Mesajul SMS e prea lung." };
  if (data.call.length > NOTIFY_MAX_CALL_BODY) return { error: `Mesajul apelului depășește ${NOTIFY_MAX_CALL_BODY} de caractere.` };
  if (!data.email.trim() && !data.sms.trim() && !data.call.trim()) return { error: "Scrie măcar un mesaj: email, SMS sau apel." };
  return { data };
}

const SELECT = { id: true, name: true, subject: true, email: true, sms: true, call: true, voice: true } as const;
type Row = { id: string; name: string; subject: string; email: string; sms: string; call: string | null; voice: string | null };
const toTemplate = (r: Row): PayerTemplate => ({ ...r, call: r.call ?? "", voice: r.voice ?? "" });

export async function createPayerTemplateAction(input: PayerTemplateDraft): Promise<TemplateResult> {
  const g = await guard();
  if (!g.ok) return g;
  const c = clean(input);
  if ("error" in c) return { ok: false, error: c.error };
  if ((await prisma.payerNotifyTemplate.count()) >= NOTIFY_MAX_TEMPLATES) {
    return { ok: false, error: `Maximum ${NOTIFY_MAX_TEMPLATES} de șabloane. Șterge unele vechi.` };
  }
  const row = await prisma.payerNotifyTemplate.create({ data: { ...c.data, createdBy: g.user.id }, select: SELECT });
  return { ok: true, template: toTemplate(row) };
}

export async function updatePayerTemplateAction(id: string, input: PayerTemplateDraft): Promise<TemplateResult> {
  const g = await guard();
  if (!g.ok) return g;
  if (!ID_RE.test(id)) return { ok: false, error: "Șablon invalid." };
  const c = clean(input);
  if ("error" in c) return { ok: false, error: c.error };
  const exists = await prisma.payerNotifyTemplate.count({ where: { id } });
  if (!exists) return { ok: false, error: "Șablonul nu mai există (poate l-a șters altcineva)." };
  const row = await prisma.payerNotifyTemplate.update({ where: { id }, data: c.data, select: SELECT });
  return { ok: true, template: toTemplate(row) };
}

export async function deletePayerTemplateAction(id: string): Promise<TemplateDeleteResult> {
  const g = await guard();
  if (!g.ok) return g;
  if (!ID_RE.test(id)) return { ok: false, error: "Șablon invalid." };
  await prisma.payerNotifyTemplate.deleteMany({ where: { id } });
  return { ok: true };
}
