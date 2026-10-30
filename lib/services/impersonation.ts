import "server-only";
import { cookies, headers } from "next/headers";
import { prisma } from "../prisma";
import { env } from "../env";
import { generateToken, getSessionToken, hashToken, ORIG_SESSION_COOKIE, SESSION_COOKIE } from "../session";
import { CLIENT_SESSION_COOKIE, PORTAL_IMP_COOKIE, generateClientToken, getClientSessionToken, hashClientToken } from "../client-session";
import { canImpersonatePortal, canImpersonateUser, IMPERSONATION_TTL_MS } from "../impersonation";
import { homePath } from "../permissions";
import { logAudit } from "./audit";
import type { CurrentUser } from "../dal";

/**
 * Simulare de login. Regulile (cine pe cine) sunt în lib/impersonation.ts; aici sunt sesiunile și cookie-urile.
 *
 * Staff: se creează o sesiune nouă pentru contul simulat (expiră FIX după 6 ore, fără prelungire, cu `impersonatorId`) și se pune în cookie-ul
 * principal ca cookie de sesiune (dispare la închiderea browserului); sesiunea proprie rămâne neatinsă, iar tokenul ei se mută în cookie-ul
 * `<sesiune>_orig` (httpOnly). La ieșire (sau când simularea expiră) tokenul din `_orig` revine în cookie-ul principal — nu trebuie să te autentifici din nou.
 *
 * Portal: se creează o sesiune de client (tot 6 ore) cu `impersonatedById`; sesiunea de staff rămâne separată, în propriul cookie.
 */

export { PORTAL_IMP_COOKIE };

export type ImpResult = { ok: true; to: string } | { ok: false; error: string; status: number };

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const actorOf = (u: { id: string; name: string; role: string; isSuperAdmin?: boolean }) => ({ id: u.id, name: u.name, role: u.role, isSuperAdmin: u.isSuperAdmin });

async function meta() {
  const h = await headers();
  return { userAgent: h.get("user-agent"), ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null };
}

const cookieBase = { httpOnly: true, secure: env.isProd, sameSite: "lax" as const, path: "/" };

/** Pune înapoi sesiunea proprie (din cookie-ul `_orig`), dacă încă e validă; întoarce utilizatorul ei. Folosit la ieșire și când simularea a expirat. */
export async function restoreOriginalSession(expectUserId?: string): Promise<{ id: string; name: string; role: string; isSuperAdmin: boolean } | null> {
  const store = await cookies();
  const origToken = store.get(ORIG_SESSION_COOKIE)?.value;
  if (!origToken) return null;
  const row = await prisma.session.findUnique({
    where: { tokenHash: hashToken(origToken) },
    select: { userId: true, expiresAt: true, impersonatorId: true, user: { select: { id: true, name: true, role: true, isSuperAdmin: true, isActive: true } } },
  });
  if (!row || row.impersonatorId || row.expiresAt.getTime() < Date.now() || !row.user.isActive || (expectUserId && row.userId !== expectUserId)) {
    store.delete(ORIG_SESSION_COOKIE);
    return null;
  }
  store.set(SESSION_COOKIE, origToken, { ...cookieBase, expires: row.expiresAt });
  store.delete(ORIG_SESSION_COOKIE);
  return row.user;
}

/** Intră în contul unui utilizator (cu aceleași drepturi ca el). */
export async function startUserImpersonation(actor: CurrentUser, targetId: string): Promise<ImpResult> {
  if (actor.impersonation) return { ok: false, error: "Ieși mai întâi din simularea curentă.", status: 409 };
  if (!OBJECT_ID.test(targetId ?? "")) return { ok: false, error: "Utilizator invalid.", status: 400 };
  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, name: true, role: true, permissions: true, isActive: true, isSuperAdmin: true, taskViewScope: true, taskViewTeamIds: true, taskViewMemberIds: true },
  });
  if (!target) return { ok: false, error: "Utilizatorul nu există.", status: 404 };
  const can = canImpersonateUser(actor, target);
  if (!can.ok) return { ok: false, error: can.reason, status: 403 };

  const origToken = await getSessionToken();
  const orig = origToken ? await prisma.session.findUnique({ where: { tokenHash: hashToken(origToken) }, select: { expiresAt: true } }) : null;
  if (!origToken || !orig) return { ok: false, error: "Sesiune invalidă.", status: 401 };

  const token = generateToken();
  const m = await meta();
  await prisma.session.create({
    data: { userId: target.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + IMPERSONATION_TTL_MS), userAgent: m.userAgent, ip: m.ip, impersonatorId: actor.id },
  });
  const store = await cookies();
  store.set(ORIG_SESSION_COOKIE, origToken, { ...cookieBase, expires: orig.expiresAt });
  store.set(SESSION_COOKIE, token, cookieBase); // cookie de sesiune: dispare la închiderea browserului; termenul de 6 ore e în baza de date

  await logAudit(actorOf(actor), { action: "auth.impersonate_start", module: "Auth", objectId: target.id, objectName: target.name });
  return { ok: true, to: homePath({ role: target.role === "ADMIN" ? "ADMIN" : "STAFF", permissions: target.permissions }) };
}

/**
 * Ieșire din simulare: sesiunea simulată se șterge, iar cea proprie revine. Merge și dacă simularea a expirat între timp (butonul a rămas pe o pagină deschisă):
 * atunci sesiunea simulată nu mai există, dar tokenul propriu din cookie-ul `_orig` te readuce în contul tău.
 */
export async function exitUserImpersonation(): Promise<ImpResult> {
  const token = await getSessionToken();
  const cur = token
    ? await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, select: { id: true, impersonatorId: true, expiresAt: true, user: { select: { id: true, name: true } } } })
    : null;
  if (cur && !cur.impersonatorId) return { ok: false, error: "Nu ești într-o simulare de login.", status: 400 };
  if (cur) await prisma.session.delete({ where: { id: cur.id } }).catch(() => {});

  const back = await restoreOriginalSession(cur?.impersonatorId ?? undefined);
  if (!back) {
    const store = await cookies();
    store.delete(SESSION_COOKIE);
    store.delete(ORIG_SESSION_COOKIE);
    return { ok: true, to: "/login" };
  }
  await logAudit(actorOf(back), { action: "auth.impersonate_end", module: "Auth", objectId: cur?.user.id, objectName: cur ? (cur.expiresAt.getTime() < Date.now() ? `${cur.user.name} (simulare expirată)` : cur.user.name) : "simulare încheiată (expirată)" });
  return { ok: true, to: "/simulare" };
}

/** Intră în portalul unui client (cu aceleași drepturi ca el). */
export async function startPortalImpersonation(actor: CurrentUser, clientId: string): Promise<ImpResult> {
  if (actor.impersonation) return { ok: false, error: "Ieși mai întâi din simularea curentă.", status: 409 };
  if (!canImpersonatePortal(actor)) return { ok: false, error: "Nu ai permisiunea de simulare de login în portal.", status: 403 };
  if (!OBJECT_ID.test(clientId ?? "")) return { ok: false, error: "Client invalid.", status: 400 };
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true, portalPasswordHash: true } });
  if (!client) return { ok: false, error: "Clientul nu există.", status: 404 };
  if (!client.portalPasswordHash) return { ok: false, error: "Clientul nu are cont activ în portal.", status: 409 };

  const token = generateClientToken();
  const m = await meta();
  await prisma.clientSession.create({
    data: { clientId: client.id, tokenHash: hashClientToken(token), expiresAt: new Date(Date.now() + IMPERSONATION_TTL_MS), userAgent: m.userAgent, ip: m.ip, impersonatedById: actor.id },
  });
  const store = await cookies();
  store.set(CLIENT_SESSION_COOKIE, token, cookieBase);
  store.set(PORTAL_IMP_COOKIE, "1", cookieBase); // marcaj: la expirare, mergi înapoi în staff (nu la login-ul portalului)

  await logAudit(actorOf(actor), { action: "auth.impersonate_portal_start", module: "Auth", objectId: client.id, objectName: client.name });
  return { ok: true, to: "/portal" };
}

/** Ieșire din portalul simulat: sesiunea de client se șterge; sesiunea de staff e neatinsă. */
export async function exitPortalImpersonation(): Promise<ImpResult> {
  const token = await getClientSessionToken();
  const row = token
    ? await prisma.clientSession.findUnique({ where: { tokenHash: hashClientToken(token) }, select: { id: true, impersonatedById: true, client: { select: { id: true, name: true } } } })
    : null;
  if (!row?.impersonatedById) return { ok: false, error: "Nu ești într-o simulare de login în portal.", status: 400 };
  await prisma.clientSession.delete({ where: { id: row.id } }).catch(() => {});
  const store = await cookies();
  store.delete(CLIENT_SESSION_COOKIE);
  store.delete(PORTAL_IMP_COOKIE);

  const by = await prisma.user.findUnique({ where: { id: row.impersonatedById }, select: { id: true, name: true, role: true, isSuperAdmin: true } });
  if (by) await logAudit(actorOf(by), { action: "auth.impersonate_portal_end", module: "Auth", objectId: row.client.id, objectName: row.client.name });
  const { getCurrentUser } = await import("../dal");
  return { ok: true, to: (await getCurrentUser()) ? "/simulare" : "/login" };
}

/** Acțiune făcută în portal printr-o simulare de login: apare în Audit Logs cu utilizatorul care a făcut-o de fapt, nu doar ca acțiune a clientului. */
export async function auditPortalAction(what: string, objectId?: string): Promise<void> {
  try {
    const { getCurrentClient } = await import("../client-dal");
    const c = await getCurrentClient();
    if (!c?.impersonation) return;
    const by = await prisma.user.findUnique({ where: { id: c.impersonation.byId }, select: { id: true, name: true, role: true, isSuperAdmin: true } });
    if (by) await logAudit(actorOf(by), { action: "auth.impersonate_portal_action", module: "Auth", objectId: objectId ?? c.id, objectName: `${c.name}: ${what}` });
  } catch {
    // jurnalul nu blochează acțiunea
  }
}
