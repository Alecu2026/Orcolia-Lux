import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import type { PortalTemplate } from "../portal-template";

/** Șabloanele de cereri pentru clienți, în ordinea aleasă de administrator (apoi alfabetic). */
export async function listPortalTemplates(): Promise<PortalTemplate[]> {
  if (DEMO) return [];
  const rows = await prisma.portalRequestTemplate.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    take: 100,
    select: { id: true, name: true, title: true, description: true },
  });
  return rows;
}
