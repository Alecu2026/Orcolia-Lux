"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { DEMO } from "@/lib/demo";
import { USER_TYPES } from "@/lib/permissions";
import { listRoleTemplates } from "@/lib/queries/role-templates";
import {
  ROLE_TEMPLATE_MAX,
  ROLE_TEMPLATE_MAX_DESCRIPTION,
  ROLE_TEMPLATE_MAX_NAME,
  cleanPermissions,
  isTaskView,
  type RoleTemplate,
} from "@/lib/role-templates";

/** Șabloane de roluri: se gestionează cu „Gestionare utilizatori”. Un șablon doar completează formularul de utilizator; conturile existente nu se modifică. */

export type RoleTemplateResult = { ok: true; templates: RoleTemplate[] } | { ok: false; error: string };

const BUILTIN_KEYS = USER_TYPES.map((u) => u.key as string);
const str = (v: unknown) => (typeof v === "string" ? v : "");

async function guard() {
  const user = await requireUser();
  if (!can(user, "users.manage")) return { ok: false as const, error: "Fără permisiune." };
  if (DEMO) return { ok: false as const, error: "Mod demo: conectează o bază de date." };
  return { ok: true as const, user };
}

/**
 * Creează (fără `key`) sau modifică (cu `key`) un șablon. Pentru un tip implicit se salvează o suprascriere (nume, descriere, rol, permisiuni).
 * Rolul „Administrator” într-un șablon îl poate seta doar un administrator.
 */
export async function saveRoleTemplateAction(input: { key?: string; name: string; description: string; role: string; permissions: string[]; taskView: string }): Promise<RoleTemplateResult> {
  try {
    const g = await guard();
    if (!g.ok) return g;
    const name = str(input?.name).replace(/\s+/g, " ").trim();
    const description = str(input?.description).trim();
    if (!name) return { ok: false, error: "Dă un nume șablonului." };
    if (name.length > ROLE_TEMPLATE_MAX_NAME) return { ok: false, error: `Numele depășește ${ROLE_TEMPLATE_MAX_NAME} de caractere.` };
    if (description.length > ROLE_TEMPLATE_MAX_DESCRIPTION) return { ok: false, error: "Descrierea e prea lungă." };
    const role = input?.role === "ADMIN" ? "ADMIN" : "STAFF";
    if (role === "ADMIN" && g.user.role !== "ADMIN") return { ok: false, error: "Doar un administrator poate crea un șablon de tip Administrator." };
    const taskView = isTaskView(input?.taskView) ? input.taskView : "";
    const permissions = role === "ADMIN" ? [] : cleanPermissions(input?.permissions);
    if (role === "STAFF" && permissions.length === 0) return { ok: false, error: "Bifează cel puțin o permisiune (sau alege rolul Administrator)." };

    const data = { name, description: description || null, role, permissions, taskView: taskView || null };
    const key = str(input?.key);
    if (key) {
      const isBuiltin = BUILTIN_KEYS.includes(key);
      if (!isBuiltin && !/^[0-9a-f]{24}$/i.test(key)) return { ok: false, error: "Șablon invalid." };
      if (isBuiltin) {
        await prisma.roleTemplate.upsert({ where: { key }, create: { key, ...data, createdById: g.user.id }, update: data });
      } else {
        const done = await prisma.roleTemplate.updateMany({ where: { key }, data });
        if (done.count === 0) return { ok: false, error: "Șablonul nu mai există." };
      }
    } else {
      if ((await prisma.roleTemplate.count({ where: { key: { notIn: BUILTIN_KEYS } } })) >= ROLE_TEMPLATE_MAX) return { ok: false, error: `Maximum ${ROLE_TEMPLATE_MAX} de șabloane.` };
      // cheia unui șablon propriu = un id generat (aceeași formă ca un ObjectId, ca să nu poată intra în conflict cu cheile implicite)
      const id = Array.from({ length: 24 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
      await prisma.roleTemplate.create({ data: { key: id, ...data, createdById: g.user.id } });
    }
    revalidatePath("/users");
    return { ok: true, templates: await listRoleTemplates() };
  } catch (e) {
    console.error("[role-templates] salvare eșuată", e);
    return { ok: false, error: "Nu am putut salva șablonul." };
  }
}

/** Șterge un șablon propriu; la un tip implicit revine la valorile originale (șterge modificările). */
export async function deleteRoleTemplateAction(key: string): Promise<RoleTemplateResult> {
  try {
    const g = await guard();
    if (!g.ok) return g;
    if (!BUILTIN_KEYS.includes(key) && !/^[0-9a-f]{24}$/i.test(key ?? "")) return { ok: false, error: "Șablon invalid." };
    await prisma.roleTemplate.deleteMany({ where: { key } });
    revalidatePath("/users");
    return { ok: true, templates: await listRoleTemplates() };
  } catch (e) {
    console.error("[role-templates] ștergere eșuată", e);
    return { ok: false, error: "Nu am putut șterge șablonul." };
  }
}
