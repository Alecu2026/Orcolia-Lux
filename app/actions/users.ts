"use server";

import { revalidatePath, updateTag } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, isSuper, type CurrentUser } from "@/lib/dal";
import { can, ALL_PERMISSION_KEYS, PERMISSIONS_V2 } from "@/lib/permissions";
import { sanitizePreset } from "@/lib/table-look";
import { hashPassword } from "@/lib/password";
import { DEMO } from "@/lib/demo";
import { logAudit } from "@/lib/services/audit";
import { USER_SPEC, diffFields } from "@/lib/services/audit-diff";
import { invalidateSuperAdminCheck, otherActiveSuperAdmins } from "@/lib/services/super-admin";
import { NOTIFY_EVENT_KEYS } from "@/lib/notify-meta";

export type UserState = { ok?: boolean; error?: string; id?: string } | undefined;

const actor = (u: CurrentUser) => ({ id: u.id, name: u.name, role: u.role, isSuperAdmin: u.isSuperAdmin });
const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

function invalidate() {
  revalidatePath("/users");
  updateTag("users");
}

function parsePerms(formData: FormData): string[] {
  const perms = formData
    .getAll("permissions")
    .map(String)
    .filter((p) => (ALL_PERMISSION_KEYS as string[]).includes(p));
  // Marcajul spune că lista e cea nouă (pe pagini): de acum permisiunile sunt explicite, fără deducții din cele vechi.
  return [...new Set(perms), PERMISSIONS_V2];
}

function parseNotifyEvents(formData: FormData): string[] {
  return formData
    .getAll("notifyEvents")
    .map(String)
    .filter((e) => NOTIFY_EVENT_KEYS.includes(e));
}

/** Administrator în sens larg: rol ADMIN sau permisiunea „admin”. Doar ei pot crea/promova administratori (altfel un angajat cu „Gestionare utilizatori” și-ar putea acorda singur acces total). */
const isAdminLevel = (u: { role: string; permissions: string[] }) => u.role === "ADMIN" || u.permissions.includes("admin");

/** Telegram chat ID: număr (grupurile au id negativ). Gol = fără Telegram. */
function parseTelegram(formData: FormData): { value: string | null; error?: string } {
  const raw = String(formData.get("telegramChatId") ?? "").trim();
  if (!raw) return { value: null };
  if (!/^-?\d{5,15}$/.test(raw)) return { value: null, error: "Telegram chat ID invalid: doar cifre (ex. 123456789)." };
  return { value: raw };
}

const NOTIFY_SCOPES = ["ALL", "TEAMS", "MEMBERS"];
function parseNotifyScope(formData: FormData): string {
  const v = String(formData.get("notifyScope") ?? "ALL");
  return NOTIFY_SCOPES.includes(v) ? v : "ALL";
}
/** Id-uri de echipe/utilizatori: doar valori de forma ObjectId, fără dubluri — o valoare străină ar face update-ul să cadă. */
function parseIdList(formData: FormData, key: string): string[] {
  return [...new Set(formData.getAll(key).map(String).filter((v) => /^[a-f0-9]{24}$/i.test(v)))];
}

/** Aspectul tabelelor setat de administrator (JSON din formular) → obiect curățat (gol = implicit). */
function parseTableLook(formData: FormData): Prisma.InputJsonValue {
  try {
    return sanitizePreset(JSON.parse(String(formData.get("tableLook") ?? "{}"))) as Prisma.InputJsonValue;
  } catch {
    return {};
  }
}

const TASK_VIEW_SCOPES = ["ALL", "RESTRICTED"];
function parseTaskViewScope(formData: FormData): string {
  const v = String(formData.get("taskViewScope") ?? "ALL");
  return TASK_VIEW_SCOPES.includes(v) ? v : "ALL";
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
  // O bifă nebifată nu trimite nimic în formular: „activ” înseamnă exact valoarea „on”, nu „orice în afară de off”.
  const isActive = formData.get("isActive") === "on";

  if (name.length < 2) return { error: "Nume prea scurt." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Email invalid." };
  if (password.length < 8) return { error: "Parola: minim 8 caractere." };
  const telegram = parseTelegram(formData);
  if (telegram.error) return { error: telegram.error };
  if (role === "ADMIN" && !isAdminLevel(user)) return { error: "Doar un administrator poate crea alt administrator." };
  if (role === "STAFF" && parsePerms(formData).includes("admin") && !isAdminLevel(user)) {
    return { error: "Doar un administrator poate acorda acces administrativ." };
  }

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
      telegramChatId: telegram.value,
      notifyScope: parseNotifyScope(formData),
      notifyTeamIds: parseIdList(formData, "notifyTeamIds"),
      notifyMemberIds: parseIdList(formData, "notifyMemberIds"),
      taskViewScope: parseTaskViewScope(formData),
      tableLook: parseTableLook(formData),
      taskViewTeamIds: parseIdList(formData, "taskViewTeamIds"),
      taskViewMemberIds: parseIdList(formData, "taskViewMemberIds"),
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
  // Un câmp „rol” dezactivat în formular nu se trimite deloc: atunci păstrăm rolul de acum (altfel ar părea retrogradare în STAFF).
  const roleRaw = formData.get("role");
  let role: "ADMIN" | "STAFF" = roleRaw === "ADMIN" ? "ADMIN" : "STAFF";
  const isActive = formData.get("isActive") === "on";
  const newPassword = String(formData.get("password") ?? "");
  if (name.length < 2) return { error: "Nume prea scurt." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Email invalid." };
  if (newPassword !== "" && newPassword.length < 8) return { error: "Parola nouă: minim 8 caractere (sau lasă gol ca să rămână neschimbată)." };
  const telegram = parseTelegram(formData);
  if (telegram.error) return { error: telegram.error };

  const [emailOwner, before] = await Promise.all([
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
    prisma.user.findUnique({
      where: { id },
      select: { name: true, email: true, role: true, isActive: true, isSuperAdmin: true, permissions: true, notifyEvents: true },
    }),
  ]);
  if (emailOwner && emailOwner.id !== id) return { error: "Există deja un cont cu acest email." };
  if (!before) return { error: "Utilizator inexistent." };
  if (roleRaw !== "ADMIN" && roleRaw !== "STAFF") role = before.role;

  // Doar un administrator poate umbla la conturile administrative sau le poate crea (nu un angajat cu „Gestionare utilizatori”).
  if (!isAdminLevel(admin)) {
    if (before.role === "ADMIN" || before.permissions.includes("admin")) return { error: "Doar un administrator poate modifica un administrator." };
    if (role === "ADMIN") return { error: "Doar un administrator poate crea alt administrator." };
    if (parsePerms(formData).includes("admin")) return { error: "Doar un administrator poate acorda acces administrativ." };
  }
  if (id === admin.id && !isActive) return { error: "Nu te poți dezactiva pe tine." };

  // Un super-admin rămâne mereu administrator, iar un non-super nu poate umbla la un super-admin.
  if (before.isSuperAdmin && !isSuper(admin)) return { error: "Doar un super-admin poate modifica un alt super-admin." };
  if (before.isSuperAdmin) {
    if (!isActive) return { error: "Un super-admin nu poate fi dezactivat. Retrage-i mai întâi statutul de super-admin." };
    role = "ADMIN";
  }

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
        telegramChatId: telegram.value,
        notifyScope: parseNotifyScope(formData),
        notifyTeamIds: parseIdList(formData, "notifyTeamIds"),
        notifyMemberIds: parseIdList(formData, "notifyMemberIds"),
        taskViewScope: parseTaskViewScope(formData),
        tableLook: parseTableLook(formData),
        taskViewTeamIds: parseIdList(formData, "taskViewTeamIds"),
        taskViewMemberIds: parseIdList(formData, "taskViewMemberIds"),
        ...(newPassword.length >= 8 ? { passwordHash: await hashPassword(newPassword) } : {}),
      },
    });
    // Cont dezactivat sau parolă schimbată: sesiunile existente nu mai trebuie să funcționeze.
    if ((!isActive && before.isActive) || newPassword.length >= 8) {
      if (id !== admin.id) await prisma.session.deleteMany({ where: { userId: id } });
    }
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
    details: before
      ? {
          changes: diffFields(before, { name, email, role, isActive }, USER_SPEC),
          extra: newPassword.length >= 8 ? [{ label: "Parolă", value: "schimbată de administrator" }] : undefined,
        }
      : null,
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
  const target = await prisma.user.findUnique({ where: { id }, select: { name: true, role: true, isSuperAdmin: true } });
  if (!isSuper(admin) && (target?.role === "ADMIN" || target?.isSuperAdmin)) return;
  // Nu dezactiva ultimul super-admin activ (sistemul ar rămâne fără super-admin).
  if (!active && target?.isSuperAdmin && (await otherActiveSuperAdmins(id)) === 0) return;
  await prisma.user.update({ where: { id }, data: { isActive: active } });
  invalidateSuperAdminCheck();
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

  const target = await prisma.user.findUnique({ where: { id }, select: { name: true, role: true, isSuperAdmin: true } });
  if (!isSuper(admin) && (target?.role === "ADMIN" || target?.isSuperAdmin)) {
    return { error: "Nu poți șterge un alt administrator." };
  }
  if (target?.isSuperAdmin && (await otherActiveSuperAdmins(id)) === 0) {
    return { error: "Nu poți șterge ultimul super-admin." };
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
    if ((await otherActiveSuperAdmins(id)) === 0) return { error: "Nu poți retrage ultimul super-admin." };
  }

  // Super-admin implică administrator: un STAFF cu isSuperAdmin ar avea Audit Logs, dar nu și restul.
  await prisma.user.update({ where: { id }, data: value ? { isSuperAdmin: true, role: "ADMIN", permissions: [] } : { isSuperAdmin: false } });
  invalidateSuperAdminCheck();
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
