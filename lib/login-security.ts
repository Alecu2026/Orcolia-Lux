import "server-only";
import { cookies } from "next/headers";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./prisma";
import { env } from "./env";
import { describeAgent } from "./audit-meta";
import { notifyUsers } from "./services/notifications";
import { sendNewDeviceEmail } from "./email";
import { logAudit } from "./services/audit";

/**
 * Părțile de autentificare comune parolei și codului TOTP:
 *  - „parola e corectă, mai lipsește codul”: un cookie semnat, scurt (5 min), care spune DOAR „cine a dat parola corectă” și nu dă acces la nimic (sesiunea se creează abia după cod);
 *  - dispozitivul de încredere / notificarea de dispozitiv nou.
 */

const MFA_COOKIE = `${env.sessionCookieName}_mfa`;
const MFA_TTL_MS = 5 * 60_000;
const DEVICE_COOKIE = "pr_dev";
const DEVICE_TTL_MS = 2 * 365 * 24 * 3600_000;
const MAX_DEVICES = 20;

const macKey = () => createHash("sha256").update(`mfa-pending:${env.sessionSecret}`).digest();
const sign = (payload: string) => createHmac("sha256", macKey()).update(payload).digest("base64url");

export type MfaPending = { userId: string; next: string };

export async function setMfaPending(userId: string, next: string): Promise<void> {
  const payload = Buffer.from(JSON.stringify({ u: userId, n: next, e: Date.now() + MFA_TTL_MS })).toString("base64url");
  (await cookies()).set(MFA_COOKIE, `${payload}.${sign(payload)}`, { httpOnly: true, secure: env.isProd, sameSite: "lax", maxAge: MFA_TTL_MS / 1000, path: "/" });
}

/** Cookie-ul „parolă corectă”: semnătura și expirarea verificate; null dacă lipsește, e falsificat sau a expirat. */
export async function readMfaPending(): Promise<MfaPending | null> {
  const raw = (await cookies()).get(MFA_COOKIE)?.value;
  if (!raw) return null;
  const [payload, mac] = raw.split(".");
  if (!payload || !mac) return null;
  const a = Buffer.from(mac), b = Buffer.from(sign(payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const j = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u?: string; n?: string; e?: number };
    if (typeof j.u !== "string" || typeof j.e !== "number" || j.e < Date.now()) return null;
    return { userId: j.u, next: typeof j.n === "string" ? j.n : "/dashboard" };
  } catch {
    return null;
  }
}

export async function clearMfaPending(): Promise<void> {
  (await cookies()).delete(MFA_COOKIE);
}

const hashDevice = (token: string) => createHash("sha256").update(`device:${token}`).digest("hex");

/**
 * După o intrare reușită: dacă dispozitivul (cookie-ul `pr_dev`) nu e printre cele cunoscute ale contului, îl reține și anunță utilizatorul (în aplicație + push + email).
 * Prima intrare după introducerea funcției (niciun dispozitiv reținut încă) doar înregistrează dispozitivul, fără alertă. Nu aruncă niciodată: alerta nu poate strica intrarea.
 */
export async function registerDevice(
  user: { id: string; name: string; email: string; role: string; isSuperAdmin: boolean },
  meta: { userAgent?: string | null; ip?: string | null },
): Promise<void> {
  try {
    const store = await cookies();
    const cur = store.get(DEVICE_COOKIE)?.value;
    const token = cur && /^[A-Za-z0-9_-]{32,64}$/.test(cur) ? cur : randomBytes(24).toString("base64url");
    const h = hashDevice(token);
    store.set(DEVICE_COOKIE, token, { httpOnly: true, secure: env.isProd, sameSite: "lax", maxAge: DEVICE_TTL_MS / 1000, path: "/" });

    const row = await prisma.user.findUnique({ where: { id: user.id }, select: { knownDevices: true } });
    const known = row?.knownDevices ?? [];
    if (known.includes(h)) return;
    await prisma.user.update({ where: { id: user.id }, data: { knownDevices: { set: [...known, h].slice(-MAX_DEVICES) } } });
    if (known.length === 0) return; // prima înregistrare: baza de la care începe urmărirea

    const agent = describeAgent(meta.userAgent) ?? { browser: "Necunoscut", os: "Necunoscut", device: "" };
    const when = new Intl.DateTimeFormat("ro-RO", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Chisinau" }).format(new Date());
    const where = meta.ip ? ` · IP ${meta.ip}` : "";
    await logAudit(
      { id: user.id, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin },
      { action: "auth.new_device", module: "Auth", newValue: `${agent.browser}, ${agent.os}${where}` },
    ).catch(() => {});
    void notifyUsers([user.id], {
      title: "🔐 Autentificare de pe un dispozitiv nou",
      body: `${agent.browser}, ${agent.os}${where}. Dacă nu ai fost tu, schimbă parola.`,
      url: "/settings?tab=security",
    }).catch(() => {});
    void sendNewDeviceEmail({ to: user.email, name: user.name, when, browser: agent.browser, os: agent.os, ip: meta.ip ?? null, securityUrl: `${env.appUrl}/settings?tab=security` }).catch(() => {});
  } catch (e) {
    console.error("[login-security] dispozitiv:", String((e as Error)?.message ?? e).slice(0, 160));
  }
}
