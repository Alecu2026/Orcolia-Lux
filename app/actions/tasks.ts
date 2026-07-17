"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { DEMO } from "@/lib/demo";
import { zonedToUtc } from "@/lib/date";
import {
  createTask,
  changeTaskStatus,
  changeTaskProgress,
  notifyNewTask,
  notifyAttachmentTelegram,
  addTaskComment,
  listTaskComments,
  updateTask,
} from "@/lib/services/tasks";
import { listTasks, taskHistory, type TaskHistoryRow, type TaskRow } from "@/lib/queries/tasks";
import { logAudit } from "@/lib/services/audit";
import { TASK_STATUS_RO } from "@/lib/telegram";
import type { TaskStatus, TaskType, TaskPriority } from "@prisma/client";
import type { AssignmentSetting } from "@/lib/services/tasks";

export type TaskState = { ok?: boolean; error?: string; id?: string } | undefined;

const F_STATUSES = new Set(["NEW","ASSIGNED","READ","IN_PROGRESS","ON_HOLD","REVIEW","DONE","CANCELLED"]);
const F_PRIOS = new Set(["LOW","MEDIUM","HIGH","URGENT"]);
const F_DUE = new Set(["overdue","today","tomorrow","week","month"]);
const F_SORTS = new Set(["dueAsc","dueDesc"]);

export type TaskListOpts = {
  scope?: string; q?: string; status?: string; assignee?: string;
  team?: string; proj?: string; client?: string; prio?: string;
  due?: string; sort?: string; category?: string; ps?: string;
  page?: number; types?: string[];
};
export type TaskListResult = {
  items: TaskRow[]; hasMore: boolean; page: number; totalPages: number;
};

export async function listTasksAction(opts: TaskListOpts): Promise<TaskListResult> {
  const user = await requireUser();
  const scope = (
    user.role === "STAFF" ? "mine"
    : (["mine","all","created"].includes(opts.scope ?? "") ? opts.scope : "mine")
  ) as "mine" | "all" | "created";
  const pageSize = opts.ps === "all" ? 9999 : Math.min(9999, Math.max(1, Number(opts.ps) || 20));
  return listTasks({
    scope, userId: user.id, teamIds: user.teamIds,
    types: opts.types?.length ? (opts.types as TaskType[]) : undefined,
    status: F_STATUSES.has(opts.status ?? "") ? (opts.status as TaskStatus) : undefined,
    priority: F_PRIOS.has(opts.prio ?? "") ? (opts.prio as TaskPriority) : undefined,
    assigneeId: opts.assignee || undefined, teamId: opts.team || undefined,
    projectId: opts.proj || undefined, clientId: opts.client || undefined,
    categoryId: opts.category || undefined,
    dueRange: F_DUE.has(opts.due ?? "") ? (opts.due as "overdue"|"today"|"tomorrow"|"week"|"month") : undefined,
    sort: F_SORTS.has(opts.sort ?? "") ? (opts.sort as "dueAsc"|"dueDesc") : "default",
    search: opts.q || undefined,
    page: Math.max(1, opts.page || 1), pageSize,
  });
}

const moduleForType = (t: TaskType) => (t === "TICKET" ? "Tickets" : "Tasks");
const prefixForType = (t: TaskType) => (t === "TICKET" ? "ticket" : "task");

const TYPES: TaskType[] = ["TASK", "TICKET"];
const PRIORITIES: TaskPriority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const STATUSES: TaskStatus[] = [
  "NEW",
  "ASSIGNED",
  "READ",
  "IN_PROGRESS",
  "ON_HOLD",
  "REVIEW",
  "DONE",
  "CANCELLED",
];

function revalidateTasks() {
  for (const p of ["/tasks", "/tickets", "/dashboard", "/projects", "/kanban", "/notificari"]) revalidatePath(p);
}

export async function createTaskAction(
  _prev: TaskState,
  formData: FormData,
): Promise<TaskState> {
  try {
    const user = await requireUser();
    if (!can(user, "tasks.create")) return { error: "Nu ai permisiunea de creare." };
    if (DEMO) return { error: "Mod demo: conectează o bază de date." };

    const title = String(formData.get("title") ?? "").trim();
    if (!title) return { error: "Titlul e obligatoriu." };

    const type = TYPES.includes(formData.get("type") as TaskType)
      ? (formData.get("type") as TaskType)
      : "TASK";
    const priority = PRIORITIES.includes(formData.get("priority") as TaskPriority)
      ? (formData.get("priority") as TaskPriority)
      : "MEDIUM";
    const dueDate = String(formData.get("dueDate") ?? "").trim();
    const dueTime = String(formData.get("dueTime") ?? "").trim();
    const dueAt = /^\d{4}-\d{2}-\d{2}$/.test(dueDate)
      ? zonedToUtc(dueDate, dueTime || "00:00", "Europe/Bucharest")
      : null;

    const reminderRaw = Number(formData.get("reminderIntervalMinutes") ?? 0);
    const reminderIntervalMinutes = reminderRaw > 0 ? reminderRaw : null;

    const assigneeIds = formData.getAll("assigneeIds").map(String).filter(Boolean);
    const teamIds = formData.getAll("teamIds").map(String).filter(Boolean);
    const [assigneeId = null, ...extraAssigneeIds] = assigneeIds;
    const [teamId = null, ...extraTeamIds] = teamIds;
    const allIds = [...assigneeIds, ...teamIds];
    const settings: AssignmentSetting[] = allIds.length > 1
      ? [
          ...assigneeIds.map((uid) => ({ userId: uid, notifyUntilStatus: (formData.get(`notifyUntil_${uid}`) as string) || null })),
          ...teamIds.map((tid) => ({ teamId: tid, notifyUntilStatus: (formData.get(`notifyUntil_team_${tid}`) as string) || null })),
        ].filter((s) => s.notifyUntilStatus)
      : [];

    const res = await createTask(
      user.id,
      {
        title,
        description: String(formData.get("description") ?? ""),
        type,
        priority,
        dueAt,
        assigneeId: assigneeId || (formData.get("assigneeId") as string) || null,
        teamId: teamId || (formData.get("teamId") as string) || null,
        extraAssigneeIds,
        extraTeamIds,
        assignmentSettingsJson: settings.length > 0 ? JSON.stringify(settings) : null,
        projectId: (formData.get("projectId") as string) || null,
        clientId: (formData.get("clientId") as string) || null,
        categoryId: (formData.get("categoryId") as string) || null,
        reminderIntervalMinutes,
        bypassQuietHours: formData.get("bypassQuietHours") === "on",
      },
      "WEB",
    );
    if (!res.ok) return { error: res.error };
    after(() => notifyNewTask(res.id));
    await logAudit(
      { id: user.id, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin },
      { action: `${prefixForType(type)}.create`, module: moduleForType(type), objectId: res.id, objectName: title },
    );
    revalidateTasks();
    return { ok: true, id: res.id };
  } catch (e) {
    console.error("[tasks.action] createTaskAction: eșuat", e);
    return { error: "Eroare la creare. Încearcă din nou." };
  }
}

/** Schimbarea statusului e permisă oricărui utilizator autentificat (acțiune zilnică). */
export async function setTaskStatus(id: string, status: string): Promise<TaskState> {
  const user = await requireUser();
  console.log(`[tasks.action] setTaskStatus: user=${user.id} (${user.name}) task=${id} -> ${status}`);
  if (!STATUSES.includes(status as TaskStatus)) {
    console.error(`[tasks.action] setTaskStatus: status invalid primit din client: "${status}"`);
    return { error: "Status invalid." };
  }
  const res = await changeTaskStatus(id, user.id, status as TaskStatus);
  if (!res.ok) {
    console.error(`[tasks.action] setTaskStatus: eșuat — ${res.error}`);
    return { error: res.error };
  }
  if (res.changed) {
    await logAudit(
      { id: user.id, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin },
      {
        action: `${prefixForType(res.type)}.status_change`,
        module: moduleForType(res.type),
        objectId: id,
        objectName: res.title,
        oldValue: TASK_STATUS_RO[res.fromStatus],
        newValue: TASK_STATUS_RO[status as TaskStatus],
      },
    );
  }
  revalidateTasks();
  return { ok: true };
}

/** Actualizare progres (0-100), permisă oricărui utilizator autentificat. */
export async function setTaskProgress(id: string, progress: number): Promise<TaskState> {
  const user = await requireUser();
  console.log(`[tasks.action] setTaskProgress: user=${user.id} (${user.name}) task=${id} -> ${progress}%`);
  const res = await changeTaskProgress(id, user.id, progress);
  if (!res.ok) {
    console.error(`[tasks.action] setTaskProgress: eșuat — ${res.error}`);
    return { error: res.error };
  }
  if (res.changed) {
    await logAudit(
      { id: user.id, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin },
      {
        action: "task.progress_change",
        module: moduleForType(res.type),
        objectId: id,
        objectName: res.title,
        oldValue: `${res.fromProgress}%`,
        newValue: `${progress}%`,
      },
    );
  }
  revalidateTasks();
  return { ok: true };
}

/** Istoricul de status (timeline) — lazy, la expandarea unui task. */
export async function getTaskHistory(id: string): Promise<TaskHistoryRow[]> {
  const user = await requireUser();
  if (!can(user, "tasks.view")) return [];
  return taskHistory(id);
}

export type TaskCommentRow = {
  id: string;
  body: string;
  source: "WEB" | "TELEGRAM" | "VOICE";
  createdAt: Date;
  userName: string;
};

/** Comentariile unui task — lazy, la expandarea unui task. */
export async function getTaskComments(id: string): Promise<TaskCommentRow[]> {
  const user = await requireUser();
  if (!can(user, "tasks.view")) return [];
  const rows = await listTaskComments(id);
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    source: r.source,
    createdAt: r.createdAt,
    userName: r.user?.name ?? "—",
  }));
}

/** Adaugă un comentariu pe task, permis oricărui utilizator autentificat. */
export async function addTaskCommentAction(id: string, body: string): Promise<TaskState> {
  const user = await requireUser();
  console.log(`[tasks.action] addTaskCommentAction: user=${user.id} (${user.name}) task=${id}`);
  const res = await addTaskComment(id, user.id, body, "WEB");
  if (!res.ok) {
    console.error(`[tasks.action] addTaskCommentAction: eșuat — ${res.error}`);
    return { error: res.error };
  }
  revalidateTasks();
  return { ok: true, id: res.id };
}

export async function updateTaskAction(
  _prev: TaskState,
  formData: FormData,
): Promise<TaskState> {
  try {
    const user = await requireUser();
    if (!can(user, "tasks.edit")) return { error: "Nu ai permisiunea de editare." };
    if (DEMO) return { error: "Mod demo: conectează o bază de date." };

    const id = String(formData.get("id") ?? "").trim();
    if (!id) return { error: "ID task lipsă." };

    const title = String(formData.get("title") ?? "").trim();
    const description = String(formData.get("description") ?? "");
    const dueDate = String(formData.get("dueDate") ?? "").trim();
    const dueTime = String(formData.get("dueTime") ?? "").trim();
    const dueAt = /^\d{4}-\d{2}-\d{2}$/.test(dueDate)
      ? zonedToUtc(dueDate, dueTime || "00:00", "Europe/Bucharest")
      : null;
    const priority = PRIORITIES.includes(formData.get("priority") as TaskPriority)
      ? (formData.get("priority") as TaskPriority)
      : "MEDIUM";

    const reminderRaw = Number(formData.get("reminderIntervalMinutes") ?? 0);
    const reminderIntervalMinutes = reminderRaw > 0 ? reminderRaw : null;

    const assigneeIds = formData.getAll("assigneeIds").map(String).filter(Boolean);
    const teamIds = formData.getAll("teamIds").map(String).filter(Boolean);
    const [assigneeId = null, ...extraAssigneeIds] = assigneeIds;
    const [teamId = null, ...extraTeamIds] = teamIds;
    const allAssignIds = [...assigneeIds, ...teamIds];
    const settings: AssignmentSetting[] = allAssignIds.length > 1
      ? [
          ...assigneeIds.map((uid) => ({ userId: uid, notifyUntilStatus: (formData.get(`notifyUntil_${uid}`) as string) || null })),
          ...teamIds.map((tid) => ({ teamId: tid, notifyUntilStatus: (formData.get(`notifyUntil_team_${tid}`) as string) || null })),
        ].filter((s) => s.notifyUntilStatus)
      : [];

    const hasMultiAssign = formData.has("assigneeIds") || formData.has("teamIds");

    const res = await updateTask(id, user.id, {
      title,
      description,
      assigneeId: hasMultiAssign ? (assigneeId || null) : ((formData.get("assigneeId") as string) || null),
      teamId: hasMultiAssign ? (teamId || null) : ((formData.get("teamId") as string) || null),
      ...(hasMultiAssign ? {
        extraAssigneeIds,
        extraTeamIds,
        assignmentSettingsJson: settings.length > 0 ? JSON.stringify(settings) : null,
      } : {}),
      projectId: (formData.get("projectId") as string) || null,
      clientId: (formData.get("clientId") as string) || null,
      categoryId: (formData.get("categoryId") as string) || null,
      priority,
      dueAt,
      reminderIntervalMinutes,
      bypassQuietHours: formData.get("bypassQuietHours") === "on",
    });
    if (!res.ok) return { error: res.error };

    await logAudit(
      { id: user.id, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin },
      { action: `${prefixForType(res.type)}.edit`, module: moduleForType(res.type), objectId: id, objectName: res.title },
    );
    revalidateTasks();
    return { ok: true, id };
  } catch (e) {
    console.error("[tasks.action] updateTaskAction: eșuat", e);
    return { error: "Eroare la salvare. Încearcă din nou." };
  }
}

export type AttachmentRow = {
  id: string;
  name: string;
  url: string;
  size: number;
  mimeType: string | null;
  createdAt: Date;
  userName: string;
  userId: string;
};

export async function addAttachmentAction(
  taskId: string,
  formData: FormData,
): Promise<{ ok?: boolean; error?: string; attachment?: AttachmentRow }> {
  const user = await requireUser();
  if (!can(user, "tasks.view")) return { error: "Nu ai permisiunea." };
  if (DEMO) return { error: "Mod demo." };

  const file = formData.get("file") as File | null;
  if (!file || !file.size) return { error: "Niciun fișier selectat." };
  if (file.size > 20 * 1024 * 1024) return { error: "Fișierul depășește 20 MB." };

  const { env } = await import("@/lib/env");
  if (!env.blob.enabled) return { error: "Stocarea fișierelor nu este configurată (BLOB_READ_WRITE_TOKEN lipsă)." };

  const { put } = await import("@vercel/blob");
  const safeName = file.name.replace(/[^\w.\-]/g, "_");
  const blob = await put(`tasks/${taskId}/${Date.now()}-${safeName}`, file, { access: "public" });

  const att = await prisma.taskAttachment.create({
    data: {
      taskId,
      userId: user.id,
      name: file.name,
      url: blob.url,
      size: file.size,
      mimeType: file.type || null,
    },
    select: {
      id: true, name: true, url: true, size: true, mimeType: true, createdAt: true,
      user: { select: { id: true, name: true } },
    },
  });

  await prisma.taskActivity
    .create({ data: { taskId, userId: user.id, action: "ATTACHMENT_ADDED", meta: { fileName: file.name, size: file.size } } })
    .catch(() => {});

  after(() => notifyAttachmentTelegram(taskId, blob.url, file.name, file.type || null));

  revalidatePath(`/tasks/${taskId}`);
  return { ok: true, attachment: { ...att, userName: att.user.name, userId: att.user.id } };
}

export async function deleteAttachmentAction(
  attachmentId: string,
  taskId: string,
): Promise<{ ok?: boolean; error?: string }> {
  const user = await requireUser();
  if (DEMO) return { error: "Mod demo." };

  const att = await prisma.taskAttachment.findUnique({
    where: { id: attachmentId },
    select: { userId: true, url: true, name: true },
  });
  if (!att) return { error: "Atașament inexistent." };
  if (att.userId !== user.id && !can(user, "tasks.delete")) {
    return { error: "Nu poți șterge atașamentul altcuiva." };
  }

  const { env } = await import("@/lib/env");
  if (env.blob.enabled) {
    const { del } = await import("@vercel/blob");
    await del(att.url).catch(() => {});
  }
  await prisma.taskAttachment.delete({ where: { id: attachmentId } });
  await prisma.taskActivity
    .create({ data: { taskId, userId: user.id, action: "ATTACHMENT_DELETED", meta: { fileName: att.name } } })
    .catch(() => {});

  revalidatePath(`/tasks/${taskId}`);
  return { ok: true };
}

export type ProjectTaskRow = {
  id: string;
  seq: number | null;
  title: string;
  status: string;
  priority: string;
  assigneeName: string | null;
  teamName: string | null;
  dueAt: Date | null;
};

export async function getProjectTasksAction(projectId: string): Promise<ProjectTaskRow[]> {
  await requireUser();
  const tasks = await prisma.task.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      seq: true,
      title: true,
      status: true,
      priority: true,
      dueAt: true,
      assignee: { select: { name: true } },
      team: { select: { name: true } },
    },
  });
  return tasks.map((t) => ({
    id: t.id,
    seq: t.seq ?? null,
    title: t.title,
    status: t.status,
    priority: t.priority,
    assigneeName: t.assignee?.name ?? null,
    teamName: t.team?.name ?? null,
    dueAt: t.dueAt,
  }));
}

export async function deleteTask(id: string): Promise<void> {
  const user = await requireUser();
  if (!can(user, "tasks.delete")) return;
  if (DEMO) return;
  const task = await prisma.task.findUnique({ where: { id }, select: { title: true, type: true } });
  await prisma.taskActivity.deleteMany({ where: { taskId: id } });
  await prisma.taskComment.deleteMany({ where: { taskId: id } });
  await prisma.task.delete({ where: { id } }).catch(() => {});
  if (task) {
    await logAudit(
      { id: user.id, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin },
      { action: `${prefixForType(task.type)}.delete`, module: moduleForType(task.type), objectId: id, objectName: task.title },
    );
  }
  revalidateTasks();
}
