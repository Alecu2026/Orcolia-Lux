import "server-only";
import type { MeterIssue } from "@prisma/client";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { getMeterSnap } from "./meter-cache";
import { logAudit } from "./audit";
import { invalidatePortalClient } from "../portal-cache";
import type { AuditUser } from "./meter-readings";

/** Cine raportează: un utilizator (cititor) sau un plătitor din portal (`id` lipsește, `source` = „PORTAL”). */
export type IssueActor = { id: string | null; name: string; role?: string; isSuperAdmin?: boolean; source?: "PORTAL" };
import { currentPeriod } from "../meter-readings";
import { ISSUE_LABELS, MAX_ISSUE_NOTE, isIssueKind, type IssueDto, type IssueKind } from "../meter-issues";

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const actorOf = (u: { id: string; name: string; role?: string; isSuperAdmin?: boolean }) => ({ id: u.id, name: u.name, role: u.role ?? "STAFF", isSuperAdmin: u.isSuperAdmin });

export const toIssueDto = (i: MeterIssue): IssueDto => ({
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
});

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
  const issue = await prisma.meterIssue.create({
    // câmpurile de rezolvare se scriu explicit ca null: în MongoDB un câmp lipsă nu se potrivește cu filtrul „resolvedAt: null” (neregula deschisă)
    data: { meterId: input.meterId, contor: row.contor, kind: input.kind, note, period: currentPeriod(at), readingId, reportedAt: at, userId: user.id ?? null, userName: user.name, source: ("source" in user && user.source) || null, resolvedAt: null, resolvedById: null, resolvedName: null, resolvedNote: null },
  });
  if (user.id) await logAudit(actorOf({ ...user, id: user.id }), {
    action: "meter.issue",
    module: "Meters",
    objectId: input.meterId,
    objectName: row.contor,
    newValue: ISSUE_LABELS[input.kind as IssueKind],
    details: { extra: [{ label: "Neregulă", value: ISSUE_LABELS[input.kind as IssueKind] }, ...(note ? [{ label: "Observații", value: note }] : [])] },
  });
  invalidatePortalClient(row.clientId);
  return { ok: true, issue: toIssueDto(issue), existing: false };
}

export async function resolveIssue(user: AuditUser, id: string, note: string | null): Promise<{ ok: boolean; error?: string }> {
  if (DEMO) return { ok: false, error: "Mod demo." };
  if (!OBJECT_ID.test(id)) return { ok: false, error: "Neregulă invalidă." };
  const row = await prisma.meterIssue.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "Neregula nu mai există." };
  if (row.resolvedAt) return { ok: true };
  const resolvedNote = (note ?? "").trim().slice(0, MAX_ISSUE_NOTE) || null;
  await prisma.meterIssue.update({ where: { id }, data: { resolvedAt: new Date(), resolvedById: user.id, resolvedName: user.name, resolvedNote } });
  invalidatePortalClient((await getMeterSnap()).rows.find((r) => r.id === row.meterId)?.clientId);
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
  const rows = await prisma.meterIssue.findMany({ where: { meterId }, orderBy: { reportedAt: "desc" }, take: limit });
  return rows.map(toIssueDto);
}

/** Lista pentru administrare: deschise (implicit) sau toate, cele mai noi primele. */
export async function listIssues(opts: { open: boolean; limit?: number }): Promise<IssueDto[]> {
  if (DEMO) return [];
  const rows = await prisma.meterIssue.findMany({ where: opts.open ? { resolvedAt: null } : {}, orderBy: { reportedAt: "desc" }, take: Math.min(opts.limit ?? 500, 1000) });
  return rows.map(toIssueDto);
}
