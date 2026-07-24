"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/password";
import { createSession, destroySession } from "@/lib/session";
import { loginSchema } from "@/lib/validation";
import { ensureDefaultCategories } from "@/lib/queries/categories";
import { getSettings } from "@/lib/queries/settings";
import { seedDemoData } from "@/lib/services/demo-seed";
import { getCurrentUser } from "@/lib/dal";
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
  return {
    userAgent: h.get("user-agent"),
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  };
}

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

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, passwordHash: true, name: true, role: true, isSuperAdmin: true, isActive: true },
  });

  if (!user || !user.isActive) {
    return { error: "Email sau parolă greșite." };
  }
  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) {
    return { error: "Email sau parolă greșite." };
  }

  await createSession(user.id, await requestMeta());
  await logAudit(
    { id: user.id, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin },
    { action: "auth.login", module: "Auth" },
  );
  redirect(safeNext(formData.get("next")));
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
  if (password.length < 8) return { error: "Parola: minim 8 caractere." };

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
 * Cerere de resetare parolă uitată (neautentificat). La cerere explicită,
 * dezvăluie dacă emailul există în sistem (mai clar pentru useri, la un CRM
 * intern riscul de enumerare a conturilor e acceptabil).
 */
export async function requestPasswordReset(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  if (DEMO) return { error: "Mod demo: conectează o bază de date." };
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Email invalid." };

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, isActive: true },
  });
  if (!user || !user.isActive) {
    return { error: "Nu există niciun cont cu acest email." };
  }

  const code = await createVerificationCode(user.id, "PASSWORD_RESET");
  try {
    await sendVerificationCodeEmail({ to: email, name: user.name, code, purpose: "PASSWORD_RESET" });
  } catch (e) {
    console.error("[auth] eșec trimitere cod resetare parolă:", e);
    return { error: "Contul există, dar trimiterea emailului a eșuat. Verifică setările SMTP." };
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
  if (newPassword.length < 8) return { error: "Parola: minim 8 caractere." };
  if (newPassword !== confirmPassword) return { error: "Parolele nu coincid." };

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, role: true, isSuperAdmin: true } });
  if (!user) return { error: "Cod incorect sau expirat. Cere un cod nou." };

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
  if (current) {
    await logAudit(
      { id: current.id, name: current.name, role: current.role, isSuperAdmin: current.isSuperAdmin },
      { action: "auth.logout", module: "Auth" },
    );
  }
  await destroySession();
  redirect("/login");
}
