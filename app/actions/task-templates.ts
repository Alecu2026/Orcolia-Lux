"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { DEMO } from "@/lib/demo";
import { dateKeyOf, addDaysToKey } from "@/lib/date";
import { TEMPLATE_SELECT, toTaskTemplate } from "@/lib/queries/task-templates";
import {
  TEMPLATE_MAX_DESCRIPTION,
  TEMPLATE_MAX_NAME,
  TEMPLATE_MAX_PER_TYPE,
  TEMPLATE_MAX_TITLE,
  fillTemplate,
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
    if (!title) return { ok: false, error: "Titlul e obligatoriu." };
    if (title.length > TEMPLATE_MAX_TITLE) return { ok: false, error: `Titlul depășește ${TEMPLATE_MAX_TITLE} de caractere.` };
    if (description.length > TEMPLATE_MAX_DESCRIPTION) return { ok: false, error: "Descrierea e prea lungă." };
    const priority = PRIORITIES.includes(input?.priority as (typeof PRIORITIES)[number]) ? input.priority : "MEDIUM";
    const dueDaysRaw = input?.dueDays == null || (input.dueDays as unknown) === "" ? null : Math.floor(Number(input.dueDays));
    const dueDays = dueDaysRaw != null && Number.isFinite(dueDaysRaw) ? Math.min(3650, Math.max(0, dueDaysRaw)) : null;
    const reminder = Math.max(0, Math.floor(Number(input?.reminderIntervalMinutes)) || 0);
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
export async function applyTaskTemplateAction(id: string): Promise<TemplateUseResult> {
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
        title: fillTemplate(tpl.title, reserved, today),
        description: fillTemplate(tpl.description, reserved, today),
        priority: tpl.priority,
        categoryId: cat ? tpl.categoryId : "",
        projectId: proj ? tpl.projectId : "",
        clientId: cli ? tpl.clientId : "",
        address: tpl.address,
        assigneeIds: canAssign ? tpl.assigneeIds : [],
        teamIds: canAssign ? tpl.teamIds : [],
        dueDate: tpl.dueDays != null ? addDaysToKey(today, tpl.dueDays, TZ) : "",
        reminderIntervalMinutes: tpl.reminderIntervalMinutes,
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
