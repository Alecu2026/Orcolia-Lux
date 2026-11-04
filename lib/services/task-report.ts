import "server-only";
import { prisma } from "../prisma";
import { listTasks, taskViewFilter } from "../queries/tasks";
import { ticketOrigins } from "./task-origins";
import { buildRegulatoryReport, type ReportSheet } from "../regulatory-report";
import { addDaysToKey, zonedToUtc } from "../date";
import type { PermissionSubject } from "../permissions";

/** Cel mult atâtea rânduri intră într-un raport (peste, raportul se face pe cele mai noi și se arată avertisment). */
const MAX_ROWS = 50_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[0-9a-f]{24}$/i;
const STATUSES = ["NEW", "ASSIGNED", "READ", "IN_PROGRESS", "ON_HOLD", "REVIEW", "DONE", "CANCELLED"];

/** Filtrele raportului (aceleași ca în listele de Cereri / Sarcini); gol = fără filtru. */
export type TaskReportParams = {
  kind: "tickets" | "tasks";
  /** „AAAA-LL-ZZ” (ora României), pe data creării. */
  from: string;
  to: string;
  sectionId: string;
  teamId: string;
  assigneeId: string;
  status: string;
  /** WATER / SEWER / BOTH / NONE (nespecificat) */
  service: string;
  /** HOUSEHOLD / NON_HOUSEHOLD / NONE (nespecificat) */
  consumer: string;
  /** PORTAL / INTERNAL / EMAIL */
  origin: string;
  /** Raport pe exact aceste rânduri (cele rămase în tabel după filtrele din browser); celelalte filtre nu se mai aplică. */
  ids?: string[];
};

type Viewer = { id: string; teamIds?: string[]; taskViewScope: string; taskViewTeamIds: string[]; taskViewMemberIds: string[] } & PermissionSubject;

export const validDay = (v: string | null | undefined): string => (v && DAY_RE.test(v) ? v : "");

/** Parametrii din adresă → filtre valide (orice valoare necunoscută se ignoră). */
export function parseReportParams(sp: { get(k: string): string | null }, allowed: { tickets: boolean; tasks: boolean }): TaskReportParams {
  const g = (k: string) => (sp.get(k) ?? "").trim();
  const asked = g("kind") === "tasks" ? "tasks" : "tickets";
  const kind = allowed[asked] ? asked : allowed.tickets ? "tickets" : "tasks";
  const pick = (k: string, ok: string[]) => (ok.includes(g(k)) ? g(k) : "");
  return {
    kind,
    from: validDay(g("from")),
    to: validDay(g("to")),
    sectionId: ID_RE.test(g("sec")) ? g("sec") : "",
    teamId: ID_RE.test(g("team")) ? g("team") : "",
    assigneeId: ID_RE.test(g("who")) ? g("who") : "",
    status: pick("status", STATUSES),
    service: pick("svc", ["WATER", "SEWER", "BOTH", "NONE"]),
    consumer: pick("cons", ["HOUSEHOLD", "NON_HOUSEHOLD", "NONE"]),
    origin: pick("orig", ["PORTAL", "INTERNAL", "EMAIL"]),
  };
}

/** Parametrii activi, ca să-i trecem mai departe în adresele de PDF / Excel. */
export function reportQuery(p: TaskReportParams): URLSearchParams {
  const sp = new URLSearchParams({ kind: p.kind });
  const set = (k: string, v: string) => { if (v) sp.set(k, v); };
  set("from", p.from); set("to", p.to); set("sec", p.sectionId); set("team", p.teamId); set("who", p.assigneeId);
  set("status", p.status); set("svc", p.service); set("cons", p.consumer); set("orig", p.origin);
  return sp;
}

/**
 * Raportul „Petiții și reclamații” (vezi lib/regulatory-report.ts) pentru cererile sau sarcinile care trec de filtre: perioada creării, secție, echipă, responsabil, status,
 * tip serviciu, tip consumator, origine. Respectă vizibilitatea utilizatorului (vede doar ce are voie să vadă). Folosit de pagina Rapoarte și de descărcările PDF / Excel.
 */
export async function buildTaskReport(user: Viewer, p: TaskReportParams): Promise<{ sheet: ReportSheet; count: number; truncated: boolean; sectionName: string | null }> {
  const type = p.kind === "tickets" ? "TICKET" : "TASK";
  const [section, teams, users] = p.sectionId
    ? await Promise.all([
        prisma.section.findUnique({ where: { id: p.sectionId }, select: { name: true } }),
        prisma.team.findMany({ where: { sectionId: p.sectionId }, select: { id: true } }),
        prisma.user.findMany({ where: { sectionId: p.sectionId }, select: { id: true } }),
      ])
    : [null, [], []];

  const { items: all, total } = await listTasks({
    userId: user.id,
    teamIds: user.teamIds,
    ...taskViewFilter(user),
    types: [type],
    scope: "all",
    ...(p.ids ? { ids: p.ids } : {}),
    ...(p.status ? { status: p.status as never } : {}),
    ...(p.from ? { createdFrom: zonedToUtc(p.from, "00:00") } : {}),
    ...(p.to ? { createdTo: zonedToUtc(addDaysToKey(p.to, 1), "00:00") } : {}),
    ...(p.sectionId ? { sectionId: p.sectionId, sectionTeamIds: teams.map((t) => t.id), sectionUserIds: users.map((u) => u.id) } : {}),
    sort: "newest",
    page: 1,
    pageSize: p.ids ? Math.max(1, p.ids.length) : MAX_ROWS,
  });
  const meta = await ticketOrigins(all, type);

  // restul filtrelor se aplică pe rândurile aduse (aceleași reguli ca în filtrele din tabel)
  const items = all.filter((t) => {
    if (p.teamId && t.teamId !== p.teamId && !t.extraTeamIds.includes(p.teamId)) return false;
    if (p.assigneeId && t.assigneeId !== p.assigneeId && !t.extraAssigneeIds.includes(p.assigneeId)) return false;
    if (p.service && (p.service === "NONE" ? ["WATER", "SEWER", "BOTH"].includes(t.serviceType ?? "") : t.serviceType !== p.service)) return false;
    if (p.consumer && (p.consumer === "NONE" ? ["HOUSEHOLD", "NON_HOUSEHOLD"].includes(t.consumerType ?? "") : t.consumerType !== p.consumer)) return false;
    if (p.origin && meta.byId.get(t.id)?.origin !== p.origin) return false;
    return true;
  });
  const sheet = buildRegulatoryReport(items, meta, p.kind);
  return { sheet, count: items.length, truncated: total > all.length, sectionName: section?.name ?? null };
}

/** Rândurile „Filtre aplicate” pentru antetul PDF-ului (doar cele active), în română. */
export function reportFilterLines(p: TaskReportParams, names: { section: string | null; team: string | null; assignee: string | null }): string[] {
  const fmt = (k: string) => k.split("-").reverse().join(".");
  const STATUS_RO: Record<string, string> = { NEW: "Nou", ASSIGNED: "Asignat", READ: "Citit", IN_PROGRESS: "În lucru", ON_HOLD: "În așteptare", REVIEW: "Verificare", DONE: "Finalizat", CANCELLED: "Anulat" };
  const SVC_RO: Record<string, string> = { WATER: "apă", SEWER: "canalizare", BOTH: "apă + canalizare", NONE: "nespecificat" };
  const CONS_RO: Record<string, string> = { HOUSEHOLD: "casnic", NON_HOUSEHOLD: "non casnic", NONE: "nespecificat" };
  const ORIG_RO: Record<string, string> = { PORTAL: "portal clienți", INTERNAL: "create de noi", EMAIL: "email" };
  const out = [p.from || p.to ? `Perioada (data creării): ${p.from ? fmt(p.from) : "început"} – ${p.to ? fmt(p.to) : "prezent"}` : "Perioada: toate"];
  const f: string[] = [];
  if (names.section) f.push(`secția ${names.section}`);
  if (names.team) f.push(`echipa ${names.team}`);
  if (names.assignee) f.push(`responsabil ${names.assignee}`);
  if (p.status) f.push(`status ${STATUS_RO[p.status]}`);
  if (p.service) f.push(`serviciu ${SVC_RO[p.service]}`);
  if (p.consumer) f.push(`consumator ${CONS_RO[p.consumer]}`);
  if (p.origin) f.push(`origine ${ORIG_RO[p.origin]}`);
  if (f.length) out.push(`Filtre: ${f.join(" · ")}`);
  return out;
}
