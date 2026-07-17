import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { dayBoundsUtc, dateKeyOf, addDaysToKey, todayKey as getTodayKey, weekKeys } from "../date";
import type { Prisma, TaskStatus, TaskType, TaskPriority } from "@prisma/client";

export type TaskRow = {
  id: string;
  seq: number | null;
  type: TaskType;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  progress: number;
  dueAt: Date | null;
  reminderIntervalMinutes: number | null;
  creatorId: string;
  assigneeId: string | null;
  teamId: string | null;
  projectId: string | null;
  clientId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  extraAssigneeIds: string[];
  extraTeamIds: string[];
  assignmentSettingsJson: string | null;
  bypassQuietHours: boolean;
  assigneeName: string | null;
  teamName: string | null;
  projectName: string | null;
  projectLat: number | null;
  projectLng: number | null;
  clientName: string | null;
  creatorName: string;
  createdAt: Date;
};

const TASK_SELECT = {
  id: true,
  seq: true,
  type: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  progress: true,
  dueAt: true,
  reminderIntervalMinutes: true,
  creatorId: true,
  assigneeId: true,
  teamId: true,
  projectId: true,
  clientId: true,
  createdAt: true,
  categoryId: true,
  extraAssigneeIds: true,
  extraTeamIds: true,
  assignmentSettingsJson: true,
  bypassQuietHours: true,
  assignee: { select: { name: true } },
  team: { select: { name: true } },
  // project.client NOT selected — clientName not displayed in list; clientId is denormalized
  project: { select: { name: true, clientId: true, lat: true, lng: true } },
  category: { select: { name: true, color: true } },
  creator: { select: { name: true } },
} as const;

function toRow(t: Prisma.TaskGetPayload<{ select: typeof TASK_SELECT }>): TaskRow {
  return {
    id: t.id,
    seq: t.seq ?? null,
    type: t.type,
    title: t.title,
    description: t.description ?? null,
    status: t.status,
    priority: t.priority,
    progress: t.progress,
    dueAt: t.dueAt,
    reminderIntervalMinutes: t.reminderIntervalMinutes ?? null,
    creatorId: t.creatorId,
    assigneeId: t.assigneeId,
    teamId: t.teamId,
    projectId: t.projectId,
    clientId: t.clientId ?? t.project?.clientId ?? null,
    categoryId: t.categoryId ?? null,
    categoryName: t.category?.name ?? null,
    categoryColor: t.category?.color ?? null,
    extraAssigneeIds: t.extraAssigneeIds ?? [],
    extraTeamIds: t.extraTeamIds ?? [],
    assignmentSettingsJson: t.assignmentSettingsJson ?? null,
    bypassQuietHours: t.bypassQuietHours ?? false,
    assigneeName: t.assignee?.name ?? null,
    teamName: t.team?.name ?? null,
    projectName: t.project?.name ?? null,
    projectLat: t.project?.lat ?? null,
    projectLng: t.project?.lng ?? null,
    clientName: null,
    creatorName: t.creator?.name ?? "Necunoscut",
    createdAt: t.createdAt,
  };
}

export type TaskFilter = {
  scope?: "all" | "mine" | "created";
  status?: TaskStatus;
  statuses?: TaskStatus[];   // filtrare multi-status (de ex. tab "Active")
  type?: TaskType;
  types?: TaskType[];
  priority?: TaskPriority;
  projectId?: string;
  clientId?: string;
  categoryId?: string;
  assigneeId?: string;
  teamId?: string;
  dueBefore?: Date;
  dueRange?: "overdue" | "today" | "tomorrow" | "week" | "month";
  sort?: "default" | "dueAsc" | "dueDesc";
  search?: string;
  userId: string;
  teamIds?: string[];
  page?: number;
  pageSize?: number;
};

const PAGE_SIZE = 20;

function buildWhere(filter: TaskFilter): Prisma.TaskWhereInput {
  const where: Prisma.TaskWhereInput = {};
  // Filtrul explicit pe persoană are prioritate față de scope
  if (filter.assigneeId) {
    where.assigneeId = filter.assigneeId;
  } else if (filter.scope === "mine") {
    where.OR = [
      { assigneeId: filter.userId },
      { extraAssigneeIds: { has: filter.userId } },
      ...(filter.teamIds?.length ? [
        { teamId: { in: filter.teamIds } },
        { extraTeamIds: { hasSome: filter.teamIds } },
      ] : []),
    ];
  } else if (filter.scope === "created") {
    where.creatorId = filter.userId;
  }
  if (filter.teamId) where.teamId = filter.teamId;
  if (filter.statuses?.length) where.status = { in: filter.statuses };
  else if (filter.status) where.status = filter.status;
  if (filter.types?.length) where.type = { in: filter.types };
  else if (filter.type) where.type = filter.type;
  if (filter.priority) where.priority = filter.priority;
  if (filter.projectId) where.projectId = filter.projectId;
  if (filter.clientId) where.clientId = filter.clientId;
  if (filter.categoryId) where.categoryId = filter.categoryId;

  if (filter.dueRange) {
    const TZ = "Europe/Bucharest";
    const now = new Date();
    const tKey = getTodayKey(TZ);
    switch (filter.dueRange) {
      case "overdue": {
        where.dueAt = { lt: now };
        if (!filter.status) where.status = { notIn: ["DONE", "CANCELLED"] };
        break;
      }
      case "today": {
        const { start, end } = dayBoundsUtc(tKey, TZ);
        where.dueAt = { gte: start, lt: end };
        break;
      }
      case "tomorrow": {
        const tmrKey = addDaysToKey(tKey, 1, TZ);
        const { start, end } = dayBoundsUtc(tmrKey, TZ);
        where.dueAt = { gte: start, lt: end };
        break;
      }
      case "week": {
        const keys = weekKeys(tKey, TZ);
        const { start } = dayBoundsUtc(keys[0], TZ);
        const { end } = dayBoundsUtc(keys[keys.length - 1], TZ);
        where.dueAt = { gte: start, lt: end };
        break;
      }
      case "month": {
        const [y, m] = tKey.split("-").map(Number);
        const firstOfMonth = `${y}-${String(m).padStart(2, "0")}-01`;
        const nextMonthKey = dateKeyOf(new Date(Date.UTC(y, m, 1, 12, 0, 0)), TZ);
        const { start } = dayBoundsUtc(firstOfMonth, TZ);
        const { start: end } = dayBoundsUtc(nextMonthKey, TZ);
        where.dueAt = { gte: start, lt: end };
        break;
      }
    }
  } else if (filter.dueBefore) {
    where.dueAt = { lte: filter.dueBefore };
  }

  if (filter.search?.trim()) {
    const term = filter.search.trim();
    const stripped = term.startsWith("#") ? term.slice(1) : term;
    const seqNum = /^\d+$/.test(stripped) ? parseInt(stripped, 10) : NaN;
    if (!isNaN(seqNum)) {
      where.OR = [{ seq: seqNum }, { title: { contains: term, mode: "insensitive" } }];
    } else {
      where.title = { contains: term, mode: "insensitive" };
    }
  }
  return where;
}

export async function listTasks(
  filter: TaskFilter,
): Promise<{ items: TaskRow[]; hasMore: boolean; page: number; total: number; totalPages: number }> {
  if (DEMO) return { items: [], hasMore: false, page: 1, total: 0, totalPages: 0 };

  const page = Math.max(1, filter.page ?? 1);
  const pageSize = filter.pageSize ?? PAGE_SIZE;
  const where = buildWhere(filter);

  const orderBy: Prisma.TaskOrderByWithRelationInput[] =
    filter.sort === "dueAsc"
      ? [{ dueAt: "asc" }, { createdAt: "desc" }]
      : filter.sort === "dueDesc"
        ? [{ dueAt: "desc" }, { createdAt: "desc" }]
        : [{ status: "asc" }, { createdAt: "desc" }];

  const [rows, total] = await Promise.all([
    prisma.task.findMany({
      where,
      select: TASK_SELECT,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.task.count({ where }),
  ]);

  const totalPages = Math.ceil(total / pageSize);
  const hasMore = page < totalPages;
  return { items: rows.map(toRow), hasMore, page, total, totalPages };
}

export type CalendarTask = {
  id: string;
  seq: number | null;
  title: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: Date;
  creatorId: string;
  assigneeId: string | null;
  assigneeName: string | null;
  teamId: string | null;
  projectId: string | null;
  clientId: string | null;
};

/** Task-uri cu scadență într-un interval (pentru calendar). */
export async function tasksDueBetween(opts: {
  scope: "all" | "mine" | "created";
  userId: string;
  teamIds?: string[];
  from: Date;
  to: Date;
  assigneeId?: string;
  teamId?: string;
  projectId?: string;
  clientId?: string;
  categoryId?: string;
  types?: TaskType[];
}): Promise<CalendarTask[]> {
  if (DEMO) return [];
  const where = buildWhere({
    scope: opts.scope,
    userId: opts.userId,
    teamIds: opts.teamIds,
    assigneeId: opts.assigneeId,
    teamId: opts.teamId,
    projectId: opts.projectId,
    clientId: opts.clientId,
    categoryId: opts.categoryId,
  });
  if (opts.types?.length) where.type = { in: opts.types };
  where.dueAt = { gte: opts.from, lte: opts.to };
  const rows = await prisma.task.findMany({
    where,
    select: {
      id: true,
      seq: true,
      title: true,
      type: true,
      status: true,
      priority: true,
      dueAt: true,
      creatorId: true,
      assigneeId: true,
      teamId: true,
      projectId: true,
      assignee: { select: { name: true } },
      project: { select: { clientId: true } },
    },
    orderBy: { dueAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    seq: r.seq ?? null,
    title: r.title,
    type: r.type,
    status: r.status,
    priority: r.priority,
    dueAt: r.dueAt as Date,
    creatorId: r.creatorId,
    assigneeId: r.assigneeId ?? null,
    assigneeName: r.assignee?.name ?? null,
    teamId: r.teamId ?? null,
    projectId: r.projectId ?? null,
    clientId: r.project?.clientId ?? null,
  }));
}

export async function getTask(id: string) {
  if (DEMO) return null;
  return prisma.task.findUnique({
    where: { id },
    select: {
      ...TASK_SELECT,
      // Detail view needs client name via project (not stored in list TASK_SELECT)
      project: { select: { name: true, clientId: true, lat: true, lng: true, address: true, client: { select: { name: true } } } },
      description: true,
      createdFrom: true,
      activities: {
        select: {
          id: true,
          action: true,
          fromStatus: true,
          toStatus: true,
          meta: true,
          note: true,
          createdAt: true,
          user: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      },
      attachments: {
        select: {
          id: true,
          name: true,
          url: true,
          size: true,
          mimeType: true,
          createdAt: true,
          user: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      emailSource: true,
      fromEmail: true,
      fromName: true,
      emailMessages: {
        select: {
          id: true,
          direction: true,
          fromEmail: true,
          fromName: true,
          toEmail: true,
          body: true,
          sentAt: true,
        },
        orderBy: { sentAt: "asc" },
      },
    },
  });
}

/** Statistici pentru dashboard: ale mele pe status + tichete/task-uri deschise + proiecte active. */
export async function dashboardStats(
  userId: string,
  teamIds: string[],
  role: "ADMIN" | "STAFF" = "STAFF",
) {
  if (DEMO) {
    return {
      myOpen: 0, myInProgress: 0, myReview: 0, myDone: 0,
      ticketsOpen: 0, tasksOpen: 0, projectsActive: 0,
    };
  }
  const mineWhere: Prisma.TaskWhereInput = {
    OR: [
      { assigneeId: userId },
      { extraAssigneeIds: { has: userId } },
      ...(teamIds.length ? [
        { teamId: { in: teamIds } },
        { extraTeamIds: { hasSome: teamIds } },
      ] : []),
    ],
  };
  const openStatuses: TaskStatus[] = ["NEW", "ASSIGNED", "READ", "IN_PROGRESS", "ON_HOLD", "REVIEW"];

  // Adminii văd contorizări globale; STAFF-ul vede doar ale lor
  const globalTicketWhere: Prisma.TaskWhereInput =
    role === "ADMIN"
      ? { type: "TICKET", status: { in: openStatuses } }
      : { ...mineWhere, type: "TICKET", status: { in: openStatuses } };
  const globalTaskWhere: Prisma.TaskWhereInput =
    role === "ADMIN"
      ? { type: "TASK", status: { in: openStatuses } }
      : { ...mineWhere, type: "TASK", status: { in: openStatuses } };

  const [grouped, ticketsOpen, tasksOpen, projectsActive] = await Promise.all([
    prisma.task.groupBy({ by: ["status"], where: mineWhere, _count: { _all: true } }),
    prisma.task.count({ where: globalTicketWhere }),
    prisma.task.count({ where: globalTaskWhere }),
    prisma.project.count({ where: { status: "ACTIVE" } }),
  ]);
  const m = Object.fromEntries(grouped.map((g) => [g.status, g._count._all])) as Record<
    TaskStatus,
    number
  >;
  const myOpen = openStatuses.reduce((s, st) => s + (m[st] ?? 0), 0);
  return {
    myOpen,
    myInProgress: m.IN_PROGRESS ?? 0,
    myReview: m.REVIEW ?? 0,
    myDone: m.DONE ?? 0,
    ticketsOpen,
    tasksOpen,
    projectsActive,
  };
}

export type TaskHistoryRow = {
  id: string;
  fromStatus: TaskStatus | null;
  toStatus: TaskStatus | null;
  note: string | null;
  createdAt: Date;
  userName: string;
};

/** Istoricul de status al unui task — doar schimbările de status (pentru inlining în lista de task-uri). */
export async function taskHistory(taskId: string): Promise<TaskHistoryRow[]> {
  if (DEMO) return [];
  const rows = await prisma.taskActivity.findMany({
    where: { taskId },
    select: {
      id: true,
      action: true,
      fromStatus: true,
      toStatus: true,
      note: true,
      createdAt: true,
      user: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  // Returnează doar evenimentele de schimbare de status (backwards-compat: null = STATUS_CHANGED)
  return rows
    .filter((r) => !r.action || r.action === "STATUS_CHANGED")
    .filter((r) => r.toStatus)
    .map((r) => ({
      id: r.id,
      fromStatus: r.fromStatus,
      toStatus: r.toStatus,
      note: r.note,
      createdAt: r.createdAt,
      userName: r.user?.name ?? "—",
    }));
}

/** Activitate recentă (pentru admin: ce task-uri au fost modificate). */
export async function recentActivity(limit = 30) {
  if (DEMO) return [];
  return prisma.taskActivity.findMany({
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      createdAt: true,
      user: { select: { name: true } },
      task: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
