"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/password";
import { createSession, destroySession } from "@/lib/session";
import { loginSchema } from "@/lib/validation";
import { ensureDefaultCategories } from "@/lib/queries/categories";
import { getSettings } from "@/lib/queries/settings";
import { getCurrentUser } from "@/lib/dal";
import { logAudit } from "@/lib/services/audit";
import { DEMO } from "@/lib/demo";

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
    },
    select: { id: true },
  });

  await getSettings(user.id); // creează setările default
  await ensureDefaultCategories(user.id);
  await createSession(user.id, await requestMeta());
  redirect("/dashboard");
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
