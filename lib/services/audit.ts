import "server-only";
import { after } from "next/server";
import { headers } from "next/headers";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import type { AuditDetails } from "../audit-meta";

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
  /** Modificări pe câmpuri + informații suplimentare (se văd în pop-up-ul din Audit Logs). */
  details?: AuditDetails | null;
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
  let path: string | null = null;
  try {
    const h = await headers();
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
    userAgent = h.get("user-agent");
    // pagina din care s-a făcut acțiunea (la acțiunile de server, Referer = pagina deschisă în browser)
    const ref = h.get("referer");
    if (ref) path = new URL(ref).pathname.slice(0, 200);
  } catch {
    // în afara unui request scope — ignorăm meta
  }

  // Acțiune făcută printr-o simulare de login: în jurnal apare cine a făcut-o de fapt
  let userName = actor.name;
  try {
    const { getCurrentUser } = await import("../dal");
    const cu = await getCurrentUser();
    if (cu?.impersonation && cu.id === actor.id) userName = `${actor.name} (simulat de ${cu.impersonation.byName})`;
  } catch {
    // în afara unui request — fără marcaj
  }

  const data = {
    userId: actor.id,
    userName,
    userRole: actor.isSuperAdmin ? `${actor.role}·SUPER` : actor.role,
    action: input.action,
    module: input.module,
    objectId: input.objectId ?? null,
    objectName: input.objectName ?? null,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    ip,
    userAgent,
    path,
    details: serializeDetails(input.details),
  };

  const write = () => prisma.auditLog.create({ data }).then(() => undefined).catch(() => undefined);
  try {
    after(write);
  } catch {
    // fără request scope (rar) — fire-and-forget
    void write();
  }
}

/** Detaliile ca JSON (maximum ~20 KB: un câmp enorm nu are voie să umfle jurnalul); fără nimic de arătat → null. */
function serializeDetails(d: AuditDetails | null | undefined): string | null {
  if (!d) return null;
  const changes = (d.changes ?? []).slice(0, 60).map((c) => ({ ...c, old: clip(c.old), new: clip(c.new) }));
  const extra = (d.extra ?? []).slice(0, 30).map((x) => ({ label: x.label, value: clip(x.value) ?? "" }));
  if (!changes.length && !extra.length) return null;
  const json = JSON.stringify({ ...(changes.length ? { changes } : {}), ...(extra.length ? { extra } : {}) });
  return json.length > 20_000 ? json.slice(0, 20_000) : json;
}
const clip = (v: string | null | undefined) => (v == null ? null : v.length > 1500 ? `${v.slice(0, 1500)}…` : v);
