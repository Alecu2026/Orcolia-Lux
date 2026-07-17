import { getCurrentUser } from "@/lib/dal";
import { listTasks } from "@/lib/queries/tasks";
import { listClients } from "@/lib/queries/clients";
import { prisma } from "@/lib/prisma";
import { toCSV, toXLSX, csvResponse, xlsxResponse } from "@/lib/export-utils";
import { formatDate, formatTime, DEFAULT_TZ } from "@/lib/date";
import type { TaskStatus, TaskType, TaskPriority, ProjectStatus, AppointmentStatus } from "@prisma/client";

const TZ = DEFAULT_TZ;

const STATUS_RO: Record<string, string> = {
  NEW: "Nou", ASSIGNED: "Asignat", READ: "Citit", IN_PROGRESS: "În lucru",
  ON_HOLD: "În așteptare", REVIEW: "Review", DONE: "Finalizat", CANCELLED: "Anulat",
  CONFIRMED: "Confirmat", NO_SHOW: "Absent",
  ACTIVE: "Activ", ARCHIVED: "Arhivat",
};
const PRIO_RO: Record<string, string> = { LOW: "Scăzută", MEDIUM: "Medie", HIGH: "Ridicată", URGENT: "Urgentă" };
const TYPE_RO: Record<string, string> = { TASK: "Task", TICKET: "Tichet" };

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "";
  return formatDate(d, TZ);
}

function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return "";
  return `${formatDate(d, TZ)} ${formatTime(d, TZ)}`;
}

function today(): string {
  return fmtDate(new Date()).replace(/\./g, "-");
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Autentificare necesară.", { status: 401 });

  const sp = new URL(req.url).searchParams;
  const entity = sp.get("entity") ?? "";
  const format = (sp.get("format") ?? "csv") as "csv" | "xlsx";
  const isXLSX = format === "xlsx";

  const BOM = "﻿";

  function makeResponse(headers: string[], rows: Record<string, string | number | boolean | null | undefined>[], filename: string) {
    if (isXLSX) {
      return xlsxResponse(toXLSX(headers, rows), `${filename}-${today()}.xlsx`);
    }
    return csvResponse(BOM + toCSV(headers, rows), `${filename}-${today()}.csv`);
  }

  // ─── TASKS ────────────────────────────────────────────────────────
  if (entity === "tasks" || entity === "tickets") {
    const type: TaskType[] = entity === "tickets" ? ["TICKET"] : ["TASK"];
    const { items } = await listTasks({
      userId: user.id,
      teamIds: user.teamIds,
      scope: (sp.get("scope") as "all" | "mine" | "created") || "all",
      status: (sp.get("status") as TaskStatus) || undefined,
      types: type,
      priority: (sp.get("prio") as TaskPriority) || undefined,
      projectId: sp.get("proj") || undefined,
      clientId: sp.get("client") || undefined,
      categoryId: sp.get("category") || undefined,
      assigneeId: sp.get("assignee") || undefined,
      teamId: sp.get("team") || undefined,
      dueRange: (sp.get("due") as "overdue" | "today" | "tomorrow" | "week" | "month") || undefined,
      search: sp.get("q") || undefined,
      sort: (sp.get("sort") as "default" | "dueAsc" | "dueDesc") || undefined,
      page: 1,
      pageSize: 5000,
    });

    // Batch-resolve client names (clientId is denormalized on task)
    const clientIds = [...new Set(items.map((t) => t.clientId).filter(Boolean) as string[])];
    const clientUsers = clientIds.length
      ? await prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } })
      : [];
    const clientNameMap = new Map(clientUsers.map((c) => [c.id, c.name]));

    const HEADERS = ["#", "Titlu", "Tip", "Status", "Prioritate", "Asignat", "Echipă", "Proiect", "Client", "Categorie", "Scadent", "Progres (%)", "Creat la", "Creat de", "Descriere"];
    const rows = items.map((t) => ({
      "#": t.seq ?? "",
      "Titlu": t.title,
      "Tip": TYPE_RO[t.type] ?? t.type,
      "Status": STATUS_RO[t.status] ?? t.status,
      "Prioritate": PRIO_RO[t.priority] ?? t.priority,
      "Asignat": t.assigneeName ?? "",
      "Echipă": t.teamName ?? "",
      "Proiect": t.projectName ?? "",
      "Client": t.clientId ? (clientNameMap.get(t.clientId) ?? "") : "",
      "Categorie": t.categoryName ?? "",
      "Scadent": fmtDate(t.dueAt),
      "Progres (%)": t.progress,
      "Creat la": fmtDateTime(t.createdAt),
      "Creat de": t.creatorName,
      "Descriere": t.description ?? "",
    }));

    return makeResponse(HEADERS, rows, entity);
  }

  // ─── PROJECTS ─────────────────────────────────────────────────────
  if (entity === "projects") {
    const where: import("@prisma/client").Prisma.ProjectWhereInput = {};
    const statusParam = sp.get("status") as ProjectStatus | null;
    if (statusParam) where.status = statusParam;
    const q = sp.get("q")?.trim();
    if (q) where.OR = [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }];

    const rows = await prisma.project.findMany({
      where,
      select: {
        name: true,
        description: true,
        status: true,
        address: true,
        assigneeId: true,
        _count: { select: { tasks: true } },
        owner: { select: { name: true } },
        client: { select: { name: true } },
        team: { select: { name: true } },
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });

    // Resolve assignee names in one batch query
    const assigneeIds = [...new Set(rows.map((r) => r.assigneeId).filter(Boolean) as string[])];
    const assigneeUsers = assigneeIds.length
      ? await prisma.user.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, name: true } })
      : [];
    const assigneeName = new Map(assigneeUsers.map((u) => [u.id, u.name]));

    const PROJECT_STATUS_RO: Record<string, string> = { ACTIVE: "Activ", ON_HOLD: "În așteptare", DONE: "Finalizat", ARCHIVED: "Arhivat" };
    const HEADERS = ["Nume", "Descriere", "Status", "Proprietar", "Client", "Echipă", "Asignat", "Adresă", "Nr. task-uri", "Creat la"];
    const exportRows = rows.map((p) => ({
      "Nume": p.name,
      "Descriere": p.description ?? "",
      "Status": PROJECT_STATUS_RO[p.status] ?? p.status,
      "Proprietar": p.owner?.name ?? "",
      "Client": p.client?.name ?? "",
      "Echipă": p.team?.name ?? "",
      "Asignat": p.assigneeId ? (assigneeName.get(p.assigneeId) ?? "") : "",
      "Adresă": p.address ?? "",
      "Nr. task-uri": p._count.tasks,
      "Creat la": fmtDate(p.createdAt),
    }));

    return makeResponse(HEADERS, exportRows, "proiecte");
  }

  // ─── CLIENTS ──────────────────────────────────────────────────────
  if (entity === "clients") {
    const { items } = await listClients(user.id, {
      search: sp.get("q") || undefined,
      page: 1,
      pageSize: 10000,
    });

    const HEADERS = ["Nume", "Telefon", "Email", "Note", "Nr. neprezentări", "Ultima programare"];
    const rows = items.map((c) => ({
      "Nume": c.name,
      "Telefon": c.phone ?? "",
      "Email": c.email ?? "",
      "Note": c.notes ?? "",
      "Nr. neprezentări": c.noShowCount,
      "Ultima programare": fmtDate(c.lastAppointmentAt),
    }));

    return makeResponse(HEADERS, rows, "clienti");
  }

  // ─── APPOINTMENTS ─────────────────────────────────────────────────
  if (entity === "appointments") {
    const view = sp.get("view") ?? "lista";
    const q = sp.get("q")?.trim();
    const statusParam = sp.get("status") as AppointmentStatus | null;
    const categoryId = sp.get("category") || undefined;

    const { todayKey, tomorrowKey, weekKeys } = await import("@/lib/date");
    const tz = TZ;
    const tKey = todayKey(tz);

    let dateFilter: import("@prisma/client").Prisma.AppointmentWhereInput;
    if (view === "azi") {
      dateFilter = { dateKey: tKey };
    } else if (view === "maine") {
      dateFilter = { dateKey: tomorrowKey(tz) };
    } else if (view === "saptamana") {
      const keys = weekKeys(tKey, tz);
      dateFilter = { dateKey: { in: keys } };
    } else {
      // lista: export all (up to 2 years) so user gets all data
      const now = new Date();
      const from = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      const to = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
      dateFilter = { startAt: { gte: from, lte: to } };
    }

    const where: import("@prisma/client").Prisma.AppointmentWhereInput = {
      userId: user.id,
      ...dateFilter,
      ...(statusParam ? { status: statusParam } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(q ? { clientNameSnapshot: { contains: q, mode: "insensitive" } } : {}),
    };

    const appts = await prisma.appointment.findMany({
      where,
      select: {
        startAt: true,
        endAt: true,
        title: true,
        status: true,
        clientNameSnapshot: true,
        categoryNameSnapshot: true,
      },
      orderBy: { startAt: "asc" },
      take: 10000,
    });

    const APPT_STATUS_RO: Record<string, string> = {
      NEW: "Nou", CONFIRMED: "Confirmat", IN_PROGRESS: "În lucru",
      DONE: "Finalizat", CANCELLED: "Anulat", NO_SHOW: "Absent",
    };
    const HEADERS = ["Data", "Ora start", "Ora sfârșit", "Client", "Titlu", "Status", "Categorie"];
    const rows = appts.map((a) => ({
      "Data": fmtDate(a.startAt),
      "Ora start": formatTime(a.startAt, TZ),
      "Ora sfârșit": formatTime(a.endAt, TZ),
      "Client": a.clientNameSnapshot,
      "Titlu": a.title,
      "Status": APPT_STATUS_RO[a.status] ?? a.status,
      "Categorie": a.categoryNameSnapshot ?? "",
    }));

    return makeResponse(HEADERS, rows, "programari");
  }

  return new Response("Entitate necunoscută.", { status: 400 });
}
