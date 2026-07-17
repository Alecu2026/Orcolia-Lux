import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { processDueReminders } from "@/lib/services/reminders";
import { checkOverdueTasks, checkTaskReminders } from "@/lib/services/tasks";
import { notifyUsers, filteredAdminRecipients } from "@/lib/services/notifications";
import { checkUnansweredEmailTickets, checkAutoCloseEmailTickets } from "@/lib/services/email-ticket";
import { pollInbox } from "@/lib/services/imap-poller";
import { TASK_STATUS_RO, TASK_TYPE_RO } from "@/lib/telegram";
import { formatTime, DEFAULT_TZ } from "@/lib/date";
import type { TaskStatus } from "@prisma/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CHECKPOINT = "task-notifications";

function label(seq: number | null | undefined, title: string) {
  const t = title.length > 40 ? `${title.slice(0, 40)}…` : title;
  return seq != null ? `#${seq} · ${t}` : t;
}

async function run() {
  const now = new Date();

  // ── Checkpoint: ultima rulare ────────────────────────────────────────────
  const ckpt = await prisma.cronState.upsert({
    where: { key: CHECKPOINT },
    create: { key: CHECKPOINT, lastRunAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    update: {},
    select: { lastRunAt: true },
  });
  const since = ckpt.lastRunAt;

  // ── Toate job-urile în paralel ───────────────────────────────────────────
  const [remindersR, , , statusR, newTasksR, apptR, unansweredR, autoCloseR, imapR] = await Promise.allSettled([
    processDueReminders(),
    checkTaskReminders(),
    checkOverdueTasks(),
    processStatusChanges(since, now),
    processNewAdminTasks(since, now),
    processUpcomingAppointments(since, now),
    checkUnansweredEmailTickets(),
    checkAutoCloseEmailTickets(),
    pollInbox(),
  ]);

  const processed =
    (remindersR.status === "fulfilled" ? remindersR.value.processed : 0) +
    (statusR.status === "fulfilled" ? statusR.value : 0) +
    (newTasksR.status === "fulfilled" ? newTasksR.value : 0) +
    (apptR.status === "fulfilled" ? apptR.value : 0) +
    (unansweredR.status === "fulfilled" ? unansweredR.value : 0) +
    (autoCloseR.status === "fulfilled" ? autoCloseR.value : 0) +
    (imapR.status === "fulfilled" ? imapR.value.processed : 0);

  // ── Actualizează checkpoint ──────────────────────────────────────────────
  await prisma.cronState.update({
    where: { key: CHECKPOINT },
    data: { lastRunAt: now },
  });

  return NextResponse.json({ success: true, processed, timestamp: now.toISOString() });
}

/**
 * Schimbări de status făcute de STAFF (lucrători) → notifică admini.
 * Dedup: dacă notificarea in-app există deja (trimisă inline), sare peste.
 */
async function processStatusChanges(since: Date, until: Date): Promise<number> {
  const activities = await prisma.taskActivity.findMany({
    where: {
      createdAt: { gt: since, lte: until },
      toStatus: { not: null },
      user: { role: "STAFF" },
    },
    select: {
      createdAt: true,
      toStatus: true,
      task: {
        select: {
          id: true, seq: true, title: true, type: true,
          teamId: true, assigneeId: true, creatorId: true,
        },
      },
      user: { select: { id: true, name: true } },
    },
  });

  if (activities.length === 0) return 0;

  // Batch-load notificări existente (dedup eficient, o singură query)
  const taskIds = [...new Set(activities.map((a) => a.task?.id).filter(Boolean))] as string[];
  const existingNotifs = await prisma.notification.findMany({
    where: { taskId: { in: taskIds }, createdAt: { gte: since, lte: until } },
    select: { taskId: true },
  });
  const alreadyNotified = new Set(existingNotifs.map((n) => n.taskId).filter(Boolean) as string[]);

  let count = 0;
  for (const act of activities) {
    const { task, user: actor } = act;
    if (!task || !act.toStatus) continue;
    if (alreadyNotified.has(task.id)) continue; // deja notificat inline

    const admins = await filteredAdminRecipients({
      eventKeys: ["task.status"],
      teamIds: [task.teamId],
      memberIds: [task.assigneeId, actor.id, task.creatorId],
    });
    if (admins.length === 0) continue;

    await notifyUsers(
      admins,
      {
        title: `${label(task.seq, task.title)} → ${TASK_STATUS_RO[act.toStatus as TaskStatus]}`,
        body: `de ${actor.name}`,
        taskId: task.id,
        seq: task.seq,
        url: `/tasks/${task.id}`,
      },
      { telegram: true },
    );
    alreadyNotified.add(task.id); // evită trimiteri multiple pentru același task în aceeași rulare
    count++;
  }
  return count;
}

/**
 * Task-uri noi create de ADMIN cu asignat → notifică lucrătorul asignat.
 * Dedup: dacă notificarea in-app există deja (trimisă inline), sare peste.
 */
async function processNewAdminTasks(since: Date, until: Date): Promise<number> {
  const tasks = await prisma.task.findMany({
    where: {
      createdAt: { gt: since, lte: until },
      creator: { role: "ADMIN" },
      assigneeId: { not: null },
    },
    select: {
      id: true, seq: true, title: true, type: true,
      assigneeId: true, createdAt: true,
      creator: { select: { name: true } },
      project: { select: { name: true } },
    },
  });

  if (tasks.length === 0) return 0;

  // Batch-load notificări existente
  const taskIds = tasks.map((t) => t.id);
  const existingNotifs = await prisma.notification.findMany({
    where: { taskId: { in: taskIds }, createdAt: { gte: since, lte: until } },
    select: { taskId: true, userId: true },
  });
  const alreadyNotified = new Set(existingNotifs.map((n) => `${n.taskId}:${n.userId}`));

  let count = 0;
  for (const task of tasks) {
    if (!task.assigneeId) continue;
    const key = `${task.id}:${task.assigneeId}`;
    if (alreadyNotified.has(key)) continue; // deja notificat inline

    await notifyUsers(
      [task.assigneeId],
      {
        title: `${TASK_TYPE_RO[task.type]} nou: ${label(task.seq, task.title)}`,
        body: task.project?.name
          ? `Proiect: ${task.project.name}`
          : `de ${task.creator.name}`,
        taskId: task.id,
        seq: task.seq,
        url: `/tasks/${task.id}`,
      },
      { telegram: true },
    );
    count++;
  }
  return count;
}

/**
 * Notifică adminul (proprietarul programării) cu 24h și 1h înainte.
 * Dedup: URL-ul notificării include ID-ul programării + fereastra de timp,
 * deci un al doilea apel în aceeași fereastră nu retrimite.
 */
async function processUpcomingAppointments(since: Date, now: Date): Promise<number> {
  // [leadMinutes, toleranțăMs] — fereastra în jurul momentului exact
  const leads: { key: string; leadMs: number; toleranceMs: number }[] = [
    { key: "24h", leadMs: 24 * 60 * 60_000, toleranceMs: 15 * 60_000 },
    { key: "1h",  leadMs:      60 * 60_000, toleranceMs: 10 * 60_000 },
  ];

  let count = 0;

  for (const lead of leads) {
    const windowFrom = new Date(now.getTime() + lead.leadMs - lead.toleranceMs);
    const windowTo   = new Date(now.getTime() + lead.leadMs + lead.toleranceMs);

    const appts = await prisma.appointment.findMany({
      where: {
        startAt: { gte: windowFrom, lte: windowTo },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
      },
      select: {
        id: true,
        startAt: true,
        title: true,
        categoryNameSnapshot: true,
        clientNameSnapshot: true,
        userId: true,
      },
    });

    if (appts.length === 0) continue;

    // Dedup: căutăm notificări cu același URL trimise după ultimul checkpoint
    const dedupUrls = appts.map((a) => `/appointments?id=${a.id}&lead=${lead.key}`);
    const existing = await prisma.notification.findMany({
      where: { url: { in: dedupUrls }, createdAt: { gte: since } },
      select: { url: true },
    });
    const alreadySent = new Set(existing.map((n) => n.url));

    for (const appt of appts) {
      const dedupUrl = `/appointments?id=${appt.id}&lead=${lead.key}`;
      if (alreadySent.has(dedupUrl)) continue;

      const service = appt.categoryNameSnapshot ?? appt.title;
      const timeStr = formatTime(appt.startAt, DEFAULT_TZ);
      const timeLabel = lead.key === "24h" ? "mâine" : "în 1 oră";

      await notifyUsers(
        [appt.userId],
        {
          title: `📅 ${appt.clientNameSnapshot} – ${timeLabel}`,
          body: `${service} la ora ${timeStr}`,
          url: dedupUrl,
        },
        { telegram: true },
      );
      count++;
    }
  }

  return count;
}

export async function GET() {
  return run();
}

export async function POST() {
  return run();
}
