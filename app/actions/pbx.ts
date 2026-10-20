"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { DEMO } from "@/lib/demo";

import { getCallerContext, type CallerContext } from "@/lib/services/pbx";

export type PbxEventRow = { id: string; cmd: string | null; receivedAt: string; payload: Record<string, unknown> };

/** Toate mesajele primite pentru un apel (în ordinea sosirii) — pentru popup-ul cu detaliile apelului. */
export async function getPbxEventsAction(callId: string): Promise<PbxEventRow[]> {
  const user = await requireUser();
  if (!can(user, "clients.view")) return [];
  if (DEMO || typeof callId !== "string" || !callId || callId.length > 120) return [];
  const rows = await prisma.pbxEvent.findMany({
    where: { callId },
    orderBy: { receivedAt: "asc" },
    take: 200,
    select: { id: true, cmd: true, receivedAt: true, payload: true },
  });
  return rows.map((r) => ({
    id: r.id,
    cmd: r.cmd,
    receivedAt: r.receivedAt.toISOString(),
    payload: (r.payload && typeof r.payload === "object" && !Array.isArray(r.payload) ? r.payload : {}) as Record<string, unknown>,
  }));
}

/**
 * Salvează o notă despre apel (cine a sunat, ce a cerut). Se păstrează pe apel și, dacă numărul e potrivit cu un client,
 * se adaugă și la notițele acestuia (ca să apară pe fișa lui) — cu data apelului în față.
 */
export async function savePbxCallNoteAction(
  callId: string,
  text: string,
): Promise<{ ok: true; note: string } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can(user, "clients.edit")) return { ok: false, error: "Fără permisiune." };
  if (DEMO) return { ok: false, error: "Mod demo." };
  const note = String(text ?? "").trim().slice(0, 2000);
  if (!note) return { ok: false, error: "Scrie nota." };
  if (typeof callId !== "string" || !callId || callId.length > 120) return { ok: false, error: "Apel invalid." };
  const call = await prisma.pbxCall.findUnique({ where: { callId }, select: { id: true, clientId: true, startAt: true, firstSeenAt: true, phone: true, note: true } });
  if (!call) return { ok: false, error: "Apelul nu există." };

  const when = (call.startAt ?? call.firstSeenAt).toLocaleString("ro-RO", { timeZone: "Europe/Chisinau", dateStyle: "short", timeStyle: "short" });
  await prisma.pbxCall.update({ where: { id: call.id }, data: { note: call.note ? `${call.note}\n${note}` : note } });
  if (call.clientId) {
    await prisma.payerNote.create({
      data: { clientId: call.clientId, body: `📞 Apel ${when}: ${note}`.slice(0, 2000), userId: user.id, userName: user.name },
    });
  }
  return { ok: true, note };
}

/** Datele curente ale unui client potrivit cu un apel (datorie, tichete deschise, ultima notiță). */
export async function getCallerContextAction(clientId: string): Promise<CallerContext | null> {
  const user = await requireUser();
  if (!can(user, "clients.view")) return null;
  if (DEMO || !/^[0-9a-f]{24}$/i.test(clientId ?? "")) return null;
  return getCallerContext(clientId);
}
