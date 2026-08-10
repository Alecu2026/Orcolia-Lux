"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/password";
import { createClientSession, destroyClientSession } from "@/lib/client-session";
import { getCurrentClient } from "@/lib/client-dal";
import {
  createClientVerificationCode,
  consumeClientVerificationCode,
} from "@/lib/services/client-verification-codes";
import { sendVerificationCodeEmail } from "@/lib/email";
import { generateFirstApaCanalInvoice } from "@/lib/services/portal-invoices";

export type ClientAuthState = { error?: string } | undefined;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function requestMeta() {
  const h = await headers();
  return {
    userAgent: h.get("user-agent"),
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  };
}

/** Pasul 1 al înregistrării: verifică seria contorului, trimite codul pe emailul introdus. */
export async function requestClientRegistration(
  _prev: ClientAuthState,
  formData: FormData,
): Promise<ClientAuthState> {
  const meterSeries = String(formData.get("meterSeries") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!meterSeries) return { error: "Introdu seria contorului." };
  if (!EMAIL_RE.test(email)) return { error: "Email invalid." };

  const client = await prisma.client.findUnique({
    where: { meterSeries },
    select: { id: true, name: true, portalPasswordHash: true },
  });
  if (!client) return { error: "Serie contor negăsită. Verifică numărul de pe factură." };
  if (client.portalPasswordHash) {
    return { error: "Acest cont e deja activat. Folosește autentificarea sau „Am uitat parola”." };
  }

  const emailTaken = await prisma.client.findFirst({
    where: { email, portalPasswordHash: { not: null }, id: { not: client.id } },
    select: { id: true },
  });
  if (emailTaken) return { error: "Acest email e deja folosit de alt cont." };

  const code = await createClientVerificationCode(client.id, "REGISTRATION");
  try {
    await sendVerificationCodeEmail({ to: email, name: client.name, code, purpose: "CLIENT_REGISTRATION" });
  } catch (e) {
    console.error("[client-auth] eșec trimitere cod activare:", e);
    return { error: "Trimiterea emailului a eșuat. Verifică adresa sau încearcă din nou." };
  }
  redirect(
    `/portal/register?meterSeries=${encodeURIComponent(meterSeries)}&email=${encodeURIComponent(email)}&sent=1`,
  );
}

/** Pasul 2 al înregistrării: confirmă codul, setează emailul + parola, autentifică. */
export async function confirmClientRegistration(
  _prev: ClientAuthState,
  formData: FormData,
): Promise<ClientAuthState> {
  const meterSeries = String(formData.get("meterSeries") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const code = String(formData.get("code") ?? "").trim();
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!/^\d{6}$/.test(code)) return { error: "Cod invalid — introdu cele 6 cifre primite pe email." };
  if (newPassword.length < 8) return { error: "Parola: minim 8 caractere." };
  if (newPassword !== confirmPassword) return { error: "Parolele nu coincid." };

  const client = await prisma.client.findUnique({
    where: { meterSeries },
    select: { id: true, portalPasswordHash: true },
  });
  if (!client) return { error: "Cod incorect sau expirat. Cere un cod nou." };
  if (client.portalPasswordHash) {
    return { error: "Acest cont e deja activat. Folosește autentificarea." };
  }

  const valid = await consumeClientVerificationCode(client.id, "REGISTRATION", code);
  if (!valid) return { error: "Cod incorect sau expirat. Cere un cod nou." };

  const portalPasswordHash = await hashPassword(newPassword);
  const now = new Date();
  await prisma.client.update({
    where: { id: client.id },
    data: { email, portalPasswordHash, portalActivatedAt: now, portalLastLoginAt: now },
  });

  // Best-effort — dacă generarea eșuează, activarea contului tot reușește; clientul poate
  // primi factura ulterior, manual, din partea staff-ului.
  try {
    await generateFirstApaCanalInvoice(client.id);
  } catch (e) {
    console.error("[client-auth] eșec generare primă factură la activare:", e);
  }

  await createClientSession(client.id, await requestMeta());
  redirect("/portal");
}

export async function clientLogin(
  _prev: ClientAuthState,
  formData: FormData,
): Promise<ClientAuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!EMAIL_RE.test(email)) return { error: "Email sau parolă invalide." };

  const client = await prisma.client.findFirst({
    where: { email, portalPasswordHash: { not: null } },
    select: { id: true, portalPasswordHash: true },
  });
  if (!client?.portalPasswordHash) return { error: "Email sau parolă greșite." };

  const ok = await verifyPassword(password, client.portalPasswordHash);
  if (!ok) return { error: "Email sau parolă greșite." };

  await prisma.client.update({ where: { id: client.id }, data: { portalLastLoginAt: new Date() } });
  await createClientSession(client.id, await requestMeta());
  redirect("/portal");
}

/** Cerere de resetare parolă uitată (neautentificat). */
export async function requestClientPasswordReset(
  _prev: ClientAuthState,
  formData: FormData,
): Promise<ClientAuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { error: "Email invalid." };

  const client = await prisma.client.findFirst({
    where: { email, portalPasswordHash: { not: null } },
    select: { id: true, name: true },
  });
  if (!client) return { error: "Nu există niciun cont activat cu acest email." };

  const code = await createClientVerificationCode(client.id, "PASSWORD_RESET");
  try {
    await sendVerificationCodeEmail({ to: email, name: client.name, code, purpose: "CLIENT_PASSWORD_RESET" });
  } catch (e) {
    console.error("[client-auth] eșec trimitere cod resetare parolă:", e);
    return { error: "Contul există, dar trimiterea emailului a eșuat." };
  }
  redirect(`/portal/reset-password?email=${encodeURIComponent(email)}&sent=1`);
}

/** Confirmă codul primit pe email și setează parola nouă. */
export async function resetClientPasswordWithCode(
  _prev: ClientAuthState,
  formData: FormData,
): Promise<ClientAuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const code = String(formData.get("code") ?? "").trim();
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!/^\d{6}$/.test(code)) return { error: "Cod invalid — introdu cele 6 cifre primite pe email." };
  if (newPassword.length < 8) return { error: "Parola: minim 8 caractere." };
  if (newPassword !== confirmPassword) return { error: "Parolele nu coincid." };

  const client = await prisma.client.findFirst({
    where: { email, portalPasswordHash: { not: null } },
    select: { id: true },
  });
  if (!client) return { error: "Cod incorect sau expirat. Cere un cod nou." };

  const valid = await consumeClientVerificationCode(client.id, "PASSWORD_RESET", code);
  if (!valid) return { error: "Cod incorect sau expirat. Cere un cod nou." };

  const portalPasswordHash = await hashPassword(newPassword);
  await prisma.client.update({ where: { id: client.id }, data: { portalPasswordHash } });
  await prisma.clientSession.deleteMany({ where: { clientId: client.id } }); // deloghează toate dispozitivele

  redirect("/portal/login?reset=1");
}

export async function clientLogout(): Promise<void> {
  const current = await getCurrentClient();
  if (current) {
    await destroyClientSession();
  }
  redirect("/portal/login");
}
