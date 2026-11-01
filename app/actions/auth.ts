"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { CLIENT_SESSION_COOKIE, PORTAL_IMP_COOKIE } from "@/lib/client-session";
import { prisma } from "@/lib/prisma";
import { HashBusyError, checkPassword, dummyVerify, hashPassword } from "@/lib/password";
import { validateNewPassword } from "@/lib/password-policy";
import { clearFailures, hitLimit, isBlocked, loginRules, recordFailure, totpRules } from "@/lib/auth-throttle";
import { clearMfaPending, readMfaPending, registerDevice, setMfaPending } from "@/lib/login-security";
import { decryptSecret } from "@/lib/secret-box";
import { hashRecovery, looksLikeRecovery, verifyTotp } from "@/lib/totp";
import { clientIp } from "@/lib/request-ip";
import { isRateLimited } from "@/lib/rate-limit";
import { createSession, destroySession } from "@/lib/session";
import { loginSchema } from "@/lib/validation";
import { ensureDefaultCategories } from "@/lib/queries/categories";
import { getSettings } from "@/lib/queries/settings";
import { seedDemoData } from "@/lib/services/demo-seed";
import { getCurrentUser } from "@/lib/dal";
import { exitUserImpersonation } from "@/lib/services/impersonation";
import { logAudit } from "@/lib/services/audit";
import { DEMO } from "@/lib/demo";
import { createVerificationCode, consumeVerificationCode } from "@/lib/services/verification-codes";
import { sendVerificationCodeEmail } from "@/lib/email";

export type AuthState = { error?: string } | undefined;

function safeNext(next: FormDataEntryValue | null): string {
  const v = typeof next === "string" ? next : "";
  // doar căi interne, nu redirect-uri externe
  return v.startsWith("/") && !v.startsWith("//") ? v : "/dashboard";
}

async function requestMeta() {
  const h = await headers();
  return { userAgent: h.get("user-agent"), ip: await clientIp() };
}

const TOO_MANY = "Prea multe încercări. Încearcă din nou peste câteva minute.";
const BUSY = "Serverul este ocupat. Încearcă din nou peste câteva secunde.";

export async function login(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  if (DEMO) redirect("/dashboard");
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "Email sau parolă invalide." };
  }

  const email = parsed.data.email.toLowerCase();
  const ip = await clientIp();
  // 1) val de cereri de pe aceeași adresă: respins în memorie, fără bază de date și fără calcul de parolă
  if (ip && isRateLimited(`login-pre:${ip}`, 120, 60_000)) return { error: TOO_MANY };
  // 2) cont / adresă / pereche blocate după prea multe eșecuri (contoare comune între procese, în baza de date)
  const rules = loginRules("staff", email, ip);
  if ((await isBlocked(rules.map((r) => r.key))).blocked) return { error: TOO_MANY };

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, name: true, email: true, role: true, isSuperAdmin: true, isActive: true, totpEnabledAt: true },
  });

  let ok = false;
  let rehash: string | null = null;
  try {
    if (user && user.isActive) {
      const r = await checkPassword(parsed.data.password, user.passwordHash);
      ok = r.ok;
      rehash = r.rehash;
    } else {
      await dummyVerify(parsed.data.password); // același timp de răspuns ca pentru un cont real
    }
  } catch (e) {
    if (e instanceof HashBusyError) return { error: BUSY };
    throw e;
  }
  if (!ok || !user) {
    const st = await recordFailure(rules);
    if (st.justLocked && user) {
      // blocare nou-apărută pe un cont real: rămâne în jurnalul de audit (cu adresa), ca să se vadă încercările de intrare
      await logAudit({ id: user.id, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin }, { action: "auth.lockout", module: "Auth", newValue: `IP ${ip ?? "necunoscut"}` }).catch(() => {});
    }
    return { error: st.blocked ? TOO_MANY : "Email sau parolă greșite." };
  }
  await clearFailures(rules.filter((r) => !r.key.includes(":ip:")).map((r) => r.key)); // doar cheile contului; limita pe adresă nu se resetează
  if (rehash) await prisma.user.update({ where: { id: user.id }, data: { passwordHash: rehash } }).catch(() => {}); // hash vechi (bcrypt) → scrypt, transparent

  // autentificare în doi pași activă: parola singură nu deschide sesiunea — mai trebuie codul din aplicația de autentificare (sau un cod de recuperare)
  if (user.totpEnabledAt) {
    await setMfaPending(user.id, safeNext(formData.get("next")));
    redirect("/login/verify");
  }
  await finishLogin(user, safeNext(formData.get("next")));
}

type LoginUser = { id: string; name: string; email: string; role: string; isSuperAdmin: boolean };

/** Ultimul pas al oricărei intrări reușite (doar parolă sau parolă + cod): sesiunea, jurnalul de audit, dispozitivul (notificare dacă e nou). */
async function finishLogin(user: LoginUser, next: string, how: "password" | "totp" | "recovery" = "password"): Promise<never> {
  const meta = await requestMeta();
  await createSession(user.id, meta);
  await logAudit(
    { id: user.id, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin },
    { action: "auth.login", module: "Auth", newValue: how === "password" ? null : how === "totp" ? "cod TOTP" : "cod de recuperare" },
  );
  await registerDevice(user, meta);
  redirect(next);
}

const BAD_CODE = "Cod greșit sau expirat.";

/** Pasul 2 al intrării: codul din aplicația de autentificare (6 cifre) sau un cod de recuperare (XXXXX-XXXXX). */
export async function verifyLoginTotp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  if (DEMO) redirect("/dashboard");
  const pend = await readMfaPending();
  if (!pend) redirect("/login");
  const ip = await clientIp();
  if (ip && isRateLimited(`login-pre:${ip}`, 120, 60_000)) return { error: TOO_MANY };
  const rules = totpRules(pend.userId, ip);
  if ((await isBlocked(rules.map((r) => r.key))).blocked) return { error: TOO_MANY };

  const user = await prisma.user.findUnique({
    where: { id: pend.userId },
    select: { id: true, name: true, email: true, role: true, isSuperAdmin: true, isActive: true, totpSecret: true, totpEnabledAt: true, totpLastStep: true },
  });
  const secret = user?.isActive && user.totpEnabledAt ? decryptSecret(user.totpSecret) : null;
  if (!user || !secret) {
    await clearMfaPending();
    redirect("/login");
  }

  const code = String(formData.get("code") ?? "").trim().slice(0, 40);
  let how: "totp" | "recovery" | null = null;
  if (/^\d{6}$/.test(code.replace(/\s+/g, ""))) {
    const step = verifyTotp(secret, code, user.totpLastStep);
    // același cod nu se poate folosi de două ori: pasul se reține atomic (două cereri simultane cu același cod — trece doar una)
    if (step !== null) {
      const r = await prisma.user.updateMany({ where: { id: user.id, OR: [{ totpLastStep: { lt: step } }, { totpLastStep: { isSet: false } }, { totpLastStep: null }] }, data: { totpLastStep: step } });
      if (r.count === 1) how = "totp";
    }
  } else if (looksLikeRecovery(code)) {
    const h = hashRecovery(code);
    const r = (await prisma.$runCommandRaw({ update: "User", updates: [{ q: { _id: { $oid: user.id }, totpRecovery: h }, u: { $pull: { totpRecovery: h } } }] })) as { nModified?: number };
    if (Number(r.nModified) === 1) how = "recovery";
  }
  if (!how) {
    const st = await recordFailure(rules);
    return { error: st.blocked ? TOO_MANY : BAD_CODE };
  }
  await clearFailures(rules.filter((r) => !r.key.includes(":ip:")).map((r) => r.key));
  await clearMfaPending();
  if (how === "recovery") {
    await logAudit({ id: user.id, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin }, { action: "auth.recovery_code_used", module: "Auth" }).catch(() => {});
  }
  await finishLogin(user, pend.next, how);
  return undefined;
}

/** „Înapoi” de pe pasul cu codul: renunță la intrarea începută și revine la formularul cu parolă. */
export async function cancelLoginTotp(): Promise<void> {
  await clearMfaPending();
  redirect("/login");
}

/**
 * Bootstrap: creează primul cont (administrator) doar dacă DB-ul e gol.
 * Permite pornirea aplicației fără intervenție manuală în bază.
 */
export async function register(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  if (DEMO) redirect("/dashboard");
  const count = await prisma.user.count();
  if (count > 0) {
    return { error: "Există deja un cont. Autentifică-te." };
  }

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (name.length < 2) return { error: "Numele e prea scurt." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Email invalid." };
  const weak = validateNewPassword(password, { email, name });
  if (weak) return { error: weak };

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await hashPassword(password),
      role: "ADMIN",
      isSuperAdmin: true,
    },
    select: { id: true },
  });

  await getSettings(user.id); // creează setările default
  await ensureDefaultCategories(user.id);
  await seedDemoData(user.id); // client/proiect/task/factură de exemplu
  await createSession(user.id, await requestMeta());
  redirect("/dashboard");
}

/**
 * Cerere de resetare parolă uitată (neautentificat). Răspunsul e ACELAȘI indiferent dacă emailul are cont sau nu (altfel oricine ar putea afla ce conturi există), iar
 * cererile sunt limitate pe email și pe adresă (altfel ar putea fi folosite ca să umple căsuța cuiva cu coduri).
 */
export async function requestPasswordReset(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  if (DEMO) return { error: "Mod demo: conectează o bază de date." };
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Email invalid." };

  const ip = await clientIp();
  const over =
    (ip ? await hitLimit({ key: `staff:reset:ip:${ip}`, max: 10, windowMs: 60 * 60_000, lockMs: 0 }) : false) ||
    (await hitLimit({ key: `staff:reset:email:${email}`, max: 3, windowMs: 60 * 60_000, lockMs: 0 }));
  if (!over) {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, isActive: true } });
    if (user?.isActive) {
      try {
        const code = await createVerificationCode(user.id, "PASSWORD_RESET");
        await sendVerificationCodeEmail({ to: email, name: user.name, code, purpose: "PASSWORD_RESET" });
      } catch (e) {
        console.error("[auth] eșec trimitere cod resetare parolă:", e); // doar în jurnalul serverului: utilizatorul primește același răspuns
      }
    }
  }
  redirect(`/reset-password?email=${encodeURIComponent(email)}&sent=1`);
}

/** Confirmă codul primit pe email și setează parola nouă (flux „am uitat parola"). */
export async function resetPasswordWithCode(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  if (DEMO) return { error: "Mod demo." };
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const code = String(formData.get("code") ?? "").trim();
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!/^\d{6}$/.test(code)) return { error: "Cod invalid — introdu cele 6 cifre primite pe email." };
  if (newPassword !== confirmPassword) return { error: "Parolele nu coincid." };
  {
    const ip = await clientIp();
    if ((ip && (await hitLimit({ key: `staff:resetcode:ip:${ip}`, max: 20, windowMs: 15 * 60_000, lockMs: 0 }))) || (await hitLimit({ key: `staff:resetcode:email:${email}`, max: 10, windowMs: 15 * 60_000, lockMs: 0 }))) return { error: TOO_MANY };
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, role: true, isSuperAdmin: true } });
  if (!user) return { error: "Cod incorect sau expirat. Cere un cod nou." };

  const weak = validateNewPassword(newPassword, { email, name: user.name });
  if (weak) return { error: weak };

  const valid = await consumeVerificationCode(user.id, "PASSWORD_RESET", code);
  if (!valid) return { error: "Cod incorect sau expirat. Cere un cod nou." };

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  await prisma.session.deleteMany({ where: { userId: user.id } }); // deloghează toate dispozitivele

  await logAudit(
    { id: user.id, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin },
    { action: "auth.password_reset", module: "Auth" },
  );

  redirect("/login?reset=1");
}

export async function logout(): Promise<void> {
  if (DEMO) redirect("/dashboard");
  const current = await getCurrentUser();
  // În simulare, „Deconectare” înseamnă ieșirea din simulare (te întorci în contul tău), nu delogarea contului simulat.
  if (current?.impersonation) {
    const r = await exitUserImpersonation();
    redirect(r.ok ? r.to : "/login");
  }
  if (current) {
    await logAudit(
      { id: current.id, name: current.name, role: current.role, isSuperAdmin: current.isSuperAdmin },
      { action: "auth.logout", module: "Auth" },
    );
    // simulările de portal pornite de acest utilizator se încheie odată cu delogarea lui
    await prisma.clientSession.deleteMany({ where: { impersonatedById: current.id } }).catch(() => {});
    const store = await cookies();
    if (store.get(PORTAL_IMP_COOKIE)) {
      store.delete(CLIENT_SESSION_COOKIE);
      store.delete(PORTAL_IMP_COOKIE);
    }
  }
  await destroySession();
  redirect("/login");
}
