"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, type CurrentUser } from "@/lib/dal";
import { hashPassword } from "@/lib/password";
import { DEMO } from "@/lib/demo";
import { logAudit } from "@/lib/services/audit";
import { createVerificationCode, consumeVerificationCode } from "@/lib/services/verification-codes";
import { sendVerificationCodeEmail } from "@/lib/email";
import { getSessionToken, hashToken } from "@/lib/session";

export type ProfileState = { ok?: boolean; error?: string } | undefined;

const actor = (u: CurrentUser) => ({ id: u.id, name: u.name, role: u.role, isSuperAdmin: u.isSuperAdmin });

/** Actualizează nume/email/Telegram ale contului propriu — nu necesită cod (doar parola cere confirmare). */
export async function updateMyProfile(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const user = await requireUser();
  if (DEMO) return { error: "Mod demo: conectează o bază de date." };

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const telegramChatId = String(formData.get("telegramChatId") ?? "").trim() || null;

  if (name.length < 2) return { error: "Numele e prea scurt." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Email invalid." };

  const emailOwner = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (emailOwner && emailOwner.id !== user.id) return { error: "Există deja un cont cu acest email." };

  await prisma.user.update({
    where: { id: user.id },
    data: { name, email, telegramChatId },
  });

  await logAudit(actor(user), {
    action: "user.update_profile",
    module: "Users",
    objectId: user.id,
    objectName: name,
  });

  revalidatePath("/settings");
  return { ok: true };
}

/** Pasul 1: trimite un cod de 6 cifre pe emailul propriu, pentru confirmarea schimbării parolei. */
export async function requestMyPasswordChangeCode(): Promise<ProfileState> {
  const user = await requireUser();
  if (DEMO) return { error: "Mod demo: conectează o bază de date." };

  const code = await createVerificationCode(user.id, "PASSWORD_CHANGE");
  try {
    await sendVerificationCodeEmail({
      to: user.email,
      name: user.name,
      code,
      purpose: "PASSWORD_CHANGE",
    });
  } catch (e) {
    console.error("[profile] eșec trimitere cod schimbare parolă:", e);
    return { error: "Nu am putut trimite codul pe email. Verifică setările SMTP." };
  }
  return { ok: true };
}

/** Pasul 2: confirmă codul primit pe email și setează noua parolă. */
export async function confirmMyPasswordChange(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const user = await requireUser();
  if (DEMO) return { error: "Mod demo." };

  const code = String(formData.get("code") ?? "").trim();
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!/^\d{6}$/.test(code)) return { error: "Cod invalid — introdu cele 6 cifre primite pe email." };
  if (newPassword.length < 8) return { error: "Parola: minim 8 caractere." };
  if (newPassword !== confirmPassword) return { error: "Parolele nu coincid." };

  const valid = await consumeVerificationCode(user.id, "PASSWORD_CHANGE", code);
  if (!valid) return { error: "Cod incorect sau expirat. Cere un cod nou." };

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

  // Păstrează doar sesiunea curentă activă; deloghează celelalte dispozitive.
  const currentToken = await getSessionToken();
  await prisma.session.deleteMany({
    where: {
      userId: user.id,
      ...(currentToken ? { tokenHash: { not: hashToken(currentToken) } } : {}),
    },
  });

  await logAudit(actor(user), {
    action: "user.password_change",
    module: "Users",
    objectId: user.id,
    objectName: user.name,
  });

  return { ok: true };
}
