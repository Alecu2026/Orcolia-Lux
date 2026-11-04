"use server";

import { revalidatePath, updateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { DEMO } from "@/lib/demo";

export type SectionState = { ok?: boolean; error?: string; id?: string } | undefined;

const ID_RE = /^[0-9a-f]{24}$/i;

function refresh() {
  revalidatePath("/team");
  for (const tag of ["sections", "teams", "users"]) updateTag(tag);
}

/** Secție nouă / modificată: nume, descriere și echipele care fac parte din ea (o echipă e în cel mult o secție, deci cele bifate aici o părăsesc pe cea veche). */
async function save(formData: FormData, id: string | null): Promise<SectionState> {
  const user = await requireUser();
  if (!can(user, "teams.manage")) return { error: "Fără permisiune." };
  if (DEMO) return { error: "Mod demo." };
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  if (!name) return { error: "Numele secției e obligatoriu." };
  const description = String(formData.get("description") ?? "").trim().slice(0, 500) || null;
  const teamIds = formData.getAll("teamIds").map(String).filter((x) => ID_RE.test(x));

  try {
    const sectionId = id
      ? (await prisma.section.update({ where: { id }, data: { name, description }, select: { id: true } })).id
      : (await prisma.section.create({ data: { name, description }, select: { id: true } })).id;
    if (id) await prisma.team.updateMany({ where: { sectionId: id, id: { notIn: teamIds } }, data: { sectionId: null } });
    if (teamIds.length) await prisma.team.updateMany({ where: { id: { in: teamIds } }, data: { sectionId } });
    refresh();
    return { ok: true, id: sectionId };
  } catch (e) {
    console.error("[sections] salvare eșuată:", e);
    refresh();
    return { error: "Secția nu a putut fi salvată (poate a fost ștearsă între timp)." };
  }
}

export async function createSection(_prev: SectionState, formData: FormData): Promise<SectionState> {
  return save(formData, null);
}

export async function updateSection(_prev: SectionState, formData: FormData): Promise<SectionState> {
  const id = String(formData.get("id") ?? "");
  if (!ID_RE.test(id)) return { error: "Secție invalidă." };
  return save(formData, id);
}

/** Ștergerea unei secții: echipele, persoanele și cererile ei rămân, doar fără secție. */
export async function deleteSection(id: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!can(user, "teams.manage")) return { ok: false, error: "Fără permisiune." };
  if (DEMO) return { ok: false, error: "Mod demo." };
  if (!ID_RE.test(id)) return { ok: false, error: "Secție invalidă." };
  await Promise.all([
    prisma.team.updateMany({ where: { sectionId: id }, data: { sectionId: null } }),
    prisma.user.updateMany({ where: { sectionId: id }, data: { sectionId: null } }),
    prisma.task.updateMany({ where: { sectionId: id }, data: { sectionId: null } }),
  ]);
  await prisma.section.delete({ where: { id } }).catch(() => {});
  refresh();
  return { ok: true };
}

/** Mută o echipă într-o secție (sau o scoate din secție, cu `sectionId` gol) dintr-un singur pas, fără dialog. */
export async function setTeamSection(teamId: string, sectionId: string | null): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!can(user, "teams.manage")) return { ok: false, error: "Fără permisiune." };
  if (DEMO) return { ok: false, error: "Mod demo." };
  if (!ID_RE.test(teamId)) return { ok: false, error: "Echipă invalidă." };
  if (sectionId && !(ID_RE.test(sectionId) && (await prisma.section.findUnique({ where: { id: sectionId }, select: { id: true } }).catch(() => null)))) {
    return { ok: false, error: "Secția nu există." };
  }
  await prisma.team.update({ where: { id: teamId }, data: { sectionId: sectionId || null } });
  refresh();
  return { ok: true };
}
