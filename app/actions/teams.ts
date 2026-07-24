"use server";

import { revalidatePath, updateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { DEMO } from "@/lib/demo";

export type TeamState = { ok?: boolean; error?: string; id?: string } | undefined;

export async function createTeam(
  _prev: TeamState,
  formData: FormData,
): Promise<TeamState> {
  const user = await requireUser();
  if (!can(user, "teams.manage")) return { error: "Fără permisiune." };
  if (DEMO) return { error: "Mod demo." };
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Numele echipei e obligatoriu." };
  const memberIds = formData.getAll("memberIds").map(String).filter(Boolean);

  const team = await prisma.team.create({
    data: {
      name,
      description: String(formData.get("description") ?? "").trim() || null,
      members: { connect: memberIds.map((id) => ({ id })) },
    },
    select: { id: true },
  });
  revalidatePath("/team");
  updateTag("teams");
  return { ok: true, id: team.id };
}

export async function updateTeam(
  _prev: TeamState,
  formData: FormData,
): Promise<TeamState> {
  const user = await requireUser();
  if (!can(user, "teams.manage")) return { error: "Fără permisiune." };
  if (DEMO) return { error: "Mod demo." };
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Numele echipei e obligatoriu." };
  const memberIds = formData.getAll("memberIds").map(String).filter(Boolean);

  await prisma.team.update({
    where: { id },
    data: {
      name,
      description: String(formData.get("description") ?? "").trim() || null,
      members: { set: memberIds.map((mid) => ({ id: mid })) },
    },
  });
  revalidatePath("/team");
  updateTag("teams");
  return { ok: true, id };
}

export async function deleteTeam(id: string): Promise<void> {
  const user = await requireUser();
  if (!can(user, "teams.manage")) return;
  if (DEMO) return;
  await prisma.task.updateMany({ where: { teamId: id }, data: { teamId: null } });
  await prisma.team.delete({ where: { id } }).catch(() => {});
  revalidatePath("/team");
  updateTag("teams");
}
