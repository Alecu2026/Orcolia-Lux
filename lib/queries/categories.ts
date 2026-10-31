import "server-only";
import { cache } from "react";
import { prisma } from "../prisma";
import { DEMO, demoCategories } from "../demo";
import { lookupEpoch } from "../lookup-memory";

export type CategoryLite = {
  id: string;
  name: string;
  color: string;
  defaultDurationMinutes: number;
};

/**
 * Lista tuturor categoriilor din organizație (select minimal). Cache per-request + în memoria procesului ~60 s; se golește imediat la orice scriere pe Category
 * (lib/lookup-memory.ts, extensia Prisma) — înainte fiecare pagină de detaliu o citea din baza de date.
 */
const CATEGORY_TTL_MS = 60_000;
const cg = globalThis as unknown as { __categoryList?: { at: number; v: CategoryLite[] } };
export const listCategories = cache(
  async (): Promise<CategoryLite[]> => {
    if (DEMO) return demoCategories;
    const hit = cg.__categoryList;
    if (hit && Date.now() - hit.at < CATEGORY_TTL_MS) return hit.v;
    const epoch = lookupEpoch();
    const v = await prisma.category.findMany({
      select: {
        id: true,
        name: true,
        color: true,
        defaultDurationMinutes: true,
      },
      orderBy: { name: "asc" },
    });
    if (epoch === lookupEpoch()) cg.__categoryList = { at: Date.now(), v };
    return v;
  },
);

export const getCategory = cache(
  async (id: string): Promise<CategoryLite | null> => {
    if (DEMO) return demoCategories.find((c) => c.id === id) ?? null;
    return prisma.category.findFirst({
      where: { id },
      select: {
        id: true,
        name: true,
        color: true,
        defaultDurationMinutes: true,
      },
    });
  },
);

/** Seedează câteva categorii utile la prima utilizare (o singură dată, global). */
export async function ensureDefaultCategories(userId: string): Promise<void> {
  const count = await prisma.category.count();
  if (count > 0) return;
  await prisma.category.createMany({
    data: [
      { userId, name: "Consultație", color: "#6366f1", defaultDurationMinutes: 30 },
      { userId, name: "Tuns", color: "#10b981", defaultDurationMinutes: 45 },
      { userId, name: "Vopsit", color: "#f59e0b", defaultDurationMinutes: 90 },
    ],
  });
}
