"use server";

import { requireSuperAdmin } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { DEMO } from "@/lib/demo";
import { clearLogMemo } from "@/lib/log-count";

export async function deleteAllAuditLogs(): Promise<{ ok: boolean; error?: string }> {
  await requireSuperAdmin();
  if (DEMO) return { ok: false, error: "Indisponibil în modul demo." };
  await prisma.auditLog.deleteMany({});
  clearLogMemo(); // totalurile și paginile memorate ale jurnalelor
  return { ok: true };
}
