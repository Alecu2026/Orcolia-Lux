import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { lookupEpoch } from "../lookup-memory";

export type TeamRow = {
  id: string;
  name: string;
  description: string | null;
  /** Secția echipei (Section); null = fără secție. */
  sectionId: string | null;
  memberIds: string[];
  members: { id: string; name: string }[];
};

/**
 * Echipele cu membrii lor (Prisma aduce membrii printr-o a doua interogare, deci două drumuri la rând către baza de date la fiecare vizită). Lista e mică și se schimbă rar, așa că stă în memoria
 * procesului până la prima scriere pe Team / User (epoca din lib/lookup-memory.ts, schimbată de extensia Prisma) — cel mult `MAX_AGE_MS`, pentru scrieri făcute în alt proces.
 */
const MAX_AGE_MS = 60_000;
const g = globalThis as unknown as { __teamList?: { epoch: number; at: number; value: TeamRow[] }; __teamListP?: Promise<TeamRow[]> };

export async function listTeams(): Promise<TeamRow[]> {
  if (DEMO) return [];
  const hit = g.__teamList;
  if (hit && hit.epoch === lookupEpoch() && Date.now() - hit.at < MAX_AGE_MS) return hit.value;
  if (!g.__teamListP) {
    const epoch = lookupEpoch();
    g.__teamListP = loadTeams()
      .then((value) => {
        g.__teamList = { epoch, at: Date.now(), value };
        return value;
      })
      .finally(() => {
        g.__teamListP = undefined;
      });
  }
  return g.__teamListP;
}

async function loadTeams(): Promise<TeamRow[]> {
  return prisma.team.findMany({
    select: {
      id: true,
      name: true,
      description: true,
      sectionId: true,
      memberIds: true,
      members: { select: { id: true, name: true } },
    },
    orderBy: { name: "asc" },
  });
}

export const teamOptions = unstable_cache(
  async (): Promise<{ id: string; name: string; sectionId: string | null }[]> => {
    if (DEMO) return [];
    return prisma.team.findMany({
      select: { id: true, name: true, sectionId: true },
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
      sectionId: true,
      memberIds: true,
      members: { select: { id: true, name: true } },
    },
  });
}
