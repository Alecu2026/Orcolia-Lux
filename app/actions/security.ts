"use server";

import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import { blockedInImpersonation, requireUser, type CurrentUser } from "@/lib/dal";
import { HashBusyError, checkPassword } from "@/lib/password";
import { hitLimit } from "@/lib/auth-throttle";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { groupSecret, hashRecovery, newRecoveryCodes, newTotpSecret, otpauthUri, verifyTotp } from "@/lib/totp";
import { DEMO } from "@/lib/demo";
import { logAudit } from "@/lib/services/audit";
import { getSessionToken, hashToken } from "@/lib/session";

/** Acțiunile din Setări → Securitate: autentificarea în doi pași (TOTP) și sesiunile. Toate cer parola contului (și codul, unde există deja 2FA): o sesiune furată nu poate opri protecția. */

const actor = (u: CurrentUser) => ({ id: u.id, name: u.name, role: u.role, isSuperAdmin: u.isSuperAdmin });
const TOO_MANY = "Prea multe încercări. Încearcă din nou peste câteva minute.";
const BAD_PASSWORD = "Parola este greșită.";
const BAD_CODE = "Cod greșit sau expirat.";
const WAIT_CODE = "Acest cod a fost deja folosit. Așteaptă următorul cod (se schimbă la 30 de secunde) și încearcă din nou.";

export type SetupInfo = { qr: string; secret: string };
export type SecResult<T = object> = ({ ok: true } & T) | { ok?: false; error: string };

async function gate(): Promise<{ user: CurrentUser } | { error: string }> {
  const user = await requireUser();
  const blocked = blockedInImpersonation(user);
  if (blocked) return { error: blocked };
  if (DEMO) return { error: "Mod demo: conectează o bază de date." };
  if (await hitLimit({ key: `staff:security:${user.id}`, max: 15, windowMs: 15 * 60_000, lockMs: 0 })) return { error: TOO_MANY };
  return { user };
}

async function passwordOk(userId: string, password: string): Promise<boolean | "busy"> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!u) return false;
  try {
    return (await checkPassword(password, u.passwordHash)).ok;
  } catch (e) {
    if (e instanceof HashBusyError) return "busy";
    throw e;
  }
}

/** Pasul 1: secret nou + codul QR. Nu activează nimic până nu se confirmă cu un cod. */
export async function startTotpSetup(): Promise<SecResult<SetupInfo>> {
  const g = await gate();
  if ("error" in g) return g;
  const me = await prisma.user.findUnique({ where: { id: g.user.id }, select: { totpEnabledAt: true, email: true } });
  if (me?.totpEnabledAt) return { error: "Autentificarea în doi pași este deja activă." };
  const secret = newTotpSecret();
  await prisma.user.update({ where: { id: g.user.id }, data: { totpPending: encryptSecret(secret) } });
  const qr = await QRCode.toDataURL(otpauthUri(secret, me?.email ?? g.user.email), { errorCorrectionLevel: "M", margin: 1, width: 220 });
  return { ok: true, qr, secret: groupSecret(secret) };
}

/** Pasul 2: parola + primul cod din aplicație. Activează 2FA și întoarce, o singură dată, codurile de recuperare. */
export async function confirmTotpSetup(password: string, code: string): Promise<SecResult<{ recovery: string[] }>> {
  const g = await gate();
  if ("error" in g) return g;
  const pw = await passwordOk(g.user.id, String(password ?? ""));
  if (pw === "busy") return { error: "Serverul este ocupat. Încearcă din nou peste câteva secunde." };
  if (!pw) return { error: BAD_PASSWORD };
  const me = await prisma.user.findUnique({ where: { id: g.user.id }, select: { totpPending: true, totpEnabledAt: true } });
  const secret = decryptSecret(me?.totpPending);
  if (me?.totpEnabledAt) return { error: "Autentificarea în doi pași este deja activă." };
  if (!secret) return { error: "Configurarea a expirat. Începe din nou." };
  const step = verifyTotp(secret, String(code ?? ""), null);
  if (step === null) return { error: BAD_CODE };
  const recovery = newRecoveryCodes();
  await prisma.user.update({
    where: { id: g.user.id },
    data: { totpSecret: encryptSecret(secret), totpEnabledAt: new Date(), totpPending: null, totpLastStep: step, totpRecovery: recovery.map(hashRecovery) },
  });
  await logAudit(actor(g.user), { action: "user.totp_enable", module: "Users", objectId: g.user.id, objectName: g.user.name });
  revalidatePath("/settings");
  return { ok: true, recovery };
}

/** Renunță la o configurare începută (închide fereastra fără să confirme). */
export async function cancelTotpSetup(): Promise<void> {
  const user = await requireUser();
  await prisma.user.update({ where: { id: user.id }, data: { totpPending: null } }).catch(() => {});
}

/** Parola + un cod valid (nefolosit) al contului — cerute la oprire și la regenerarea codurilor de recuperare. */
async function proveSecondFactor(userId: string, password: string, code: string): Promise<string | null> {
  const pw = await passwordOk(userId, String(password ?? ""));
  if (pw === "busy") return "Serverul este ocupat. Încearcă din nou peste câteva secunde.";
  if (!pw) return BAD_PASSWORD;
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { totpSecret: true, totpEnabledAt: true, totpLastStep: true } });
  const secret = me?.totpEnabledAt ? decryptSecret(me.totpSecret) : null;
  if (!secret) return "Autentificarea în doi pași nu este activă.";
  const step = verifyTotp(secret, String(code ?? ""), me?.totpLastStep);
  if (step === null) {
    // un cod corect, dar deja folosit (de ex. chiar la intrare) → mesaj separat, ca să nu pară că e greșit
    return verifyTotp(secret, String(code ?? ""), null) !== null ? WAIT_CODE : BAD_CODE;
  }
  const r = await prisma.user.updateMany({ where: { id: userId, OR: [{ totpLastStep: { lt: step } }, { totpLastStep: { isSet: false } }, { totpLastStep: null }] }, data: { totpLastStep: step } });
  return r.count === 1 ? null : WAIT_CODE;
}

export async function disableTotp(password: string, code: string): Promise<SecResult> {
  const g = await gate();
  if ("error" in g) return g;
  const err = await proveSecondFactor(g.user.id, password, code);
  if (err) return { error: err };
  await prisma.user.update({ where: { id: g.user.id }, data: { totpSecret: null, totpEnabledAt: null, totpPending: null, totpLastStep: null, totpRecovery: [] } });
  await logAudit(actor(g.user), { action: "user.totp_disable", module: "Users", objectId: g.user.id, objectName: g.user.name });
  revalidatePath("/settings");
  return { ok: true };
}

export async function regenerateRecoveryCodes(password: string, code: string): Promise<SecResult<{ recovery: string[] }>> {
  const g = await gate();
  if ("error" in g) return g;
  const err = await proveSecondFactor(g.user.id, password, code);
  if (err) return { error: err };
  const recovery = newRecoveryCodes();
  await prisma.user.update({ where: { id: g.user.id }, data: { totpRecovery: recovery.map(hashRecovery) } });
  await logAudit(actor(g.user), { action: "user.totp_recovery_regenerate", module: "Users", objectId: g.user.id, objectName: g.user.name });
  revalidatePath("/settings");
  return { ok: true, recovery };
}

/** „Nu am fost eu”: închide toate sesiunile contului, în afară de cea curentă. */
export async function signOutOtherSessions(): Promise<SecResult<{ count: number }>> {
  const user = await requireUser();
  const blocked = blockedInImpersonation(user);
  if (blocked) return { error: blocked };
  if (DEMO) return { error: "Mod demo: conectează o bază de date." };
  const token = await getSessionToken();
  const r = await prisma.session.deleteMany({ where: { userId: user.id, ...(token ? { tokenHash: { not: hashToken(token) } } : {}) } });
  await logAudit(actor(user), { action: "user.sessions_revoke", module: "Users", objectId: user.id, objectName: user.name, newValue: `${r.count}` });
  revalidatePath("/settings");
  return { ok: true, count: r.count };
}
