import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "../prisma";
import { DEMO } from "../demo";

export type TeamRow = {
  id: string;
  name: string;
  description: string | null;
  memberIds: string[];
  members: { id: string; name: string }[];
};

export async function listTeams(): Promise<TeamRow[]> {
  if (DEMO) return [];
  return prisma.team.findMany({
    select: {
      id: true,
      name: true,
      description: true,
      memberIds: true,
      members: { select: { id: true, name: true } },
    },
    orderBy: { name: "asc" },
  });
}

export const teamOptions = unstable_cache(
  async (): Promise<{ id: string; name: string }[]> => {
    if (DEMO) return [];
    return prisma.team.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  },
  ["team-options"],
  { tags: ["teams"], revalidate: 300 },
);

export async function getTeam(id: string): Promise<TeamRow | null> {
  if (DEMO) return null;
  return prisma.team.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      memberIds: true,
      members: { select: { id: true, name: true } },
    },
  });
}
