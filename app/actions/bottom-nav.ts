"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/dal";
import { DEMO } from "@/lib/demo";
import { sanitizeBottomNav } from "@/lib/nav-meta";

/** Butoanele rapide din bara de jos de pe telefon, alese de utilizator (doar pentru contul lui). Lista goală = implicit (primele 5 din meniu). */
export async function saveBottomNavAction(hrefs: string[]): Promise<{ ok: true; selected: string[] } | { ok: false; error: string }> {
  const user = await requireUser();
  if (DEMO) return { ok: false, error: "Mod demo: conectează o bază de date." };
  const selected = sanitizeBottomNav(hrefs);
  await prisma.user.update({ where: { id: user.id }, data: { bottomNav: selected } });
  revalidatePath("/", "layout");
  return { ok: true, selected };
}
