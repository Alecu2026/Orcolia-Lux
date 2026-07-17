import "server-only";
import { after } from "next/server";
import { headers } from "next/headers";
import { prisma } from "../prisma";
import { DEMO } from "../demo";

export type AuditActor = {
  id: string;
  name: string;
  role: string;
  isSuperAdmin?: boolean;
};

export type AuditInput = {
  action: string; // cheie din lib/audit-meta.ts (ex: "task.status_change")
  module: string; // una din AUDIT_MODULES
  objectId?: string | null;
  objectName?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
};

/**
 * Înregistrează o acțiune în Audit Logs.
 * Non-blocant: citește IP/User-Agent sincron, apoi scrie în DB prin `after()`
 * (după ce răspunsul a fost trimis). Eșecul logării nu afectează acțiunea.
 */
export async function logAudit(actor: AuditActor, input: AuditInput): Promise<void> {
  if (DEMO) return;
  if (!actor?.id) return;

  let ip: string | null = null;
  let userAgent: string | null = null;
  try {
    const h = await headers();
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
    userAgent = h.get("user-agent");
  } catch {
    // în afara unui request scope — ignorăm meta
  }

  const data = {
    userId: actor.id,
    userName: actor.name,
    userRole: actor.isSuperAdmin ? `${actor.role}·SUPER` : actor.role,
    action: input.action,
    module: input.module,
    objectId: input.objectId ?? null,
    objectName: input.objectName ?? null,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    ip,
    userAgent,
  };

  const write = () => prisma.auditLog.create({ data }).then(() => undefined).catch(() => undefined);
  try {
    after(write);
  } catch {
    // fără request scope (rar) — fire-and-forget
    void write();
  }
}
