"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { DEMO } from "@/lib/demo";
import { dateKeyOf, addDaysToKey } from "@/lib/date";
import { parseReminderSchedule } from "@/lib/reminder-schedule";
import type { Prisma } from "@prisma/client";
import { TEMPLATE_SELECT, toTaskTemplate } from "@/lib/queries/task-templates";
import { loadPayerTemplateData } from "@/lib/queries/payer-template";
import {
  TEMPLATE_MAX_DESCRIPTION,
  TEMPLATE_MAX_NAME,
  TEMPLATE_MAX_PER_TYPE,
  TEMPLATE_MAX_TITLE,
  fillTemplate,
  hasPayerVariables,
  type TemplateContext,
  type TaskTemplate,
  type TaskTemplateDraft,
  type TaskTemplateType,
  type TemplatePrefill,
} from "@/lib/task-template";

export type TemplateSaveResult = { ok: true; template: TaskTemplate } | { ok: false; error: string };
export type TemplateUseResult = { ok: true; prefill: TemplatePrefill } | { ok: false; error: string };

const ID_RE = /^[0-9a-f]{24}$/i;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
const TZ = "Europe/Bucharest";
const str = (v: unknown) => (typeof v === "string" ? v : "");
const ids = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && ID_RE.test(x)))] : []);

async function guard() {
  const user = await requireUser();
  if (!can(user, "tasks.create")) return { ok: false as const, error: "Nu ai permisiunea de creare." };
  if (DEMO) return { ok: false as const, error: "Mod demo: conectează o bază de date." };
  return { ok: true as const, user };
}

/** Creează (fără `id`) sau modifică (cu `id`) un șablon. */
export async function saveTaskTemplateAction(type: TaskTemplateType, input: TaskTemplateDraft): Promise<TemplateSaveResult> {
  try {
    const g = await guard();
    if (!g.ok) return g;
    const t: TaskTemplateType = type === "TICKET" ? "TICKET" : "TASK";
    const name = str(input?.name).trim();
    const title = str(input?.title).replace(/[\r\n]+/g, " ").trim();
    const description = str(input?.description);
    if (!name) return { ok: false, error: "Dă un nume șablonului." };
    if (name.length > TEMPLATE_MAX_NAME) return { ok: false, error: `Numele depășește ${TEMPLATE_MAX_NAME} de caractere.` };
    if (title.length > TEMPLATE_MAX_TITLE) return { ok: false, error: `Titlul depășește ${TEMPLATE_MAX_TITLE} de caractere.` };
    if (description.length > TEMPLATE_MAX_DESCRIPTION) return { ok: false, error: "Descrierea e prea lungă." };
    const priority = PRIORITIES.includes(input?.priority as (typeof PRIORITIES)[number]) ? input.priority : "MEDIUM";
    const dueDaysRaw = input?.dueDays == null || (input.dueDays as unknown) === "" ? null : Math.floor(Number(input.dueDays));
    const dueDays = dueDaysRaw != null && Number.isFinite(dueDaysRaw) ? Math.min(3650, Math.max(0, dueDaysRaw)) : null;
    // Reamintirea programată se păstrează fără dată fixă: „o singură dată” nu are sens într-un șablon, iar „la interval” își calculează începutul la folosire
    let schedule = null as ReturnType<typeof parseReminderSchedule>;
    try {
      const raw = str(input?.reminderSchedule);
      if (raw) schedule = parseReminderSchedule(JSON.parse(raw));
    } catch {}
    if (schedule?.kind === "once") schedule = null;
    if (schedule?.kind === "every") schedule = { ...schedule, anchor: "" };
    const reminder = schedule ? 0 : Math.max(0, Math.floor(Number(input?.reminderIntervalMinutes)) || 0);
    const counter = Math.min(9_999_999, Math.max(1, Math.floor(Number(input?.counter)) || 1));
    const idOrNull = (v: unknown) => (typeof v === "string" && ID_RE.test(v) ? v : null);
    // Responsabilii pot fi setați doar de cine are „Asignare" (la fel ca la crearea unui task).
    const canAssign = can(g.user, "tasks.assign");
    const data = {
      name,
      title,
      description: description || null,
      priority,
      categoryId: idOrNull(input?.categoryId),
      projectId: idOrNull(input?.projectId),
      clientId: idOrNull(input?.clientId),
      address: str(input?.address).trim().slice(0, 300) || null,
      dueDays,
      reminderIntervalMinutes: reminder > 0 ? reminder : null,
      reminderSchedule: (schedule ?? null) as unknown as Prisma.InputJsonValue,
      counter,
      ...(canAssign ? { assigneeIds: ids(input?.assigneeIds), teamIds: ids(input?.teamIds) } : {}),
    };
    if (input?.id) {
      if (!ID_RE.test(input.id)) return { ok: false, error: "Șablon invalid." };
      const row = await prisma.taskTemplate.update({ where: { id: input.id }, data, select: TEMPLATE_SELECT }).catch(() => null);
      if (!row) return { ok: false, error: "Șablonul nu mai există." };
      return { ok: true, template: toTaskTemplate(row) };
    }
    if ((await prisma.taskTemplate.count({ where: { type: t } })) >= TEMPLATE_MAX_PER_TYPE) return { ok: false, error: `Maximum ${TEMPLATE_MAX_PER_TYPE} de șabloane.` };
    const row = await prisma.taskTemplate.create({
      data: { ...data, type: t, createdById: g.user.id, ...(canAssign ? {} : { assigneeIds: [], teamIds: [] }) },
      select: TEMPLATE_SELECT,
    });
    return { ok: true, template: toTaskTemplate(row) };
  } catch (e) {
    console.error("[task-templates] salvare eșuată", e);
    return { ok: false, error: "Nu am putut salva șablonul." };
  }
}

export async function deleteTaskTemplateAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const g = await guard();
    if (!g.ok) return g;
    if (!ID_RE.test(id ?? "")) return { ok: false, error: "Șablon invalid." };
    await prisma.taskTemplate.deleteMany({ where: { id } });
    return { ok: true };
  } catch (e) {
    console.error("[task-templates] ștergere eșuată", e);
    return { ok: false, error: "Nu am putut șterge șablonul." };
  }
}

/**
 * „Folosește șablonul": rezervă ATOMIC următorul număr {contor} (două persoane care aleg același șablon deodată primesc numere diferite)
 * și întoarce câmpurile gata completate pentru fereastra „Task nou". Dacă renunți la creare, numărul se eliberează (vezi releaseTaskTemplateCounterAction).
 */
/** Din ce apel / plătitor se pornește folosirea șablonului (pop-up „Apel primit”, sau plătitorul ales în fereastră). */
export type TemplateCallContext = { clientId?: string; phone?: string; callAt?: string };

const prettyPhone = (p?: string | null) => (p ? (p.startsWith("373") ? `+${p}` : p) : null);
const timeNow = () => new Intl.DateTimeFormat("ro-RO", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());

export async function applyTaskTemplateAction(id: string, call: TemplateCallContext = {}): Promise<TemplateUseResult> {
  try {
    const g = await guard();
    if (!g.ok) return g;
    if (!ID_RE.test(id ?? "")) return { ok: false, error: "Șablon invalid." };
    const row = await prisma.taskTemplate.update({ where: { id }, data: { counter: { increment: 1 } }, select: TEMPLATE_SELECT }).catch(() => null);
    if (!row) return { ok: false, error: "Șablonul nu mai există." };
    const reserved = row.counter - 1;
    const tpl = toTaskTemplate(row);
    const today = dateKeyOf(new Date(), TZ);
    const canAssign = can(g.user, "tasks.assign");
    const payer = await loadPayerTemplateData(call.clientId, call.phone);
    const ctx: TemplateContext = { payer, operator: g.user.name, phone: prettyPhone(call.phone), callAt: call.callAt ?? null, time: timeNow() };
    // Ce nu mai există (categorie / proiect / client șterse) se omite, ca formularul să nu trimită id-uri moarte.
    const [cat, proj, cli] = await Promise.all([
      tpl.categoryId ? prisma.category.findUnique({ where: { id: tpl.categoryId }, select: { id: true } }).catch(() => null) : null,
      tpl.projectId ? prisma.project.findUnique({ where: { id: tpl.projectId }, select: { id: true } }).catch(() => null) : null,
      tpl.clientId ? prisma.client.findUnique({ where: { id: tpl.clientId }, select: { id: true } }).catch(() => null) : null,
    ]);
    return {
      ok: true,
      prefill: {
        templateId: tpl.id,
        reserved,
        title: fillTemplate(tpl.title, reserved, today, ctx),
        description: fillTemplate(tpl.description, reserved, today, ctx),
        ...(call.phone ? { callPhone: call.phone } : {}),
        ...(call.callAt ? { callAt: call.callAt } : {}),
        priority: tpl.priority,
        categoryId: cat ? tpl.categoryId : "",
        projectId: proj ? tpl.projectId : "",
        // plătitorul din apel are prioritate față de clientul din șablon; adresa lui completează adresa lipsă din șablon
        clientId: payer && call.clientId ? call.clientId : cli ? tpl.clientId : "",
        address: tpl.address || payer?.adresa || "",
        assigneeIds: canAssign ? tpl.assigneeIds : [],
        teamIds: canAssign ? tpl.teamIds : [],
        dueDate: tpl.dueDays != null ? addDaysToKey(today, tpl.dueDays, TZ) : "",
        reminderIntervalMinutes: tpl.reminderIntervalMinutes,
        reminderSchedule: tpl.reminderSchedule,
      },
    };
  } catch (e) {
    console.error("[task-templates] folosire eșuată", e);
    return { ok: false, error: "Nu am putut folosi șablonul." };
  }
}

/** Renunțare la crearea din șablon: dacă între timp nimeni nu a mai luat un număr, îl punem la loc (fără goluri în numerotare). */
export async function releaseTaskTemplateCounterAction(id: string, reserved: number): Promise<void> {
  try {
    const g = await guard();
    if (!g.ok || !ID_RE.test(id ?? "") || !Number.isInteger(reserved) || reserved < 1) return;
    await prisma.taskTemplate.updateMany({ where: { id, counter: reserved + 1 }, data: { counter: reserved } });
  } catch {
    // nu e grav: rămâne un număr nefolosit
  }
}

/**
 * Completează variabilele de plătitor rămase în titlu / descriere după ce a fost ales plătitorul (în fereastra de creare, după aplicarea șablonului).
 * Textul fără variabile rămâne neschimbat.
 */
export async function resolveTemplateTextAction(input: { clientId: string; title: string; description: string; phone?: string; callAt?: string }): Promise<{ ok: true; title: string; description: string; address: string } | { ok: false; error: string }> {
  try {
    const g = await guard();
    if (!g.ok) return g;
    const payer = await loadPayerTemplateData(input?.clientId, input?.phone);
    if (!payer) return { ok: false, error: "Plătitorul nu a fost găsit." };
    const title = str(input?.title);
    const description = str(input?.description);
    const ctx: TemplateContext = { payer, operator: g.user.name, phone: prettyPhone(input?.phone), callAt: input?.callAt ?? null, time: timeNow() };
    // {contor}/{data}… au fost deja înlocuite la aplicarea șablonului: aici se ating doar variabilele de plătitor
    const fix = (t: string) => (hasPayerVariables(t) ? fillTemplate(t, 0, dateKeyOf(new Date(), TZ), ctx).replace(/\{contor\}/g, "{contor}") : t);
    return { ok: true, title: fix(title), description: fix(description), address: payer.adresa ?? "" };
  } catch (e) {
    console.error("[task-templates] completare variabile eșuată", e);
    return { ok: false, error: "Nu am putut completa datele plătitorului." };
  }
}

/** Șabloanele disponibile pentru pop-up-ul „Apel primit” (cereri + sarcini), doar nume. */
export async function listTemplatesForCallAction(): Promise<{ ok: true; items: { id: string; type: TaskTemplateType; name: string }[] } | { ok: false; error: string }> {
  try {
    const g = await guard();
    if (!g.ok) return g;
    const rows = await prisma.taskTemplate.findMany({ orderBy: { name: "asc" }, take: 400, select: { id: true, type: true, name: true } });
    return { ok: true, items: rows.map((r) => ({ id: r.id, type: r.type === "TICKET" ? "TICKET" : "TASK", name: r.name })) };
  } catch (e) {
    console.error("[task-templates] listare eșuată", e);
    return { ok: false, error: "Nu am putut încărca șabloanele." };
  }
}
