"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, isSuper, type CurrentUser } from "@/lib/dal";
import { can, ALL_PERMISSION_KEYS } from "@/lib/permissions";
import { hashPassword } from "@/lib/password";
import { DEMO } from "@/lib/demo";
import { logAudit } from "@/lib/services/audit";
import { NOTIFY_EVENT_KEYS } from "@/lib/notify-meta";

export type UserState = { ok?: boolean; error?: string; id?: string } | undefined;

const actor = (u: CurrentUser) => ({ id: u.id, name: u.name, role: u.role, isSuperAdmin: u.isSuperAdmin });
const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

function invalidate() {
  revalidatePath("/users");
  revalidateTag("users", "max");
}

function parsePerms(formData: FormData): string[] {
  return formData
    .getAll("permissions")
    .map(String)
    .filter((p) => (ALL_PERMISSION_KEYS as string[]).includes(p));
}

function parseNotifyEvents(formData: FormData): string[] {
  return formData
    .getAll("notifyEvents")
    .map(String)
    .filter((e) => NOTIFY_EVENT_KEYS.includes(e));
}

const NOTIFY_SCOPES = ["ALL", "TEAMS", "MEMBERS"];
function parseNotifyScope(formData: FormData): string {
  const v = String(formData.get("notifyScope") ?? "ALL");
  return NOTIFY_SCOPES.includes(v) ? v : "ALL";
}
function parseIdList(formData: FormData, key: string): string[] {
  return formData.getAll(key).map(String).filter(Boolean);
}

export async function createUser(
  _prev: UserState,
  formData: FormData,
): Promise<UserState> {
  const user = await requireUser();
  if (!can(user, "users.manage")) return { error: "Fără permisiune." };
  if (DEMO) return { error: "Mod demo: conectează o bază de date." };

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const role = formData.get("role") === "ADMIN" ? "ADMIN" : "STAFF";
  const isActive = formData.get("isActive") !== "off";

  if (name.length < 2) return { error: "Nume prea scurt." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Email invalid." };
  if (password.length < 8) return { error: "Parola: minim 8 caractere." };

  const exists = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (exists) return { error: "Există deja un cont cu acest email." };

  const created = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await hashPassword(password),
      role,
      isActive,
      permissions: role === "ADMIN" ? [] : parsePerms(formData),
      notifyEvents: parseNotifyEvents(formData),
      telegramChatId: String(formData.get("telegramChatId") ?? "").trim() || null,
      notifyScope: parseNotifyScope(formData),
      notifyTeamIds: parseIdList(formData, "notifyTeamIds"),
      notifyMemberIds: parseIdList(formData, "notifyMemberIds"),
    },
    select: { id: true },
  });
  await logAudit(actor(user), {
    action: "user.create",
    module: "Users",
    objectId: created.id,
    objectName: name,
    newValue: JSON.stringify({ role, isActive }),
  });
  invalidate();
  return { ok: true, id: created.id };
}

export async function updateUser(
  _prev: UserState,
  formData: FormData,
): Promise<UserState> {
  const admin = await requireUser();
  if (!can(admin, "users.manage")) return { error: "Fără permisiune." };
  if (DEMO) return { error: "Mod demo." };

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = formData.get("role") === "ADMIN" ? "ADMIN" : "STAFF";
  const isActive = formData.get("isActive") !== "off";
  const newPassword = String(formData.get("password") ?? "");
  if (name.length < 2) return { error: "Nume prea scurt." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Email invalid." };

  const [emailOwner, before] = await Promise.all([
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
    prisma.user.findUnique({
      where: { id },
      select: { name: true, role: true, isActive: true, permissions: true, notifyEvents: true },
    }),
  ]);
  if (emailOwner && emailOwner.id !== id) return { error: "Există deja un cont cu acest email." };

  // Nu îți poți retrage propriul rol de admin
  if (id === admin.id && admin.role === "ADMIN" && role === "STAFF") {
    return { error: "Nu îți poți retrage propriul rol de administrator." };
  }
  // Non-super nu poate modifica rolul unui alt administrator
  if (!isSuper(admin) && before?.role === "ADMIN" && role !== "ADMIN") {
    return { error: "Nu poți modifica rolul unui alt administrator." };
  }

  const newPerms = role === "ADMIN" ? [] : parsePerms(formData);
  const newNotify = parseNotifyEvents(formData);

  try {
    await prisma.user.update({
      where: { id },
      data: {
        name,
        email,
        role,
        isActive,
        permissions: newPerms,
        notifyEvents: newNotify,
        telegramChatId: String(formData.get("telegramChatId") ?? "").trim() || null,
        notifyScope: parseNotifyScope(formData),
        notifyTeamIds: parseIdList(formData, "notifyTeamIds"),
        notifyMemberIds: parseIdList(formData, "notifyMemberIds"),
        ...(newPassword.length >= 8 ? { passwordHash: await hashPassword(newPassword) } : {}),
      },
    });
  } catch (e) {
    // Concurență: alt request a luat emailul între verificarea de mai sus și acest update.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "Există deja un cont cu acest email." };
    }
    throw e;
  }

  const a = actor(admin);
  await logAudit(a, {
    action: "user.update",
    module: "Users",
    objectId: id,
    objectName: name,
    oldValue: before ? JSON.stringify({ role: before.role, isActive: before.isActive }) : null,
    newValue: JSON.stringify({ role, isActive }),
  });
  // Log dedicat la schimbarea permisiunilor
  if (before && !sameSet(before.permissions, newPerms)) {
    await logAudit(a, {
      action: "user.permissions_change",
      module: "Users",
      objectId: id,
      objectName: name,
      oldValue: before.permissions.join(", ") || "—",
      newValue: newPerms.join(", ") || "—",
    });
  }
  // Log dedicat la schimbarea setărilor de notificări
  if (before && !sameSet(before.notifyEvents, newNotify)) {
    await logAudit(a, {
      action: "notifications.settings_change",
      module: "Notifications",
      objectId: id,
      objectName: name,
      oldValue: before.notifyEvents.join(", ") || "—",
      newValue: newNotify.join(", ") || "—",
    });
  }
  invalidate();
  return { ok: true, id };
}

/** Dezactivare/reactivare rapidă. */
export async function toggleUserActive(id: string, active: boolean): Promise<void> {
  const admin = await requireUser();
  if (!can(admin, "users.manage")) return;
  if (DEMO) return;
  const target = await prisma.user.findUnique({ where: { id }, select: { name: true, role: true } });
  if (!isSuper(admin) && target?.role === "ADMIN") return;
  await prisma.user.update({ where: { id }, data: { isActive: active } });
  // La dezactivare, invalidează sesiunile
  if (!active) await prisma.session.deleteMany({ where: { userId: id } });
  await logAudit(actor(admin), {
    action: active ? "user.activate" : "user.deactivate",
    module: "Users",
    objectId: id,
    objectName: target?.name ?? null,
  });
  invalidate();
}

/** Ștergere definitivă utilizator (cu curățarea datelor legate). */
export async function deleteUser(id: string): Promise<UserState> {
  const admin = await requireUser();
  if (!can(admin, "users.manage")) return { error: "Fără permisiune." };
  if (DEMO) return { error: "Mod demo." };
  if (id === admin.id) return { error: "Nu te poți șterge pe tine." };

  const target = await prisma.user.findUnique({ where: { id }, select: { name: true, role: true } });
  if (!isSuper(admin) && target?.role === "ADMIN") {
    return { error: "Nu poți șterge un alt administrator." };
  }
  // Reasignează datele importante adminului (evităm pierderea task-urilor/proiectelor create)
  await prisma.task.updateMany({ where: { creatorId: id }, data: { creatorId: admin.id } });
  await prisma.project.updateMany({ where: { ownerId: id }, data: { ownerId: admin.id } });
  await prisma.task.updateMany({ where: { assigneeId: id }, data: { assigneeId: null } });
  await prisma.project.updateMany({ where: { assigneeId: id }, data: { assigneeId: null } });
  await prisma.session.deleteMany({ where: { userId: id } });
  await prisma.telegramAccount.deleteMany({ where: { userId: id } });
  await prisma.pushSubscription.deleteMany({ where: { userId: id } });
  try {
    await prisma.user.delete({ where: { id } });
  } catch {
    return { error: "Nu am putut șterge (are date legate). Dezactivează-l în schimb." };
  }
  await logAudit(actor(admin), {
    action: "user.delete",
    module: "Users",
    objectId: id,
    objectName: target?.name ?? null,
  });
  invalidate();
  return { ok: true };
}

/**
 * Acordă/retrage statutul de super-admin. Doar un super-admin poate.
 * Protecție: nu poate fi retras ultimul super-admin (evită blocarea totală).
 */
export async function setSuperAdmin(id: string, value: boolean): Promise<UserState> {
  const admin = await requireUser();
  if (!isSuper(admin)) return { error: "Doar un super-admin poate face asta." };
  if (DEMO) return { error: "Mod demo." };
  if (id === admin.id && !value) return { error: "Nu îți poți retrage propriul statut de super-admin." };

  const target = await prisma.user.findUnique({
    where: { id },
    select: { name: true, isSuperAdmin: true },
  });
  if (!target) return { error: "Utilizator inexistent." };
  if (target.isSuperAdmin === value) return { ok: true, id };

  if (!value) {
    const supers = await prisma.user.count({ where: { isSuperAdmin: true } });
    if (supers <= 1) return { error: "Nu poți retrage ultimul super-admin." };
  }

  await prisma.user.update({ where: { id }, data: { isSuperAdmin: value } });
  await logAudit(actor(admin), {
    action: "user.superadmin_change",
    module: "Users",
    objectId: id,
    objectName: target.name,
    oldValue: target.isSuperAdmin ? "super-admin" : "normal",
    newValue: value ? "super-admin" : "normal",
  });
  invalidate();
  return { ok: true, id };
}
