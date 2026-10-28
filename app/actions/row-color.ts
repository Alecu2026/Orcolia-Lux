"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { DEMO } from "@/lib/demo";
import { asHex } from "@/lib/table-look";

/**
 * Culoarea unui rând în liste (sarcini, cereri, programări): se salvează în baza de date (câmpul `color` al sarcinii / programării), deci o văd toți cei care văd rândul și rămâne la
 * reîncărcare, pe orice dispozitiv. Pentru sarcini intră și în lista din cache (vezi lib/task-dataset.ts). `null` = fără culoare.
 * Sarcini / cereri: permisiunea „Editare”; programări: „Gestionare programări” (și doar ale tale).
 */
type Res = { ok?: boolean; error?: string };
const OID = /^[0-9a-f]{24}$/i;

function parseColor(color: string | null): { ok: true; value: string | null } | { ok: false } {
  if (color === null || color === "") return { ok: true, value: null };
  const h = asHex(color);
  return h ? { ok: true, value: h } : { ok: false };
}

export async function setTaskColorAction(id: string, color: string | null): Promise<Res> {
  const user = await requireUser();
  if (DEMO) return { error: "Mod demo." };
  if (!can(user, "tasks.edit")) return { error: "Nu ai permisiunea de editare." };
  if (!OID.test(id ?? "")) return { error: "ID sarcină invalidă." };
  const c = parseColor(color);
  if (!c.ok) return { error: "Culoare invalidă." };
  const upd = await prisma.task.updateMany({ where: { id }, data: { color: c.value } });
  if (upd.count === 0) return { error: "Sarcină inexistentă." };
  for (const p of ["/tasks", "/tickets", "/kanban"]) revalidatePath(p);
  return { ok: true };
}

export async function setAppointmentColorAction(id: string, color: string | null): Promise<Res> {
  const user = await requireUser();
  if (DEMO) return { error: "Mod demo." };
  if (!can(user, "appointments.manage")) return { error: "Fără permisiune." };
  if (!OID.test(id ?? "")) return { error: "Programare invalidă." };
  const c = parseColor(color);
  if (!c.ok) return { error: "Culoare invalidă." };
  const upd = await prisma.appointment.updateMany({ where: { id, OR: [{ userId: user.id }, { assigneeId: user.id }] }, data: { color: c.value } });
  if (upd.count === 0) return { error: "Programare inexistentă." };
  revalidatePath("/appointments");
  return { ok: true };
}
