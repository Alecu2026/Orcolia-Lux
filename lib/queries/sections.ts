import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "../prisma";
import { DEMO } from "../demo";

export type SectionRow = {
  id: string;
  name: string;
  description: string | null;
};

/** Toate secțiile (listă mică, se schimbă rar): pagina Echipe / Secții, filtre, formulare. Memorie cross-request, golită la orice modificare (tag „sections”). */
export const listSections = unstable_cache(
  async (): Promise<SectionRow[]> => {
    if (DEMO) return [];
    return prisma.section.findMany({ select: { id: true, name: true, description: true }, orderBy: { name: "asc" } });
  },
  ["section-list"],
  { tags: ["sections"], revalidate: 300 },
);

export async function sectionOptions(): Promise<{ id: string; name: string }[]> {
  return (await listSections()).map((s) => ({ id: s.id, name: s.name }));
}

/** Echipa → secția ei, și persoana → secția ei (pentru completarea automată a secției și pentru filtre). Din baza de date, scurt în memorie. */
export const sectionMaps = unstable_cache(
  async (): Promise<{ teamSection: Record<string, string>; userSection: Record<string, string> }> => {
    if (DEMO) return { teamSection: {}, userSection: {} };
    const [teams, users] = await Promise.all([
      prisma.team.findMany({ where: { sectionId: { not: null } }, select: { id: true, sectionId: true } }),
      prisma.user.findMany({ where: { sectionId: { not: null } }, select: { id: true, sectionId: true } }),
    ]);
    return {
      teamSection: Object.fromEntries(teams.map((t) => [t.id, t.sectionId as string])),
      userSection: Object.fromEntries(users.map((u) => [u.id, u.sectionId as string])),
    };
  },
  ["section-maps"],
  { tags: ["sections", "teams", "users"], revalidate: 300 },
);
