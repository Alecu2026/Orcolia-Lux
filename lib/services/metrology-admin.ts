import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { logAudit } from "./audit";
import { getMeterSnap } from "./meter-cache";
import { invalidatePayers } from "./payer-cache";
import { dropMetrologyCache } from "./metrology";
import { invalidatePortalClient } from "../portal-cache";
import { earliestKey, metrologyDate, metrologyDueKey, metrologyKey } from "../metrology";
import { can } from "../permissions";
import type { CurrentUser } from "../dal";

/**
 * Scrierea verificării metrologice a unui contor (data ultimei verificări; scadența = +5 ani) și păstrarea scadenței plătitorului (`Client.metrologyDueAt` = cea mai
 * apropiată dintre contoarele lui ACTIVE) — de acolo vin coloana și filtrul din Plătitori / Notificări plătitori, fără join.
 */

/** Cine poate scrie data verificării metrologice: cine editează plătitori sau administrează contoarele. */
export function canEditMetrology(user: Parameters<typeof can>[0]): boolean {
  return can(user, "payers.edit") || can(user, "meters.manage");
}

/** Recalculează `Client.metrologyDueAt` din înregistrările contoarelor lui (cele scoase din uz nu mai contează). */
export async function recomputeClientMetrology(clientId: string, removedIds?: Set<string>): Promise<void> {
  const rows = await prisma.meterMetrology.findMany({ where: { clientId }, select: { meterId: true, verifiedAt: true } });
  let removed = removedIds;
  if (!removed) {
    const snap = await getMeterSnap();
    removed = new Set(snap.rows.filter((r) => r.clientId === clientId && r.removedAt).map((r) => r.id));
  }
  const due = earliestKey(rows.filter((r) => !removed!.has(r.meterId)).map((r) => { const k = metrologyKey(r.verifiedAt); return k ? metrologyDueKey(k) : null; }));
  await prisma.client.update({ where: { id: clientId }, data: { metrologyDueAt: due ? metrologyDate(due) : null } }).catch(() => {});
}

/** Reia scadențele tuturor plătitorilor care au date introduse (contoarele pot fi scoase la sincronizarea 1C); întoarce câți plătitori s-au schimbat. */
export async function recomputeAllMetrology(): Promise<number> {
  const all = await prisma.meterMetrology.findMany({ select: { clientId: true } });
  const clientIds = [...new Set(all.map((r) => r.clientId).filter((x): x is string => !!x))];
  const stale = await prisma.client.findMany({ where: { metrologyDueAt: { not: null } }, select: { id: true } });
  const ids = [...new Set([...clientIds, ...stale.map((c) => c.id)])];
  if (ids.length === 0) return 0;
  const snap = await getMeterSnap();
  const removed = new Map<string, Set<string>>();
  for (const r of snap.rows) if (r.clientId && r.removedAt) (removed.get(r.clientId) ?? removed.set(r.clientId, new Set()).get(r.clientId)!).add(r.id);
  let changed = 0;
  for (const id of ids) {
    const before = await prisma.client.findUnique({ where: { id }, select: { metrologyDueAt: true } });
    await recomputeClientMetrology(id, removed.get(id) ?? new Set());
    const after = await prisma.client.findUnique({ where: { id }, select: { metrologyDueAt: true } });
    if (metrologyKey(before?.metrologyDueAt) !== metrologyKey(after?.metrologyDueAt)) changed++;
  }
  if (changed) await invalidatePayers();
  return changed;
}

export type SetMetrologyResult = { ok: true; verifiedAt: string | null; dueAt: string | null } | { ok: false; error: string };

/** `dateKey` = „YYYY-MM-DD” (data ultimei verificări) sau null (șterge data). Permisiunea se verifică în acțiunea de server. */
export async function setMeterMetrology(user: CurrentUser, meterId: string, dateKey: string | null): Promise<SetMetrologyResult> {
  if (DEMO) return { ok: false, error: "Mod demo: conectează o bază de date." };
  const snap = await getMeterSnap();
  const row = snap.rows.find((r) => r.id === meterId);
  if (!row) return { ok: false, error: "Contorul nu a fost găsit." };

  const before = await prisma.meterMetrology.findUnique({ where: { meterId }, select: { id: true, verifiedAt: true } });
  const beforeKey = metrologyKey(before?.verifiedAt);
  if (beforeKey === dateKey) return { ok: true, verifiedAt: dateKey, dueAt: dateKey ? metrologyDueKey(dateKey) : null };

  if (dateKey) {
    const data = { contor: row.contor, clientId: row.clientId, verifiedAt: metrologyDate(dateKey), notified: [] as string[], userId: user.id, userName: user.name };
    if (before) await prisma.meterMetrology.update({ where: { id: before.id }, data });
    else await prisma.meterMetrology.create({ data: { meterId, ...data } });
  } else if (before) {
    await prisma.meterMetrology.delete({ where: { id: before.id } });
  }
  dropMetrologyCache();
  if (row.clientId) {
    await recomputeClientMetrology(row.clientId);
    invalidatePortalClient(row.clientId);
  }
  await invalidatePayers();

  await logAudit(
    { id: user.id, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin },
    {
      action: "meter.metrology",
      module: "Meters",
      objectId: meterId,
      objectName: row.contor,
      oldValue: beforeKey,
      newValue: dateKey,
      details: { changes: [{ field: "verifiedAt", label: "Verificare metrologică", old: beforeKey, new: dateKey }] },
    },
  );
  return { ok: true, verifiedAt: dateKey, dueAt: dateKey ? metrologyDueKey(dateKey) : null };
}
