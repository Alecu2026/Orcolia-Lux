import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import {
  sendMessage,
  editMessageText,
  deleteMessage,
  sendPhoto,
  sendDocument,
  taskStatusButtons,
  taskOpenButton,
  TASK_STATUS_RO,
  TASK_TYPE_RO,
  TASK_PRIORITY_RO,
} from "../telegram";
import { formatTime, formatDate, DEFAULT_TZ } from "../date";
import { env } from "../env";
import { notifyUsers, observerRecipients, filteredAdminRecipients } from "./notifications";
import type { TaskStatus, TaskType, TaskPriority, CreatedFrom } from "@prisma/client";

/** Contor atomic (MongoDB nu are autoincrement nativ) — folosit pentru Task.seq. */
async function nextSeq(name: string): Promise<number> {
  const counter = await prisma.counter.upsert({
    where: { name },
    create: { name, value: 1 },
    update: { value: { increment: 1 } },
    select: { value: true },
  });
  return counter.value;
}

export type AssignmentSetting = {
  userId?: string;
  teamId?: string;
  notifyUntilStatus?: string | null;
};

const STATUS_ORDER: string[] = [
  "NEW", "ASSIGNED", "READ", "IN_PROGRESS", "ON_HOLD", "REVIEW", "DONE", "CANCELLED",
];

function shouldNotifyByThreshold(
  settings: AssignmentSetting[],
  recipientId: string,
  isTeam: boolean,
  newStatus: string,
): boolean {
  const s = settings.find((x) => (isTeam ? x.teamId === recipientId : x.userId === recipientId));
  if (!s?.notifyUntilStatus) return true;
  return STATUS_ORDER.indexOf(newStatus) <= STATUS_ORDER.indexOf(s.notifyUntilStatus);
}

export type CreateTaskInput = {
  title: string;
  description?: string;
  type?: TaskType;
  priority?: TaskPriority;
  dueAt?: Date | null;
  assigneeId?: string | null;
  teamId?: string | null;
  extraAssigneeIds?: string[];
  extraTeamIds?: string[];
  assignmentSettingsJson?: string | null;
  projectId?: string | null;
  clientId?: string | null;
  categoryId?: string | null;
  reminderIntervalMinutes?: number | null;
  bypassQuietHours?: boolean;
};

/** Chat Telegram al unui user: întâi cel setat manual, apoi contul linkat prin bot. */
async function telegramChatFor(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { telegramChatId: true, telegramAccounts: { select: { chatId: true }, take: 1 } },
  });
  return u?.telegramChatId || u?.telegramAccounts[0]?.chatId || null;
}

/** URL-ul PWA pentru un task (pagina dedicată de detalii). */
function taskUrl(taskId: string): string {
  return `${env.appUrl}/tasks/${taskId}`;
}

/** "#123" ca hyperlink HTML — textul "#N" este el însuși ancora, clic-abil în Telegram. */
function taskRef(seq: number | null | undefined, taskId: string): string {
  const label = seq != null ? `#${seq}` : "#—";
  return `<a href="${taskUrl(taskId)}">${label}</a>`;
}

/** Mesaj Telegram dedicat schimbării de status/progres/comentariu (format fix, lizibil). */
function taskUpdateTelegramText(
  actorName: string,
  taskTitle: string,
  statusLabel: string,
  taskId: string,
  seq: number | null | undefined,
  lineLabel: string = "Status",
): string {
  const time = formatTime(new Date(), DEFAULT_TZ);
  return [
    "🔔 <b>Actualizare task</b>",
    "",
    `Lucrător: ${escapeHtml(actorName)}`,
    `Task: ${escapeHtml(taskTitle)} (${taskRef(seq, taskId)})`,
    `${lineLabel}: <b>${escapeHtml(statusLabel)}</b>`,
    `Ora: ${time}`,
  ].join("\n");
}

/** Mesaj Telegram pentru task întârziat (fără actor — notificare automată). */
function taskOverdueTelegramText(taskTitle: string, taskId: string, seq: number | null | undefined): string {
  const time = formatTime(new Date(), DEFAULT_TZ);
  return [
    "⏰ <b>Task în întârziere</b>",
    "",
    `Task: ${escapeHtml(taskTitle)} (${taskRef(seq, taskId)})`,
    `Ora: ${time}`,
  ].join("\n");
}

/** Trimite mesajul de actualizare pe Telegram către fiecare destinatar cu chat legat (best-effort, logat). */
async function notifyTaskUpdateTelegram(
  userIds: string[],
  info: {
    actorName: string;
    taskTitle: string;
    statusLabel: string;
    taskId: string;
    seq: number | null | undefined;
    lineLabel?: string;
  },
): Promise<void> {
  const text = taskUpdateTelegramText(
    info.actorName,
    info.taskTitle,
    info.statusLabel,
    info.taskId,
    info.seq,
    info.lineLabel,
  );
  await Promise.all(
    userIds.map(async (uid) => {
      try {
        const chatId = await telegramChatFor(uid);
        if (!chatId) {
          console.log(`[tasks] telegram: user ${uid} nu are chat Telegram legat — sărit`);
          return;
        }
        const res = await sendMessage(chatId, text, taskOpenButton(info.seq, info.taskId));
        if (!res) {
          console.error(`[tasks] telegram: sendMessage a eșuat pentru user ${uid}`);
        }
      } catch (e) {
        console.error(`[tasks] telegram: notificare eșuată pentru user ${uid}`, e);
      }
    }),
  );
}

/** Trimite mesajul de „task întârziat" pe Telegram (fără actor — notificare automată). */
async function notifyTaskOverdueTelegram(
  userIds: string[],
  taskTitle: string,
  taskId: string,
  seq: number | null | undefined,
): Promise<void> {
  const text = taskOverdueTelegramText(taskTitle, taskId, seq);
  await Promise.all(
    userIds.map(async (uid) => {
      try {
        const chatId = await telegramChatFor(uid);
        if (!chatId) return;
        const res = await sendMessage(chatId, text, taskOpenButton(seq, taskId));
        if (!res) console.error(`[tasks] telegram: sendMessage (overdue) a eșuat pentru user ${uid}`);
      } catch (e) {
        console.error(`[tasks] telegram: notificare overdue eșuată pentru user ${uid}`, e);
      }
    }),
  );
}

/** Textul notificării in-app, exact pe tipul de tranziție (cerut de spec). */
function taskLabel(seq: number | null | undefined, title: string): string {
  const t = title.length > 40 ? `${title.slice(0, 40)}…` : title;
  return seq != null ? `#${seq} · ${t}` : t;
}

/**
 * Creează un task. NU trimite notificări aici (ca o problemă de Telegram să NU
 * pice crearea). Pentru notificări apelează separat `notifyNewTask`.
 */
export async function createTask(
  creatorId: string,
  input: CreateTaskInput,
  source: CreatedFrom = "WEB",
) {
  if (DEMO) return { ok: false as const, error: "Mod demo: conectează o bază de date." };
  if (!input.title?.trim()) return { ok: false as const, error: "Titlul e obligatoriu." };

  let assigneeId = input.assigneeId || null;
  let teamId = input.teamId || null;
  let clientId: string | null = null;

  if (input.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: input.projectId },
      select: { assigneeId: true, teamId: true, clientId: true },
    });
    if (project) {
      clientId = project.clientId ?? null;
      if (!assigneeId && !teamId) {
        assigneeId = project.assigneeId;
        teamId = project.teamId;
      }
    }
  } else {
    clientId = input.clientId || null;
  }
  if (!assigneeId && !teamId) assigneeId = creatorId;

  // Asignat cuiva => ASSIGNED; altfel NEW
  const status: TaskStatus = assigneeId || teamId ? "ASSIGNED" : "NEW";
  const seq = await nextSeq("task");

  const intervalMin = input.reminderIntervalMinutes || null;
  const nextReminderAt = intervalMin ? new Date(Date.now() + intervalMin * 60_000) : null;

  const task = await prisma.task.create({
    data: {
      seq,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      type: input.type ?? "TASK",
      priority: input.priority ?? "MEDIUM",
      dueAt: input.dueAt ?? null,
      creatorId,
      assigneeId,
      teamId,
      extraAssigneeIds: input.extraAssigneeIds ?? [],
      extraTeamIds: input.extraTeamIds ?? [],
      assignmentSettingsJson: input.assignmentSettingsJson ?? null,
      projectId: input.projectId || null,
      categoryId: input.categoryId || null,
      clientId,
      createdFrom: source,
      status,
      reminderIntervalMinutes: intervalMin,
      nextReminderAt,
      bypassQuietHours: input.bypassQuietHours ?? false,
    },
    select: { id: true, title: true, seq: true },
  });

  return { ok: true as const, id: task.id, title: task.title, seq: task.seq };
}

/** Trimite notificarea de task nou către asignat / membrii echipei (best-effort). */
export async function notifyNewTask(taskId: string): Promise<void> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        seq: true,
        title: true,
        description: true,
        type: true,
        priority: true,
        status: true,
        creatorId: true,
        assigneeId: true,
        teamId: true,
        extraAssigneeIds: true,
        extraTeamIds: true,
        assignmentSettingsJson: true,
        assignee: { select: { name: true, teamIds: true } },
        project: { select: { name: true, lat: true, lng: true, address: true } },
      },
    });
    if (!task) return;

    const assignmentSettings: AssignmentSetting[] = task.assignmentSettingsJson
      ? (JSON.parse(task.assignmentSettingsJson) as AssignmentSetting[])
      : [];

    const recipients = new Set<string>();
    if (task.assigneeId) recipients.add(task.assigneeId);
    if (task.teamId) {
      const team = await prisma.team.findUnique({
        where: { id: task.teamId },
        select: { memberIds: true },
      });
      team?.memberIds.forEach((id) => recipients.add(id));
    }
    for (const uid of (task.extraAssigneeIds ?? [])) recipients.add(uid);
    for (const tid of (task.extraTeamIds ?? [])) {
      const team = await prisma.team.findUnique({ where: { id: tid }, select: { memberIds: true } });
      team?.memberIds.forEach((id) => recipients.add(id));
    }

    const lines = [
      `🆕 <b>${TASK_TYPE_RO[task.type]} nou</b> (${taskRef(task.seq, task.id)})`,
      `<b>${escapeHtml(task.title)}</b>`,
    ];
    if (task.description?.trim()) {
      lines.push("", escapeHtml(task.description.trim()));
    }
    lines.push(
      "",
      `⚑ Prioritate: <b>${TASK_PRIORITY_RO[task.priority]}</b>`,
    );
    if (task.assignee?.name) lines.push(`👤 Asignat: ${escapeHtml(task.assignee.name)}`);
    if (task.project?.name) lines.push(`📁 Proiect: ${escapeHtml(task.project.name)}`);
    lines.push(`Status: <b>${TASK_STATUS_RO[task.status]}</b>`);

    const proj = task.project as { name: string; lat: number | null; lng: number | null; address: string | null } | null;
    if (proj?.lat != null && proj?.lng != null) {
      lines.push(
        `📍 <a href="https://www.google.com/maps?q=${proj.lat},${proj.lng}">Google Maps</a>` +
        ` | <a href="https://waze.com/ul?ll=${proj.lat},${proj.lng}&navigate=yes">Waze</a>` +
        ` | <a href="https://maps.apple.com/?ll=${proj.lat},${proj.lng}">Apple Maps</a>`,
      );
    } else if (proj?.address) {
      lines.push(`📍 <a href="https://www.google.com/maps?q=${encodeURIComponent(proj.address)}">Google Maps</a>`);
    }

    const text = lines.join("\n");

    let stored = false;
    for (const uid of recipients) {
      try {
        if (!shouldNotifyByThreshold(assignmentSettings, uid, false, task.status)) continue;
        const chatId = await telegramChatFor(uid);
        if (!chatId) continue;
        const res = (await sendMessage(chatId, text, taskStatusButtons(task.id))) as {
          message_id?: number;
        } | null;
        if (res?.message_id && uid === task.assigneeId && !stored) {
          await prisma.task
            .update({
              where: { id: task.id },
              data: { telegramChatId: chatId, telegramMessageId: res.message_id },
            })
            .catch(() => {});
          stored = true;
        }
      } catch {
        // ignoră eșecul per-destinatar
      }
    }

    // In-app + push pentru asignat/echipă (Telegram cu butoane a fost deja trimis mai sus)
    await notifyUsers(
      [...recipients],
      {
        title: `${TASK_TYPE_RO[task.type]} nou: ${taskLabel(task.seq, task.title)}`,
        body: task.project?.name ? `Proiect: ${task.project.name}` : undefined,
        taskId: task.id,
        seq: task.seq,
        url: `/tasks/${task.id}`,
      },
      { telegram: false },
    );

    // Observatori (staff cu evenimentul bifat) + administratori filtrați (echipă/membru/eveniment).
    const createdKey = task.type === "TICKET" ? "ticket.created" : "task.created";
    const eventKeys = task.assigneeId ? [createdKey, "task.assigned"] : [createdKey];
    const admins = await filteredAdminRecipients({
      eventKeys,
      teamIds: [task.teamId, ...(task.assignee?.teamIds ?? [])],
      memberIds: [task.assigneeId, task.creatorId],
    });
    const observerIds = new Set<string>([...admins, ...(await observerRecipients(createdKey))]);
    if (task.assigneeId) {
      for (const id of await observerRecipients("task.assigned")) observerIds.add(id);
    }
    observerIds.delete(task.creatorId); // creatorul știe deja
    for (const id of recipients) observerIds.delete(id); // deja notificați ca direcți
    console.log(`[tasks] notifyNewTask: ${observerIds.size} observatori/admini de notificat pentru task ${task.id}`);
    if (observerIds.size > 0) {
      await notifyUsers(
        [...observerIds],
        {
          title: `${TASK_TYPE_RO[task.type]} nou: ${taskLabel(task.seq, task.title)}`,
          body: task.assignee?.name
            ? `Asignat: ${task.assignee.name}`
            : task.project?.name
              ? `Proiect: ${task.project.name}`
              : undefined,
          taskId: task.id,
          seq: task.seq,
          url: `/tasks/${task.id}`,
        },
        { telegram: true },
      );
    }
  } catch (e) {
    console.error(`[tasks] notifyNewTask: eșuat pentru task ${taskId}`, e);
  }
}

/** Schimbă statusul + jurnal + notificare admin/creator (best-effort, logat). */
export async function changeTaskStatus(
  taskId: string,
  actorId: string,
  newStatus: TaskStatus,
  opts: { fromTelegram?: boolean } = {},
) {
  console.log(`[tasks] changeTaskStatus: task=${taskId} actor=${actorId} -> ${newStatus}`);
  if (DEMO) return { ok: false as const, error: "Mod demo." };

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      seq: true,
      title: true,
      description: true,
      type: true,
      status: true,
      creatorId: true,
      assigneeId: true,
      teamId: true,
      extraAssigneeIds: true,
      extraTeamIds: true,
      assignmentSettingsJson: true,
      telegramChatId: true,
      telegramMessageId: true,
      assignee: { select: { teamIds: true } },
      project: { select: { lat: true, lng: true, address: true } },
    },
  });
  if (!task) {
    console.error(`[tasks] changeTaskStatus: task ${taskId} nu există`);
    return { ok: false as const, error: "Task inexistent." };
  }
  if (task.status === newStatus) {
    console.log(`[tasks] changeTaskStatus: deja ${newStatus}, nimic de făcut`);
    return { ok: true as const, changed: false, fromStatus: task.status, title: task.title, type: task.type, hadTelegramMessage: false };
  }

  // Verifică dacă actorul are dreptul să modifice task-ul (din callback Telegram)
  if (opts.fromTelegram) {
    const actorUser = await prisma.user.findUnique({ where: { id: actorId }, select: { teamIds: true, role: true } });
    const actorTeams = actorUser?.teamIds ?? [];
    const isAdmin = actorUser?.role === "ADMIN";
    const isCreator = task.creatorId === actorId;
    const isDirectlyAssigned =
      task.assigneeId === actorId ||
      (task.extraAssigneeIds ?? []).includes(actorId);
    const isTeamAssigned =
      (task.teamId && actorTeams.includes(task.teamId)) ||
      (task.extraTeamIds ?? []).some((tid) => actorTeams.includes(tid));
    if (!isAdmin && !isCreator && !isDirectlyAssigned && !isTeamAssigned) {
      return { ok: false as const, error: "Nu ai acces la acest task." };
    }
  }

  const closed = newStatus === "DONE" || newStatus === "CANCELLED";
  await prisma.task.update({
    where: { id: taskId },
    data: { status: newStatus, ...(closed ? { nextReminderAt: null } : {}) },
  });
  await prisma.taskActivity
    .create({ data: { taskId, userId: actorId, action: "STATUS_CHANGED", fromStatus: task.status, toStatus: newStatus } })
    .catch((e) => console.error(`[tasks] changeTaskStatus: jurnalizare TaskActivity eșuată pentru ${taskId}`, e));
  console.log(`[tasks] changeTaskStatus: salvat în DB — ${task.status} → ${newStatus}`);

  // Notificări best-effort (nu afectează rezultatul scrierii de mai sus)
  try {
    const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true, teamIds: true } });
    const actorName = actor?.name ?? "Cineva";

    // Direcți: creatorul + asignatul. Administratorii: filtrați după echipă/membru/tip eveniment
    // (notifyScope din Settings utilizator). Observatori: cei cu „Status task schimbat" bifat.
    const eventKeys =
      newStatus === "READ" ? ["task.status", "task.read"]
      : newStatus === "DONE" ? ["task.status", "task.done"]
      : ["task.status"];
    const assignmentSettings: AssignmentSetting[] = task.assignmentSettingsJson
      ? (JSON.parse(task.assignmentSettingsJson) as AssignmentSetting[])
      : [];

    // Collect all extra-assigned user IDs (direct + via extra teams)
    const extraDirectIds = task.extraAssigneeIds ?? [];
    const extraTeamMemberIds: string[] = [];
    for (const tid of (task.extraTeamIds ?? [])) {
      const t = await prisma.team.findUnique({ where: { id: tid }, select: { memberIds: true } });
      t?.memberIds.forEach((id) => extraTeamMemberIds.push(id));
    }

    const admins = await filteredAdminRecipients({
      eventKeys,
      teamIds: [task.teamId, ...(task.extraTeamIds ?? []), ...(task.assignee?.teamIds ?? []), ...(actor?.teamIds ?? [])],
      memberIds: [actorId, task.assigneeId, ...extraDirectIds],
    });
    const recipients = new Set<string>([
      task.creatorId,
      ...admins,
      ...(await observerRecipients("task.status")),
    ]);
    if (task.assigneeId && shouldNotifyByThreshold(assignmentSettings, task.assigneeId, false, newStatus)) {
      recipients.add(task.assigneeId);
    }
    for (const uid of extraDirectIds) {
      if (shouldNotifyByThreshold(assignmentSettings, uid, false, newStatus)) recipients.add(uid);
    }
    if (task.teamId && shouldNotifyByThreshold(assignmentSettings, task.teamId, true, newStatus)) {
      const t = await prisma.team.findUnique({ where: { id: task.teamId }, select: { memberIds: true } });
      t?.memberIds.forEach((id) => recipients.add(id));
    }
    for (const uid of extraTeamMemberIds) recipients.add(uid);
    recipients.delete(actorId);
    const recipientIds = [...recipients];
    console.log(`[tasks] changeTaskStatus: ${recipientIds.length} destinatari de notificat`, recipientIds);

    // In-app + push (Telegram trimis separat mai jos, cu format dedicat)
    await notifyUsers(
      recipientIds,
      {
        title: `${taskLabel(task.seq, task.title)} → ${TASK_STATUS_RO[newStatus]}`,
        body: `de ${actorName}`,
        taskId: task.id,
        seq: task.seq,
        url: `/tasks/${task.id}`,
      },
      { telegram: false },
    );
    await notifyTaskUpdateTelegram(recipientIds, {
      actorName,
      taskTitle: task.title,
      statusLabel: TASK_STATUS_RO[newStatus],
      taskId: task.id,
      seq: task.seq,
    });

    if (opts.fromTelegram && task.telegramChatId && task.telegramMessageId) {
      const editLines = [
        `📋 <b>${TASK_TYPE_RO[task.type]}</b> (${taskRef(task.seq, task.id)})`,
        `<b>${escapeHtml(task.title)}</b>`,
      ];
      if (!closed && task.description?.trim()) {
        editLines.push("", escapeHtml(task.description.trim()));
      }
      editLines.push("", `Status: <b>${TASK_STATUS_RO[newStatus]}</b>`);
      const tp = task.project as { lat: number | null; lng: number | null; address: string | null } | null;
      if (tp?.lat != null && tp?.lng != null) {
        editLines.push(`​<a href="https://maps.google.com/maps?q=${tp.lat},${tp.lng}">​</a>`);
      } else if (tp?.address) {
        editLines.push(`​<a href="https://maps.google.com/maps?q=${encodeURIComponent(tp.address)}">​</a>`);
      }
      await editMessageText(
        task.telegramChatId,
        task.telegramMessageId,
        editLines.join("\n"),
        taskStatusButtons(task.id),
      );
    }
  } catch (e) {
    console.error(`[tasks] changeTaskStatus: pipeline-ul de notificare a eșuat pentru task ${taskId}`, e);
  }

  return { ok: true as const, changed: true, fromStatus: task.status, title: task.title, type: task.type, hadTelegramMessage: !!(task.telegramChatId && task.telegramMessageId) };
}

/** Schimbă progresul (0-100) + jurnal + notificare admin/creator (best-effort, logat). */
export async function changeTaskProgress(taskId: string, actorId: string, progress: number) {
  console.log(`[tasks] changeTaskProgress: task=${taskId} actor=${actorId} -> ${progress}%`);
  if (DEMO) return { ok: false as const, error: "Mod demo." };
  const p = Math.max(0, Math.min(100, Math.round(progress)));
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      seq: true,
      title: true,
      type: true,
      progress: true,
      creatorId: true,
      assigneeId: true,
      teamId: true,
      assignee: { select: { teamIds: true } },
    },
  });
  if (!task) {
    console.error(`[tasks] changeTaskProgress: task ${taskId} nu există`);
    return { ok: false as const, error: "Task inexistent." };
  }
  if (task.progress === p) {
    console.log(`[tasks] changeTaskProgress: deja ${p}%, nimic de făcut`);
    return { ok: true as const, changed: false, fromProgress: task.progress, title: task.title, type: task.type };
  }

  await prisma.task.update({ where: { id: taskId }, data: { progress: p } });
  console.log(`[tasks] changeTaskProgress: salvat în DB — ${task.progress}% → ${p}%`);

  try {
    const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true, teamIds: true } });
    const actorName = actor?.name ?? "Cineva";

    const admins = await filteredAdminRecipients({
      eventKeys: ["task.progress"],
      teamIds: [task.teamId, ...(task.assignee?.teamIds ?? []), ...(actor?.teamIds ?? [])],
      memberIds: [actorId, task.assigneeId],
    });
    const recipients = new Set<string>([
      task.creatorId,
      ...admins,
      ...(await observerRecipients("task.progress")),
    ]);
    if (task.assigneeId) recipients.add(task.assigneeId);
    recipients.delete(actorId);
    const recipientIds = [...recipients];
    console.log(`[tasks] changeTaskProgress: ${recipientIds.length} destinatari de notificat`, recipientIds);

    await notifyUsers(
      recipientIds,
      {
        title: `${taskLabel(task.seq, task.title)} · ${p}%`,
        body: `de ${actorName}`,
        taskId: task.id,
        seq: task.seq,
        url: `/tasks/${task.id}`,
      },
      { telegram: false },
    );
    await notifyTaskUpdateTelegram(recipientIds, {
      actorName,
      taskTitle: task.title,
      statusLabel: `Progres ${p}%`,
      taskId: task.id,
      seq: task.seq,
    });
  } catch (e) {
    console.error(`[tasks] changeTaskProgress: pipeline-ul de notificare a eșuat pentru task ${taskId}`, e);
  }
  return { ok: true as const, changed: true, fromProgress: task.progress, title: task.title, type: task.type };
}

/** Adaugă un comentariu pe task + notificare (web sau Telegram, best-effort, logat). */
export async function addTaskComment(
  taskId: string,
  actorId: string,
  body: string,
  source: CreatedFrom = "WEB",
) {
  console.log(`[tasks] addTaskComment: task=${taskId} actor=${actorId} source=${source}`);
  if (DEMO) return { ok: false as const, error: "Mod demo." };
  const text = body.trim();
  if (!text) return { ok: false as const, error: "Comentariul e gol." };

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      seq: true,
      title: true,
      creatorId: true,
      assigneeId: true,
      teamId: true,
      assignee: { select: { teamIds: true } },
    },
  });
  if (!task) {
    console.error(`[tasks] addTaskComment: task ${taskId} nu există`);
    return { ok: false as const, error: "Task inexistent." };
  }

  const comment = await prisma.taskComment.create({
    data: { taskId, userId: actorId, body: text, source },
    select: { id: true, createdAt: true },
  });
  console.log(`[tasks] addTaskComment: salvat comentariu ${comment.id} pe task ${taskId}`);
  await prisma.taskActivity
    .create({ data: { taskId, userId: actorId, action: "COMMENTED", meta: { body: text.length > 200 ? `${text.slice(0, 200)}…` : text } } })
    .catch(() => {});

  try {
    const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true, teamIds: true } });
    const actorName = actor?.name ?? "Cineva";

    const admins = await filteredAdminRecipients({
      eventKeys: ["task.comment"],
      teamIds: [task.teamId, ...(task.assignee?.teamIds ?? []), ...(actor?.teamIds ?? [])],
      memberIds: [actorId, task.assigneeId],
    });
    const recipients = new Set<string>([
      task.creatorId,
      ...admins,
      ...(await observerRecipients("task.comment")),
    ]);
    if (task.assigneeId) recipients.add(task.assigneeId);
    recipients.delete(actorId);
    const recipientIds = [...recipients];
    console.log(`[tasks] addTaskComment: ${recipientIds.length} destinatari de notificat`);

    const preview = text.length > 100 ? `${text.slice(0, 100)}…` : text;
    await notifyUsers(
      recipientIds,
      {
        title: taskLabel(task.seq, task.title),
        body: `${actorName}: ${preview}`,
        taskId: task.id,
        seq: task.seq,
        url: `/tasks/${task.id}`,
      },
      { telegram: false },
    );
    await notifyTaskUpdateTelegram(recipientIds, {
      actorName,
      taskTitle: task.title,
      statusLabel: preview,
      taskId: task.id,
      seq: task.seq,
      lineLabel: "Comentariu",
    });
  } catch (e) {
    console.error(`[tasks] addTaskComment: pipeline de notificare eșuat pentru task ${taskId}`, e);
  }

  return { ok: true as const, id: comment.id };
}

/** Comentariile unui task, în ordine cronologică. */
export async function listTaskComments(taskId: string) {
  if (DEMO) return [];
  return prisma.taskComment.findMany({
    where: { taskId },
    select: { id: true, body: true, source: true, createdAt: true, user: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Verifică task-urile cu termen trecut, nefinalizate, și trimite notificarea de
 * întârziere o singură dată (overdueNotifiedAt). Apelată periodic (cron).
 */
export async function checkOverdueTasks(): Promise<{ checked: number; notified: number }> {
  if (DEMO) return { checked: 0, notified: 0 };
  const now = new Date();

  const { loadStatusConfigs } = await import("../queries/ticket-status-config");
  const { getStatusConfig } = await import("../ticket-status-config");
  const statusCfgs = await loadStatusConfigs();

  // Filtrăm în JS pentru că MongoDB nu potrivește câmpuri absente cu { equals: null }
  const candidates = await prisma.task.findMany({
    where: {
      dueAt: { lt: now },
      status: { notIn: ["DONE", "CANCELLED"] },
    },
    select: {
      id: true, seq: true, title: true, status: true,
      creatorId: true, assigneeId: true, teamId: true,
      overdueNotifiedAt: true,
      assignee: { select: { teamIds: true } },
    },
  });
  const tasks = candidates.filter((t) => {
    if (t.overdueNotifiedAt) return false;
    // Nu trimite dacă statusul curent are suppressAll activ
    const cfg = getStatusConfig(statusCfgs, t.status);
    if (cfg?.suppressAll) return false;
    return true;
  });
  console.log(`[tasks] checkOverdueTasks: ${candidates.length} cu termen trecut, ${tasks.length} nenotificate`);

  let notified = 0;
  for (const task of tasks) {
    try {
      // Marcăm ÎNAINTE de trimitere — previne trimiteri duble dacă cron-ul rulează în paralel
      await prisma.task.update({ where: { id: task.id }, data: { overdueNotifiedAt: now } });

      const admins = await filteredAdminRecipients({
        eventKeys: ["task.overdue"],
        teamIds: [task.teamId, ...(task.assignee?.teamIds ?? [])],
        memberIds: [task.assigneeId, task.creatorId],
      });
      const recipients = new Set<string>([
        task.creatorId,
        ...admins,
        ...(await observerRecipients("task.overdue")),
      ]);
      if (task.assigneeId) recipients.add(task.assigneeId);
      const recipientIds = [...recipients];

      await notifyUsers(
        recipientIds,
        {
          title: `⏰ ${taskLabel(task.seq, task.title)} – Întârziat`,
          taskId: task.id,
          seq: task.seq,
          url: `/tasks/${task.id}`,
        },
        { telegram: false },
      );
      await notifyTaskOverdueTelegram(recipientIds, task.title, task.id, task.seq);
      notified++;
    } catch (e) {
      console.error(`[tasks] checkOverdueTasks: eșuat pentru task ${task.id}`, e);
    }
  }
  console.log(`[tasks] checkOverdueTasks: ${notified}/${tasks.length} notificate`);
  return { checked: tasks.length, notified };
}

export type UpdateTaskInput = {
  title?: string;
  description?: string;
  assigneeId?: string | null;
  teamId?: string | null;
  extraAssigneeIds?: string[];
  extraTeamIds?: string[];
  assignmentSettingsJson?: string | null;
  projectId?: string | null;
  clientId?: string | null;
  categoryId?: string | null;
  priority?: TaskPriority;
  dueAt?: Date | null;
  reminderIntervalMinutes?: number | null;
  bypassQuietHours?: boolean;
};

const EDIT_PRIO_RO: Record<string, string> = { LOW: "Scăzută", MEDIUM: "Medie", HIGH: "Ridicată", URGENT: "Urgentă" };
function fmtDueLog(d: Date | null | undefined): string | null {
  if (!d) return null;
  const dk = formatDate(d, DEFAULT_TZ);
  const tk = formatTime(d, DEFAULT_TZ);
  return tk === "00:00" ? dk : `${dk} ${tk}`;
}

/** Editează câmpurile unui task și loghează câmpurile modificate în TaskActivity. */
export async function updateTask(taskId: string, actorId: string, input: UpdateTaskInput) {
  if (DEMO) return { ok: false as const, error: "Mod demo." };
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true, title: true, type: true,
      description: true, priority: true, dueAt: true,
      assigneeId: true, teamId: true, projectId: true,
      assignee: { select: { name: true } },
      team: { select: { name: true } },
      project: { select: { name: true } },
    },
  });
  if (!task) return { ok: false as const, error: "Task inexistent." };

  const data: Record<string, unknown> = {};
  if (input.title !== undefined) {
    const t = input.title.trim();
    if (!t) return { ok: false as const, error: "Titlul e obligatoriu." };
    data.title = t;
  }
  if (input.description !== undefined) data.description = input.description.trim() || null;
  if ("assigneeId" in input) data.assigneeId = input.assigneeId || null;
  if ("teamId" in input) data.teamId = input.teamId || null;
  if ("extraAssigneeIds" in input) data.extraAssigneeIds = input.extraAssigneeIds ?? [];
  if ("extraTeamIds" in input) data.extraTeamIds = input.extraTeamIds ?? [];
  if ("assignmentSettingsJson" in input) data.assignmentSettingsJson = input.assignmentSettingsJson ?? null;
  if ("projectId" in input) {
    const newProjectId = input.projectId || null;
    data.projectId = newProjectId;
    if (newProjectId) {
      const proj = await prisma.project.findUnique({ where: { id: newProjectId }, select: { clientId: true } });
      data.clientId = proj?.clientId ?? null;
    } else {
      data.clientId = input.clientId || null;
    }
  } else if ("clientId" in input) {
    data.clientId = input.clientId || null;
  }
  if ("categoryId" in input) data.categoryId = input.categoryId || null;
  if (input.priority !== undefined) data.priority = input.priority;
  if ("dueAt" in input) data.dueAt = input.dueAt ?? null;
  if ("reminderIntervalMinutes" in input) {
    const intervalMin = input.reminderIntervalMinutes || null;
    data.reminderIntervalMinutes = intervalMin;
    data.nextReminderAt = intervalMin ? new Date(Date.now() + intervalMin * 60_000) : null;
  }
  if ("bypassQuietHours" in input) data.bypassQuietHours = input.bypassQuietHours ?? false;

  await prisma.task.update({ where: { id: taskId }, data });

  // Compute diff for audit trail (best-effort, non-blocking)
  try {
    type Change = { field: string; from: string | null; to: string | null };
    const changes: Change[] = [];

    const newTitle = input.title?.trim();
    if (newTitle !== undefined && newTitle !== task.title) {
      changes.push({ field: "Titlu", from: task.title, to: newTitle });
    }

    const newDesc = input.description !== undefined ? (input.description.trim() || null) : undefined;
    if (newDesc !== undefined) {
      const oldDesc = task.description?.trim() || null;
      if (oldDesc !== newDesc) {
        const trunc = (s: string | null) => s && s.length > 80 ? `${s.slice(0, 80)}…` : s;
        changes.push({ field: "Descriere", from: trunc(oldDesc), to: trunc(newDesc) });
      }
    }

    if (input.priority !== undefined && input.priority !== task.priority) {
      changes.push({ field: "Prioritate", from: EDIT_PRIO_RO[task.priority], to: EDIT_PRIO_RO[input.priority] });
    }

    const newDue = "dueAt" in input ? (input.dueAt ?? null) : undefined;
    if (newDue !== undefined) {
      const oldDueStr = fmtDueLog(task.dueAt);
      const newDueStr = fmtDueLog(newDue);
      if (oldDueStr !== newDueStr) {
        changes.push({ field: "Deadline", from: oldDueStr, to: newDueStr });
      }
    }

    const newAssigneeId = "assigneeId" in input ? (input.assigneeId || null) : undefined;
    if (newAssigneeId !== undefined && newAssigneeId !== task.assigneeId) {
      const newAssigneeName = newAssigneeId
        ? (await prisma.user.findUnique({ where: { id: newAssigneeId }, select: { name: true } }))?.name ?? null
        : null;
      changes.push({ field: "Asignat", from: task.assignee?.name ?? null, to: newAssigneeName });
    }

    const newTeamId = "teamId" in input ? (input.teamId || null) : undefined;
    if (newTeamId !== undefined && newTeamId !== task.teamId) {
      const newTeamName = newTeamId
        ? (await prisma.team.findUnique({ where: { id: newTeamId }, select: { name: true } }))?.name ?? null
        : null;
      changes.push({ field: "Echipă", from: task.team?.name ?? null, to: newTeamName });
    }

    const newProjectId = "projectId" in input ? (input.projectId || null) : undefined;
    if (newProjectId !== undefined && newProjectId !== task.projectId) {
      const newProjectName = newProjectId
        ? (await prisma.project.findUnique({ where: { id: newProjectId }, select: { name: true } }))?.name ?? null
        : null;
      changes.push({ field: "Proiect", from: task.project?.name ?? null, to: newProjectName });
    }

    if (changes.length > 0) {
      await prisma.taskActivity
        .create({ data: { taskId, userId: actorId, action: "EDITED", meta: { changes } } })
        .catch(() => {});
    }
  } catch {
    // non-blocking
  }

  return { ok: true as const, title: (input.title?.trim() ?? task.title), type: task.type };
}

/**
 * Trimite reamintiri periodice pentru task-urile active cu `reminderIntervalMinutes` configurat.
 * Se apelează din cron-job; best-effort, nu aruncă excepție.
 */
export async function checkTaskReminders(): Promise<{ checked: number; notified: number }> {
  if (DEMO) return { checked: 0, notified: 0 };
  const now = new Date();

  const { loadStatusConfigs } = await import("../queries/ticket-status-config");
  const { getStatusConfig } = await import("../ticket-status-config");
  const statusCfgs = await loadStatusConfigs();

  const candidates = await prisma.task.findMany({
    where: { status: { notIn: ["DONE", "CANCELLED"] }, nextReminderAt: { lte: now } },
    select: {
      id: true, seq: true, title: true, description: true,
      type: true, status: true, priority: true,
      dueAt: true, reminderIntervalMinutes: true,
      creatorId: true, assigneeId: true, teamId: true,
      reminderMsgChatId: true, reminderMsgId: true,
      assignee: { select: { name: true, teamIds: true } },
      project: { select: { name: true, lat: true, lng: true, address: true } },
    },
  });
  const tasks = candidates.filter((t) => {
    if (!t.reminderIntervalMinutes) return false;
    const cfg = getStatusConfig(statusCfgs, t.status);
    if (cfg?.suppressAll) return false;
    return true;
  });

  console.log(`[tasks] checkTaskReminders: ${tasks.length}/${candidates.length} task-uri cu reamintire scadentă`);

  let notified = 0;
  for (const task of tasks) {
    try {
      // Actualizăm nextReminderAt ÎNAINTE de trimitere — previne duble la rulare paralelă
      const nextAt = new Date(now.getTime() + task.reminderIntervalMinutes! * 60_000);
      await prisma.task.update({ where: { id: task.id }, data: { nextReminderAt: nextAt } });

      const isOverdue = task.dueAt && task.dueAt < now;

      // ── Destinatari ──────────────────────────────────────────────────────────
      const admins = await filteredAdminRecipients({
        eventKeys: ["task.reminder"],
        teamIds: [task.teamId, ...(task.assignee?.teamIds ?? [])],
        memberIds: [task.assigneeId, task.creatorId],
      });
      const allRecipients = new Set<string>([task.creatorId, ...admins]);
      if (task.assigneeId) allRecipients.add(task.assigneeId);
      const recipientIds = [...allRecipients];

      // ── Telegram detaliat pentru asignat ─────────────────────────────────────
      let newReminderChatId: string | null = null;
      let newReminderMsgId: number | null = null;

      if (task.assigneeId) {
        const chatId = await telegramChatFor(task.assigneeId);
        if (chatId) {
          // Șterge reamintirea anterioară (best-effort)
          if (task.reminderMsgChatId && task.reminderMsgId) {
            await deleteMessage(task.reminderMsgChatId, task.reminderMsgId).catch(() => {});
          }

          // Construiește mesaj detaliat (același format ca notifyNewTask)
          const header = isOverdue
            ? `⏰ <b>Task în întârziere</b> (${taskRef(task.seq, task.id)})`
            : `🔔 <b>Reamintire ${TASK_TYPE_RO[task.type]}</b> (${taskRef(task.seq, task.id)})`;

          const lines = [
            header,
            `<b>${escapeHtml(task.title)}</b>`,
          ];
          if (task.description?.trim()) {
            lines.push("", escapeHtml(task.description.trim()));
          }
          lines.push(
            "",
            `⚑ Prioritate: <b>${TASK_PRIORITY_RO[task.priority]}</b>`,
            `📌 Status: <b>${TASK_STATUS_RO[task.status]}</b>`,
          );
          if (task.assignee?.name) lines.push(`👤 Asignat: ${escapeHtml(task.assignee.name)}`);
          if (task.project?.name) lines.push(`📁 Proiect: ${escapeHtml(task.project.name)}`);
          if (task.dueAt) {
            const deadlineLabel = isOverdue ? "⚠️ Deadline depășit" : "📅 Deadline";
            lines.push(`${deadlineLabel}: <b>${formatDate(task.dueAt, DEFAULT_TZ)}</b>`);
          }
          const proj = task.project as { name: string; lat: number | null; lng: number | null; address: string | null } | null;
          if (proj?.lat != null && proj?.lng != null) {
            lines.push(
              `📍 <a href="https://www.google.com/maps?q=${proj.lat},${proj.lng}">Google Maps</a>` +
              ` | <a href="https://waze.com/ul?ll=${proj.lat},${proj.lng}&navigate=yes">Waze</a>` +
              ` | <a href="https://maps.apple.com/?ll=${proj.lat},${proj.lng}">Apple Maps</a>`,
            );
          } else if (proj?.address) {
            lines.push(`📍 <a href="https://www.google.com/maps?q=${encodeURIComponent(proj.address)}">Google Maps</a>`);
          }

          const text = lines.join("\n");
          const res = (await sendMessage(chatId, text, taskStatusButtons(task.id))) as { message_id?: number } | null;
          if (res?.message_id) {
            newReminderChatId = chatId;
            newReminderMsgId = res.message_id;
          }
        }
      }

      // ── In-app + PWA + Telegram pentru ceilalți destinatari ──────────────────
      const lbl = taskLabel(task.seq, task.title);
      const notifTitle = isOverdue ? `⏰ Întârziat: ${lbl}` : `🔔 Reamintire: ${lbl}`;
      const notifBody = task.dueAt ? `Deadline: ${formatDate(task.dueAt, DEFAULT_TZ)}` : undefined;

      // Asignatul primește Telegram detaliat mai sus; ceilalți primesc notificare standard
      const othersIds = recipientIds.filter((id) => id !== task.assigneeId);
      if (othersIds.length > 0) {
        await notifyUsers(
          othersIds,
          { title: notifTitle, body: notifBody, taskId: task.id, seq: task.seq, url: `/tasks/${task.id}` },
          { telegram: true },
        );
      }
      // In-app + PWA pentru asignat (Telegram a fost trimis deja mai sus)
      if (task.assigneeId) {
        await notifyUsers(
          [task.assigneeId],
          { title: notifTitle, body: notifBody, taskId: task.id, seq: task.seq, url: `/tasks/${task.id}` },
          { telegram: false },
        );
      }

      // ── Email (best-effort) ───────────────────────────────────────────────────
      if (env.smtp.enabled) {
        const { sendTaskReminderEmail } = await import("../email");
        await Promise.all(
          recipientIds.map(async (uid) => {
            try {
              const u = await prisma.user.findUnique({ where: { id: uid }, select: { email: true, name: true } });
              if (u?.email) {
                await sendTaskReminderEmail({ to: u.email, userName: u.name, taskTitle: task.title, seq: task.seq, taskUrl: taskUrl(task.id), isOverdue: !!isOverdue });
              }
            } catch { /* best-effort */ }
          }),
        );
      }

      // ── Salvează ID mesaj Telegram (nextReminderAt a fost setat la start) ────────
      if (newReminderChatId || newReminderMsgId) {
        await prisma.task.update({
          where: { id: task.id },
          data: {
            reminderMsgChatId: newReminderChatId,
            reminderMsgId: newReminderMsgId,
          },
        });
      }
      notified++;
    } catch (e) {
      console.error(`[tasks] checkTaskReminders: eșuat pentru task ${task.id}`, e);
    }
  }

  console.log(`[tasks] checkTaskReminders: ${notified}/${tasks.length} notificate`);
  return { checked: tasks.length, notified };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Trimite un atașament (imagine sau fișier) pe Telegram către toți
 * destinatarii task-ului (asignat + echipă + extra).
 */
export async function notifyAttachmentTelegram(
  taskId: string,
  attUrl: string,
  attName: string,
  mimeType: string | null,
): Promise<void> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        seq: true, title: true, type: true,
        assigneeId: true, teamId: true,
        extraAssigneeIds: true, extraTeamIds: true,
      },
    });
    if (!task) return;

    // Colectează destinatarii
    const recipients = new Set<string>();
    if (task.assigneeId) recipients.add(task.assigneeId);
    if (task.teamId) {
      const team = await prisma.team.findUnique({ where: { id: task.teamId }, select: { memberIds: true } });
      team?.memberIds.forEach((id) => recipients.add(id));
    }
    for (const uid of (task.extraAssigneeIds ?? [])) recipients.add(uid);
    for (const tid of (task.extraTeamIds ?? [])) {
      const team = await prisma.team.findUnique({ where: { id: tid }, select: { memberIds: true } });
      team?.memberIds.forEach((id) => recipients.add(id));
    }
    if (!recipients.size) return;

    const typeLabel = TASK_TYPE_RO[task.type] ?? "Task";
    const ref = task.seq != null ? `#${task.seq}` : taskId.slice(-6);
    const caption = `📎 <b>${escapeHtml(attName)}</b>\n${typeLabel} ${ref}: ${escapeHtml(task.title)}`;
    const keyboard = taskOpenButton(task.seq, taskId);
    const isImage = mimeType?.startsWith("image/") && !mimeType.includes("svg");

    for (const uid of recipients) {
      try {
        const chatId = await telegramChatFor(uid);
        if (!chatId) continue;
        if (isImage) {
          await sendPhoto(chatId, attUrl, caption, keyboard);
        } else {
          await sendDocument(chatId, attUrl, caption, keyboard);
        }
      } catch {
        // ignoră eșecul per-destinatar
      }
    }
  } catch (e) {
    console.error("[tasks] notifyAttachmentTelegram eșuat:", e);
  }
}
