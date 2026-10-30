import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import type { PortalTemplate } from "../portal-template";
import { getCachedTemplates, invalidatePortalTemplates as invalidateShared, putCachedTemplates } from "../portal-cache";

/** Șabloanele de cereri pentru clienți, în ordinea aleasă de administrator (apoi alfabetic). */
/** Golește lista ținută în memorie (după ce un administrator creează / modifică / șterge un șablon). Starea e comună în proces (lib/portal-cache.ts). */
export const invalidatePortalTemplates = invalidateShared;

export async function listPortalTemplates(): Promise<PortalTemplate[]> {
  if (DEMO) return [];
  const hit = getCachedTemplates<PortalTemplate[]>();
  if (hit) return hit;
  const rows = await prisma.portalRequestTemplate.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    take: 100,
    select: { id: true, name: true, title: true, description: true, teamId: true },
  });
  putCachedTemplates(rows); // golit la orice modificare de șablon (invalidatePortalTemplates)
  return rows;
}
