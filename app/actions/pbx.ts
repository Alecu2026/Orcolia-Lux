"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { DEMO } from "@/lib/demo";

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
