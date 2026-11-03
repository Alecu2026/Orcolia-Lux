import "server-only";
import type { MeterIssue } from "@prisma/client";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { getMeterSnap } from "./meter-cache";
import { logAudit } from "./audit";
import { invalidatePortalClient } from "../portal-cache";
import { dropIssueMapCache } from "./issue-map";
import type { AuditUser } from "./meter-readings";

/** Cine raportează: un utilizator (cititor) sau un plătitor din portal (`id` lipsește, `source` = „PORTAL”). */
export type IssueActor = { id: string | null; name: string; role?: string; isSuperAdmin?: boolean; source?: "PORTAL" };
import { currentPeriod } from "../meter-readings";
import { ISSUE_LABELS, MAX_ISSUE_NOTE, isIssueKind, isResponsible, sanitizeIssueRules, type IssueDto, type IssueKind, type IssueRegisterRow, type IssueResponsible, type IssueRules } from "../meter-issues";
import { addDaysToKey, DEFAULT_TZ, todayKey } from "../date";
import { cleanContractDate, contractDate, contractKey } from "../contract-expiry";
import { invalidatePayers } from "./payer-cache";

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const actorOf = (u: { id: string; name: string; role?: string; isSuperAdmin?: boolean }) => ({ id: u.id, name: u.name, role: u.role ?? "STAFF", isSuperAdmin: u.isSuperAdmin });

export const toIssueDto = (i: MeterIssue, teams?: Map<string, string>): IssueDto => ({
  id: i.id,
  meterId: i.meterId,
  contor: i.contor,
  kind: (isIssueKind(i.kind) ? i.kind : "OTHER") as IssueKind,
  note: i.note,
  period: i.period,
  reportedAt: i.reportedAt.toISOString(),
  userName: i.userName,
  resolvedAt: i.resolvedAt ? i.resolvedAt.toISOString() : null,
  resolvedName: i.resolvedName,
  resolvedNote: i.resolvedNote,
  responsible: isResponsible(i.responsible) ? i.responsible : null,
  teamId: i.teamId ?? null,
  teamName: i.teamId ? (teams?.get(i.teamId) ?? null) : null,
  dueAt: contractKey(i.dueAt),
});

/** Regulile pe tipuri (cine remediază, în câte zile, ce secție): din Setări, cu valorile implicite pentru ce lipsește. */
export async function getIssueRules(): Promise<IssueRules> {
  if (DEMO) return sanitizeIssueRules(null);
  const row = await prisma.companySettings.findUnique({ where: { singleton: "main" }, select: { meterIssueRules: true } }).catch(() => null);
  return sanitizeIssueRules(row?.meterIssueRules);
}

/** Numele echipelor (secțiilor), după id. */
export async function teamNameMap(): Promise<Map<string, string>> {
  const teams = await prisma.team.findMany({ select: { id: true, name: true } });
  return new Map(teams.map((t) => [t.id, t.name] as const));
}

/**
 * Păstrează pe plătitor (`Client.meterIssuesOpen` / `meterIssueDueAt`) câte nereguli deschise au contoarele lui și cel mai apropiat termen: de acolo vin filtrul și coloana „Nereguli”
 * din Plătitori / Notificări plătitori, fără join. Se cheamă la fiecare raportare, rezolvare sau editare.
 */
export async function recomputeClientIssues(clientId: string | null | undefined, removedAware = true): Promise<void> {
  if (DEMO || !clientId) return;
  const snap = await getMeterSnap();
  const ids = snap.rows.filter((r) => r.clientId === clientId && (!removedAware || !r.removedAt)).map((r) => r.id);
  const open = ids.length ? await prisma.meterIssue.findMany({ where: { meterId: { in: ids }, resolvedAt: null }, select: { dueAt: true } }) : [];
  const due = open.map((o) => o.dueAt).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  const cur = await prisma.client.findUnique({ where: { id: clientId }, select: { meterIssuesOpen: true, meterIssueDueAt: true } });
  if (!cur) return;
  if ((cur.meterIssuesOpen ?? 0) === open.length && contractKey(cur.meterIssueDueAt) === contractKey(due)) return;
  await prisma.client.update({ where: { id: clientId }, data: { meterIssuesOpen: open.length, meterIssueDueAt: due } }).catch(() => {});
  await invalidatePayers();
}

/** Reia contorul de nereguli al tuturor plătitorilor cu nereguli deschise sau cu un contor rămas setat (după sincronizarea 1C, rezolvări directe în DB). */
export async function recomputeAllClientIssues(): Promise<number> {
  if (DEMO) return 0;
  const snap = await getMeterSnap();
  const byMeter = new Map(snap.rows.map((r) => [r.id, r.clientId] as const));
  const open = await prisma.meterIssue.findMany({ where: { resolvedAt: null }, select: { meterId: true } });
  const stale = await prisma.client.findMany({ where: { meterIssuesOpen: { gt: 0 } }, select: { id: true } });
  const ids = new Set<string>(stale.map((c) => c.id));
  for (const o of open) { const c = byMeter.get(o.meterId); if (c) ids.add(c); }
  for (const id of ids) await recomputeClientIssues(id);
  return ids.size;
}

/** Neregulile deschise ale unor plătitori (pentru {neregula} / {termen_remediere} din șabloanele de notificare). */
export async function openIssuesByClient(clientIds: string[]): Promise<Map<string, { contor: string; kind: IssueKind; dueAt: string | null }[]>> {
  const out = new Map<string, { contor: string; kind: IssueKind; dueAt: string | null }[]>();
  if (DEMO || clientIds.length === 0) return out;
  const want = new Set(clientIds);
  const snap = await getMeterSnap();
  const owner = new Map<string, string>();
  for (const r of snap.rows) if (r.clientId && want.has(r.clientId) && !r.removedAt) owner.set(r.id, r.clientId);
  if (owner.size === 0) return out;
  const rows = await prisma.meterIssue.findMany({ where: { meterId: { in: [...owner.keys()] }, resolvedAt: null }, orderBy: { reportedAt: "asc" }, select: { meterId: true, contor: true, kind: true, dueAt: true } });
  for (const r of rows) {
    const c = owner.get(r.meterId);
    if (!c) continue;
    (out.get(c) ?? out.set(c, []).get(c)!).push({ contor: r.contor, kind: isIssueKind(r.kind) ? r.kind : "OTHER", dueAt: contractKey(r.dueAt) });
  }
  return out;
}

export type ReportIssueInput = { meterId: string; kind: string; note?: string | null; readingId?: string | null; reportedAt?: Date | null };

/**
 * Raportează o neregulă a contorului (de cititor, în teren). Dacă pentru același contor există deja o neregulă DESCHISĂ de același fel, nu se mai creează
 * alta (aceeași constatare retrimisă din coada offline sau găsită din nou luna viitoare): se returnează cea existentă.
 */
export async function reportIssue(user: AuditUser | IssueActor, input: ReportIssueInput): Promise<{ ok: true; issue: IssueDto; existing: boolean } | { ok: false; error: string }> {
  if (DEMO) return { ok: false, error: "Mod demo." };
  if (!isIssueKind(input.kind)) return { ok: false, error: "Tip de neregulă invalid." };
  const note = (input.note ?? "").trim().slice(0, MAX_ISSUE_NOTE) || null;
  if (input.kind === "OTHER" && !note) return { ok: false, error: "Descrie problema." };
  const snap = await getMeterSnap();
  const row = snap.rows.find((r) => r.id === input.meterId);
  if (!row) return { ok: false, error: "Contorul nu există în lista curentă." };
  const at = input.reportedAt ?? new Date();
  if (at.getTime() > Date.now() + 10 * 60_000) return { ok: false, error: "Ora constatării e în viitor — verifică ceasul telefonului." };

  const open = await prisma.meterIssue.findFirst({ where: { meterId: input.meterId, kind: input.kind, resolvedAt: null }, orderBy: { reportedAt: "desc" } });
  if (open) return { ok: true, issue: toIssueDto(open), existing: true };

  const readingId = input.readingId && OBJECT_ID.test(input.readingId) ? input.readingId : null;
  const rule = (await getIssueRules())[input.kind as IssueKind];
  const issue = await prisma.meterIssue.create({
    // câmpurile de rezolvare se scriu explicit ca null: în MongoDB un câmp lipsă nu se potrivește cu filtrul „resolvedAt: null” (neregula deschisă)
    data: { meterId: input.meterId, contor: row.contor, kind: input.kind, note, period: currentPeriod(at), readingId, reportedAt: at, userId: user.id ?? null, userName: user.name, source: ("source" in user && user.source) || null, resolvedAt: null, resolvedById: null, resolvedName: null, resolvedNote: null,
      // regula tipului: cine remediază, ce secție răspunde și până când (de la data raportării); biroul le poate corecta
      responsible: rule.responsible || null, teamId: rule.teamId || null, dueAt: contractDate(addDaysToKey(todayKey(DEFAULT_TZ), rule.days)), dueNotified: [] },
  });
  if (user.id) await logAudit(actorOf({ ...user, id: user.id }), {
    action: "meter.issue",
    module: "Meters",
    objectId: input.meterId,
    objectName: row.contor,
    newValue: ISSUE_LABELS[input.kind as IssueKind],
    details: { extra: [{ label: "Neregulă", value: ISSUE_LABELS[input.kind as IssueKind] }, ...(note ? [{ label: "Observații", value: note }] : [])] },
  });
  dropIssueMapCache();
  invalidatePortalClient(row.clientId);
  await recomputeClientIssues(row.clientId);
  return { ok: true, issue: toIssueDto(issue, await teamNameMap()), existing: false };
}

export async function resolveIssue(user: AuditUser, id: string, note: string | null): Promise<{ ok: boolean; error?: string }> {
  if (DEMO) return { ok: false, error: "Mod demo." };
  if (!OBJECT_ID.test(id)) return { ok: false, error: "Neregulă invalidă." };
  const row = await prisma.meterIssue.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "Neregula nu mai există." };
  if (row.resolvedAt) return { ok: true };
  const resolvedNote = (note ?? "").trim().slice(0, MAX_ISSUE_NOTE) || null;
  await prisma.meterIssue.update({ where: { id }, data: { resolvedAt: new Date(), resolvedById: user.id, resolvedName: user.name, resolvedNote } });
  const ownerId = (await getMeterSnap()).rows.find((r) => r.id === row.meterId)?.clientId;
  dropIssueMapCache();
  invalidatePortalClient(ownerId);
  await recomputeClientIssues(ownerId);
  await logAudit(actorOf(user), {
    action: "meter.issue_resolve",
    module: "Meters",
    objectId: row.meterId,
    objectName: row.contor,
    newValue: "Rezolvată",
    details: { extra: [{ label: "Neregulă", value: ISSUE_LABELS[isIssueKind(row.kind) ? row.kind : "OTHER"] }, ...(resolvedNote ? [{ label: "Rezolvare", value: resolvedNote }] : [])] },
  });
  return { ok: true };
}

/** Neregulile unui contor (cele mai noi primele). */
export async function listMeterIssues(meterId: string, limit = 50): Promise<IssueDto[]> {
  if (DEMO) return [];
  const [rows, teams] = await Promise.all([prisma.meterIssue.findMany({ where: { meterId }, orderBy: { reportedAt: "desc" }, take: limit }), teamNameMap()]);
  return rows.map((r) => toIssueDto(r, teams));
}

/** Lista pentru administrare: deschise (implicit) sau toate, cele mai noi primele. */
export async function listIssues(opts: { open: boolean; limit?: number }): Promise<IssueDto[]> {
  if (DEMO) return [];
  const [rows, teams] = await Promise.all([prisma.meterIssue.findMany({ where: opts.open ? { resolvedAt: null } : {}, orderBy: { reportedAt: "desc" }, take: Math.min(opts.limit ?? 500, 1000) }), teamNameMap()]);
  return rows.map((r) => toIssueDto(r, teams));
}

/** Registrul de nereguli: neregulile (deschise și rezolvate, cele mai noi primele) cu datele contorului și ale abonatului din lista de contoare. */
export async function listIssueRegister(limit = 2000): Promise<IssueRegisterRow[]> {
  if (DEMO) return [];
  const [rows, teams, snap] = await Promise.all([prisma.meterIssue.findMany({ orderBy: { reportedAt: "desc" }, take: limit }), teamNameMap(), getMeterSnap()]);
  const by = new Map(snap.rows.map((r) => [r.id, r] as const));
  return rows.map((r) => withMeter(toIssueDto(r, teams), by.get(r.meterId)));
}

type MeterBits = { name: string; account: string | null; contract: string | null; address: string | null; phone: string | null; clientId: string | null } | undefined;
const withMeter = (d: IssueDto, m: MeterBits): IssueRegisterRow => ({ ...d, name: m?.name ?? "—", account: m?.account ?? null, contract: m?.contract ?? null, address: m?.address ?? null, phone: m?.phone ?? null, clientId: m?.clientId ?? null });

/** Neregulile contoarelor unui plătitor (pentru fișa lui), cele deschise primele. */
export async function listClientIssues(clientId: string): Promise<IssueRegisterRow[]> {
  if (DEMO) return [];
  const snap = await getMeterSnap();
  const mine = snap.rows.filter((r) => r.clientId === clientId);
  if (mine.length === 0) return [];
  const [rows, teams] = await Promise.all([prisma.meterIssue.findMany({ where: { meterId: { in: mine.map((r) => r.id) } }, orderBy: { reportedAt: "desc" }, take: 100 }), teamNameMap()]);
  const by = new Map(mine.map((r) => [r.id, r] as const));
  return rows.map((r) => withMeter(toIssueDto(r, teams), by.get(r.meterId))).sort((a, b) => Number(!!a.resolvedAt) - Number(!!b.resolvedAt));
}

export type IssuePatch = { responsible: IssueResponsible | null; teamId: string | null; dueAt: string | null };

/** Biroul corectează cine remediază, secția și termenul unei nereguli; un termen nou resetează notificările. */
export async function updateIssue(user: AuditUser, id: string, patch: IssuePatch): Promise<{ ok: true; issue: IssueDto } | { ok: false; error: string }> {
  if (DEMO) return { ok: false, error: "Mod demo." };
  if (!OBJECT_ID.test(id)) return { ok: false, error: "Neregulă invalidă." };
  if (patch.responsible != null && !isResponsible(patch.responsible)) return { ok: false, error: "Responsabil invalid." };
  const raw = (patch.dueAt ?? "").trim();
  const dueKey = raw ? cleanContractDate(raw) : null;
  if (raw && !dueKey) return { ok: false, error: "Termenul de remediere e invalid (ZZ.LL.AAAA)." };
  const teams = await teamNameMap();
  if (patch.teamId && !teams.has(patch.teamId)) return { ok: false, error: "Secția nu există." };
  const row = await prisma.meterIssue.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "Neregula nu mai există." };

  const oldDue = contractKey(row.dueAt);
  const data = { responsible: patch.responsible, teamId: patch.teamId || null, dueAt: dueKey ? contractDate(dueKey) : null, ...(dueKey !== oldDue ? { dueNotified: [] as string[] } : {}) };
  const updated = await prisma.meterIssue.update({ where: { id }, data });
  await recomputeClientIssues((await getMeterSnap()).rows.find((r) => r.id === row.meterId)?.clientId);
  const label = (r: string | null) => (r === "CLIENT" ? "Clientul" : r === "COMPANY" ? "Compania" : null);
  const fmt = (k: string | null) => (k ? k.split("-").reverse().join(".") : null);
  await logAudit(actorOf(user), {
    action: "meter.issue_update",
    module: "Meters",
    objectId: row.meterId,
    objectName: row.contor,
    details: {
      changes: [
        { field: "responsible", label: "Responsabil", old: label(row.responsible), new: label(patch.responsible) },
        { field: "teamId", label: "Secția", old: row.teamId ? (teams.get(row.teamId) ?? row.teamId) : null, new: patch.teamId ? (teams.get(patch.teamId) ?? null) : null },
        { field: "dueAt", label: "Termen de remediere", old: fmt(oldDue), new: fmt(dueKey) },
      ].filter((c) => c.old !== c.new),
      extra: [{ label: "Neregulă", value: ISSUE_LABELS[isIssueKind(row.kind) ? row.kind : "OTHER"] }],
    },
  });
  return { ok: true, issue: toIssueDto(updated, teams) };
}
