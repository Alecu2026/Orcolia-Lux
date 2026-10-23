import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { dayBoundsUtc, dateKeyOf, addDaysToKey, todayKey as getTodayKey, weekKeys } from "../date";
import type { Prisma, TaskStatus, TaskType, TaskPriority } from "@prisma/client";
import { canAny, type PermissionSubject } from "../permissions";
import { allClientNames, clientNamesFor } from "./client-names";
import { TASK_PRIORITY_LIST, TASK_STATUS_LIST, type TaskNames, type TaskTuple } from "../task-dataset";

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
  /** Clientul a scris în conversația tichetului și operatorii n-au citit încă. */
  chatUnread: boolean;
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
  // Fără selecturi pe relații (assignee/team/project/category/creator): fiecare devine un $in separat pe MongoDB, lent la mii de rânduri.
  // Numele se completează din hărți mici păstrate în memorie (vezi taskLookups).
  fromName: true,
  fromEmail: true,
  chatLastMsgAt: true,
  chatLastSender: true,
  chatStaffReadAt: true,
} as const;

/**
 * „Creat de”: tichetele din portal / email sunt create de client (în DB `creatorId` e un administrator-substitut, clientul nu e utilizator),
 * deci acolo afișăm solicitantul real (`fromName`/`fromEmail`). Task-urile și tichetele create de angajați rămân pe creatorul real.
 */
export function ticketCreatorName(t: { type: string; fromName?: string | null; fromEmail?: string | null; creator?: { name: string } | null }): string {
  if (t.type === "TICKET") {
    const who = (t.fromName || t.fromEmail || "").trim();
    if (who) return who;
  }
  return t.creator?.name ?? "Necunoscut";
}

/**
 * Hărți id → nume pentru utilizatori, echipe, proiecte (și cele arhivate, cu coordonate) și categorii. Sunt mici (sute de rânduri) și se schimbă rar,
 * deci stau în memorie ~20 s; un id necunoscut (de ex. proiect abia creat) forțează o singură reîncărcare, ca numele să nu lipsească.
 */
type Lookups = {
  at: number;
  users: Map<string, string>;
  teams: Map<string, string>;
  projects: Map<string, { name: string; clientId: string | null; lat: number | null; lng: number | null }>;
  categories: Map<string, { name: string; color: string | null }>;
};
const LOOKUP_TTL_MS = 20_000;
const lkg = globalThis as unknown as { __taskLookups?: Lookups; __taskLookupsP?: Promise<Lookups> };

async function loadLookups(): Promise<Lookups> {
  const [users, teams, projects, categories] = await Promise.all([
    prisma.user.findMany({ select: { id: true, name: true } }),
    prisma.team.findMany({ select: { id: true, name: true } }),
    prisma.project.findMany({ select: { id: true, name: true, clientId: true, lat: true, lng: true } }),
    prisma.category.findMany({ select: { id: true, name: true, color: true } }),
  ]);
  return {
    at: Date.now(),
    users: new Map(users.map((u) => [u.id, u.name])),
    teams: new Map(teams.map((t) => [t.id, t.name])),
    projects: new Map(projects.map((p) => [p.id, { name: p.name, clientId: p.clientId ?? null, lat: p.lat ?? null, lng: p.lng ?? null }])),
    categories: new Map(categories.map((c) => [c.id, { name: c.name, color: c.color ?? null }])),
  };
}

/** Un singur calcul în zbor (single-flight); `force` ocolește memoria. */
async function taskLookups(force = false): Promise<Lookups> {
  const cur = lkg.__taskLookups;
  if (!force && cur && Date.now() - cur.at < LOOKUP_TTL_MS) return cur;
  if (!lkg.__taskLookupsP) {
    lkg.__taskLookupsP = loadLookups()
      .then((l) => { lkg.__taskLookups = l; return l; })
      .finally(() => { lkg.__taskLookupsP = undefined; });
  }
  return lkg.__taskLookupsP;
}

type TaskDbRow = Prisma.TaskGetPayload<{ select: typeof TASK_SELECT }>;

function lookupsMissing(rows: TaskDbRow[], l: Lookups): boolean {
  for (const t of rows) {
    if (t.creatorId && !l.users.has(t.creatorId)) return true;
    if (t.assigneeId && !l.users.has(t.assigneeId)) return true;
    if (t.teamId && !l.teams.has(t.teamId)) return true;
    if (t.projectId && !l.projects.has(t.projectId)) return true;
    if (t.categoryId && !l.categories.has(t.categoryId)) return true;
  }
  return false;
}

function toRow(t: TaskDbRow, l: Lookups): TaskRow {
  const project = t.projectId ? l.projects.get(t.projectId) : undefined;
  const category = t.categoryId ? l.categories.get(t.categoryId) : undefined;
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
    clientId: t.clientId ?? project?.clientId ?? null,
    categoryId: t.categoryId ?? null,
    categoryName: category?.name ?? null,
    categoryColor: category?.color ?? null,
    extraAssigneeIds: t.extraAssigneeIds ?? [],
    extraTeamIds: t.extraTeamIds ?? [],
    assignmentSettingsJson: t.assignmentSettingsJson ?? null,
    bypassQuietHours: t.bypassQuietHours ?? false,
    assigneeName: t.assigneeId ? l.users.get(t.assigneeId) ?? null : null,
    teamName: t.teamId ? l.teams.get(t.teamId) ?? null : null,
    projectName: project?.name ?? null,
    projectLat: project?.lat ?? null,
    projectLng: project?.lng ?? null,
    clientName: null,
    creatorName: ticketCreatorName({ type: t.type, fromName: t.fromName, fromEmail: t.fromEmail, creator: l.users.has(t.creatorId) ? { name: l.users.get(t.creatorId)! } : null }),
    createdAt: t.createdAt,
    chatUnread: t.chatLastSender === "CLIENT" && !!t.chatLastMsgAt && (!t.chatStaffReadAt || t.chatStaffReadAt < t.chatLastMsgAt),
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
  /** Un singur task (pentru reîmprospătarea unui rând după editare). */
  id?: string;
  dueRange?: "overdue" | "today" | "tomorrow" | "week" | "month";
  sort?: "default" | "dueAsc" | "dueDesc" | "newest";
  search?: string;
  userId: string;
  teamIds?: string[];
  /** Ce task-uri are voie userul să vadă — vezi lib/permissions.ts (canViewTask) pentru aceeași
   * regulă aplicată la deschiderea individuală a unui task. "ALL" (implicit) = fără restricție. */
  viewScope?: string;
  viewTeamIds?: string[];
  viewMemberIds?: string[];
  /** Fără permisiune de a vedea clienții/plătitorii: numele clientului nu se completează pe rânduri (nu scurgem date din pagini interzise). */
  hideClientNames?: boolean;
  page?: number;
  pageSize?: number;
};

const PAGE_SIZE = 20;

/** Extrage din userul curent cele 3 câmpuri de vizibilitate, gata de dat la listTasks/tasksDueBetween
 * (`listTasks({ ...taskViewFilter(user), ...restul filtrelor })`) — un singur loc de întreținut. */
export function taskViewFilter(user: { taskViewScope: string; taskViewTeamIds: string[]; taskViewMemberIds: string[] } & Partial<PermissionSubject>) {
  return {
    viewScope: user.taskViewScope,
    viewTeamIds: user.taskViewTeamIds,
    viewMemberIds: user.taskViewMemberIds,
    hideClientNames: user.role && user.permissions ? !canAny({ role: user.role, permissions: user.permissions }, ["clients.view", "payers.view"]) : false,
  };
}

/**
 * Compune condițiile într-un singur `where`, prin AND — nu prin atribuiri succesive pe `where.OR`
 * (cum erau scope="mine" și căutarea pe #număr înainte: a doua atribuire o ștergea pe prima dacă
 * amândouă erau active deodată, lăsând "mine" fără efect). Fiecare fragment de mai jos e opțional —
 * `undefined` e omis de Prisma dintr-un AND, deci e sigur să le înșiri necondiționat.
 */
function buildWhere(filter: TaskFilter): Prisma.TaskWhereInput {
  const and: Prisma.TaskWhereInput[] = [];
  const where: Prisma.TaskWhereInput = {};

  // Filtrul explicit pe persoană are prioritate față de scope
  if (filter.assigneeId) {
    where.assigneeId = filter.assigneeId;
  } else if (filter.scope === "mine") {
    and.push({
      OR: [
        { assigneeId: filter.userId },
        { extraAssigneeIds: { has: filter.userId } },
        ...(filter.teamIds?.length ? [
          { teamId: { in: filter.teamIds } },
          { extraTeamIds: { hasSome: filter.teamIds } },
        ] : []),
      ],
    });
  } else if (filter.scope === "created") {
    where.creatorId = filter.userId;
  }

  // Vizibilitate (cine are voie să VADĂ task-ul, diferit de scope-ul de mai sus, care doar
  // comută tab-ul "Toate/Ale mele/Create de mine" — asta e un plafon aplicat peste orice tab).
  if (filter.viewScope === "RESTRICTED") {
    const teamIds = filter.viewTeamIds ?? [];
    const memberIds = filter.viewMemberIds ?? [];
    and.push({
      OR: [
        { creatorId: filter.userId },
        { assigneeId: filter.userId },
        { extraAssigneeIds: { has: filter.userId } },
        ...(teamIds.length ? [{ teamId: { in: teamIds } }, { extraTeamIds: { hasSome: teamIds } }] : []),
        ...(memberIds.length
          ? [
              { assigneeId: { in: memberIds } },
              { extraAssigneeIds: { hasSome: memberIds } },
              { creatorId: { in: memberIds } },
            ]
          : []),
      ],
    });
  }

  if (filter.id) where.id = filter.id;
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
        // `not: null` — pe MongoDB `lt` singur potrivește și task-urile fără termen.
        where.dueAt = { lt: now, not: null };
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
      and.push({ OR: [{ seq: seqNum }, { title: { contains: term, mode: "insensitive" } }] });
    } else {
      where.title = { contains: term, mode: "insensitive" };
    }
  }

  if (and.length) where.AND = and;
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
        : filter.sort === "newest"
          ? [{ createdAt: "desc" }]
          : [{ status: "asc" }, { createdAt: "desc" }];

  const skip = (page - 1) * pageSize;
  let rows: Awaited<ReturnType<typeof prisma.task.findMany<{ where: Prisma.TaskWhereInput; select: typeof TASK_SELECT }>>>;
  let total: number;
  if (filter.sort === "dueAsc") {
    // MongoDB pune valorile lipsă primele la sortarea crescătoare: task-urile fără termen ar acoperi lista. Vrem întâi cele cu termen
    // (cele mai apropiate primele), apoi cele fără — fără a încărca tot: două felii din aceeași ordine, calculate din numărătoare.
    const [dated, all] = await Promise.all([
      prisma.task.count({ where: { AND: [where, { dueAt: { not: null } }] } }),
      prisma.task.count({ where }),
    ]);
    total = all;
    const undated = all - dated; // în ordinea „crescător” ele vin primele: pozițiile 0..undated-1; cele cu termen: undated..all-1
    const parts: typeof rows = [];
    if (skip < dated) {
      const take = Math.min(pageSize, dated - skip);
      parts.push(...(await prisma.task.findMany({ where, select: TASK_SELECT, orderBy, skip: undated + skip, take })));
    }
    const room = pageSize - parts.length;
    if (room > 0 && undated > 0) {
      const uSkip = Math.max(0, skip - dated);
      if (uSkip < undated) parts.push(...(await prisma.task.findMany({ where, select: TASK_SELECT, orderBy, skip: uSkip, take: Math.min(room, undated - uSkip) })));
    }
    rows = parts;
  } else {
    [rows, total] = await Promise.all([
      prisma.task.findMany({ where, select: TASK_SELECT, orderBy, skip, take: pageSize }),
      prisma.task.count({ where }),
    ]);
  }

  const totalPages = Math.ceil(total / pageSize);
  const hasMore = page < totalPages;
  let lk = await taskLookups();
  if (lookupsMissing(rows, lk)) lk = await taskLookups(true);
  const items = rows.map((r) => toRow(r, lk));
  return { items: filter.hideClientNames ? items : await withClientNames(items), hasMore, page, total, totalPages };
}

/**
 * Completează numele clientului pe rânduri. Lista nu îl citea (clientName rămânea null), deci coloana „Client" arăta „—" imediat ce
 * rândurile se reîncărcau de pe server, deși clientul era salvat. Se citesc doar clienții distincți din rândurile curente (puțini), nu toți.
 */
async function withClientNames(items: TaskRow[]): Promise<TaskRow[]> {
  const ids = [...new Set(items.map((r) => r.clientId).filter((x): x is string => !!x))];
  if (ids.length === 0) return items;
  const names = await clientNamesFor(ids);
  return items.map((r) => (r.clientId ? { ...r, clientName: names.get(r.clientId) ?? null } : r));
}

/** Peste atâtea task-uri într-o listă, pagina nu mai primește totul în HTML: vin doar primele rânduri, iar restul ca set compact (vezi lib/task-dataset.ts). */
const rawMin = process.env.TASK_SNAPSHOT_MIN?.trim();
export const TASK_DATASET_MIN = Math.min(9999, Math.max(0, rawMin && Number.isFinite(Number(rawMin)) ? Number(rawMin) : 1500));
/** Câte rânduri (cele mai noi) intră direct în HTML când lista e mare. */
export const TASK_HEAD_ROWS = 100;
/** Limita de siguranță a setului complet. */
const TASK_DATASET_CAP = 100_000;

/**
 * Datele paginii /tasks și /tickets. Lista mică (≤ TASK_DATASET_MIN): toate rândurile, ca până acum. Lista mare: doar cele mai noi
 * `TASK_HEAD_ROWS` rânduri + totalul; restul îl aduce browserul din /api/tasks/dataset (gzip, ETag, IndexedDB).
 * `openId` (deschis din link, ex. ?open=…) intră mereu în rânduri, chiar dacă e mai vechi.
 */
export async function listTasksForPage(
  filter: Omit<TaskFilter, "page" | "pageSize" | "sort">,
  openId?: string,
): Promise<{ items: TaskRow[]; total: number; dataset: boolean }> {
  const head = await listTasks({ ...filter, sort: "newest", page: 1, pageSize: TASK_HEAD_ROWS });
  let items = head.items;
  const dataset = head.total > TASK_DATASET_MIN;
  if (!dataset && head.total > items.length) {
    items = (await listTasks({ ...filter, sort: "newest", page: 1, pageSize: 9999 })).items;
  }
  if (dataset && openId && /^[0-9a-f]{24}$/i.test(openId) && !items.some((t) => t.id === openId)) {
    const one = await listTasks({ ...filter, id: openId, page: 1, pageSize: 1 });
    items = [...items, ...one.items];
  }
  return { items, total: head.total, dataset };
}

/** „Amprenta" colecției pentru o listă: numărul de rânduri + ultima modificare. Se schimbă la orice creare / modificare / ștergere. */
export type TaskStamp = { count: number; max: number };
export async function taskListStamp(filter: TaskFilter): Promise<TaskStamp> {
  const agg = await prisma.task.aggregate({ where: buildWhere(filter), _count: { _all: true }, _max: { updatedAt: true } });
  return { count: agg._count._all, max: agg._max.updatedAt ? agg._max.updatedAt.getTime() : 0 };
}

/** Un rând din baza de date → tuplul compact (fără nume: ele vin separat, vezi `encodeTaskNames`). */
function toTuple(t: TaskDbRow): TaskTuple {
  return [
    t.id,
    t.seq ?? null,
    t.type,
    t.title,
    t.description ?? null,
    Math.max(0, TASK_STATUS_LIST.indexOf(t.status)),
    Math.max(0, TASK_PRIORITY_LIST.indexOf(t.priority)),
    t.progress,
    t.dueAt ? t.dueAt.getTime() : null,
    t.reminderIntervalMinutes ?? null,
    t.creatorId,
    t.assigneeId ?? null,
    t.teamId ?? null,
    t.projectId ?? null,
    t.clientId ?? null,
    t.categoryId ?? null,
    t.extraAssigneeIds ?? [],
    t.extraTeamIds ?? [],
    t.assignmentSettingsJson ?? null,
    t.bypassQuietHours ? 1 : 0,
    t.createdAt.getTime(),
    t.chatLastSender === "CLIENT" && !!t.chatLastMsgAt && (!t.chatStaffReadAt || t.chatStaffReadAt < t.chatLastMsgAt) ? 1 : 0,
    t.type === "TICKET" ? (t.fromName || t.fromEmail || "").trim() : "",
  ];
}

/** Toate rândurile listei, ca tupluri (cele mai noi primele). */
export async function loadTaskTuples(filter: TaskFilter): Promise<TaskTuple[]> {
  const rows = await prisma.task.findMany({ where: buildWhere(filter), select: TASK_SELECT, orderBy: [{ createdAt: "desc" }], take: TASK_DATASET_CAP });
  return rows.map(toTuple);
}

/**
 * Doar rândurile modificate / create de la `sinceMs` încoace (inclusiv). `null` = sunt prea multe ca să merite (se reconstruiește tot).
 * Un fragment mic în loc de toată lista: ~zeci de ms în loc de câteva secunde la zeci de mii de rânduri.
 */
export async function loadChangedTaskTuples(filter: TaskFilter, sinceMs: number, limit: number): Promise<TaskTuple[] | null> {
  const where: Prisma.TaskWhereInput = { AND: [buildWhere(filter), { updatedAt: { gte: new Date(sinceMs) } }] };
  const rows = await prisma.task.findMany({ where, select: TASK_SELECT, take: limit + 1 });
  if (rows.length > limit) return null;
  return rows.map(toTuple);
}

/** Dicționarul de nume pentru id-urile folosite de tupluri (utilizatori, echipe, proiecte, categorii, clienți). Mic: câteva sute de intrări. */
export async function encodeTaskNames(tuples: TaskTuple[], hideClientNames: boolean): Promise<TaskNames> {
  let lk = await taskLookups();
  const missing = (): boolean => {
    for (const r of tuples) {
      if (r[10] && !lk.users.has(r[10])) return true;
      if (r[11] && !lk.users.has(r[11])) return true;
      if (r[12] && !lk.teams.has(r[12])) return true;
      if (r[13] && !lk.projects.has(r[13])) return true;
      if (r[15] && !lk.categories.has(r[15])) return true;
    }
    return false;
  };
  if (missing()) lk = await taskLookups(true);

  const names: TaskNames = { u: {}, t: {}, p: {}, c: {}, k: {} };
  const clientIds = new Set<string>();
  for (const r of tuples) {
    if (!(r[10] in names.u)) { const n = lk.users.get(r[10]); if (n != null) names.u[r[10]] = n; }
    if (r[11] && !(r[11] in names.u)) { const n = lk.users.get(r[11]); if (n != null) names.u[r[11]] = n; }
    if (r[12] && !(r[12] in names.t)) { const n = lk.teams.get(r[12]); if (n != null) names.t[r[12]] = n; }
    if (r[13] && !(r[13] in names.p)) {
      const p = lk.projects.get(r[13]);
      if (p) names.p[r[13]] = [p.name, p.clientId, p.lat, p.lng];
    }
    if (r[15] && !(r[15] in names.c)) {
      const c = lk.categories.get(r[15]);
      if (c) names.c[r[15]] = [c.name, c.color];
    }
    const cid = r[14] ?? (r[13] ? lk.projects.get(r[13])?.clientId : null) ?? null;
    if (cid) clientIds.add(cid);
  }
  if (!hideClientNames && clientIds.size > 0) {
    const all = await allClientNames();
    for (const id of clientIds) { const n = all.get(id); if (n != null) names.k[id] = n; }
  }
  return names;
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
  viewScope?: string;
  viewTeamIds?: string[];
  viewMemberIds?: string[];
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
    viewScope: opts.viewScope,
    viewTeamIds: opts.viewTeamIds,
    viewMemberIds: opts.viewMemberIds,
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
      // Detaliul unui singur task păstrează relațiile (un singur rând, nu costă); lista folosește hărți (vezi taskLookups)
      assignee: { select: { name: true } },
      team: { select: { name: true } },
      category: { select: { name: true, color: true } },
      creator: { select: { name: true } },
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
  taskView?: { scope: string; teamIds: string[]; memberIds: string[] },
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

  // Adminii văd contorizări globale — dar NU dacă li s-a restrâns vizibilitatea (taskViewScope
  // "RESTRICTED"): atunci numărătoarea "globală" se plafonează la fel ca lista de task-uri (echipele/
  // persoanele alese la crearea contului, plus mereu task-urile proprii). STAFF vede doar ale lui.
  const vTeamIds = taskView?.teamIds ?? [];
  const vMemberIds = taskView?.memberIds ?? [];
  const restrictedWhere: Prisma.TaskWhereInput = {
    OR: [
      { creatorId: userId },
      { assigneeId: userId },
      { extraAssigneeIds: { has: userId } },
      ...(vTeamIds.length ? [{ teamId: { in: vTeamIds } }, { extraTeamIds: { hasSome: vTeamIds } }] : []),
      ...(vMemberIds.length
        ? [{ assigneeId: { in: vMemberIds } }, { extraAssigneeIds: { hasSome: vMemberIds } }, { creatorId: { in: vMemberIds } }]
        : []),
    ],
  };
  const canSeeAll = role === "ADMIN" && taskView?.scope !== "RESTRICTED";
  const globalBaseWhere = canSeeAll ? {} : role === "ADMIN" ? restrictedWhere : mineWhere;
  const globalTicketWhere: Prisma.TaskWhereInput = { ...globalBaseWhere, type: "TICKET", status: { in: openStatuses } };
  const globalTaskWhere: Prisma.TaskWhereInput = { ...globalBaseWhere, type: "TASK", status: { in: openStatuses } };

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
