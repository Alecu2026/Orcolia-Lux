"use server";

import { prisma } from "@/lib/prisma";
import { DEMO } from "@/lib/demo";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { SPEC_IDS } from "@/lib/tender-spec";
import { canEditTenderChecks } from "@/lib/tender-editor";

/** Bifele „Caiet de sarcini”: id punct → cine a bifat și când. Comune pentru toată echipa. */
export type TenderChecks = Record<string, { by: string; at: string }>;

export async function loadTenderChecks(): Promise<TenderChecks> {
  if (DEMO) return {};
  const rows = await prisma.tenderCheck.findMany({ select: { id: true, byName: true, updatedAt: true } });
  const out: TenderChecks = {};
  for (const r of rows) out[r.id] = { by: r.byName, at: r.updatedAt.toISOString() };
  return out;
}

export async function tenderChecksAction(): Promise<TenderChecks | null> {
  const user = await requireUser();
  if (!can(user, "users.manage")) return null;
  return loadTenderChecks();
}

/** Bifează / debifează un punct (doar punctele care există în caiet). */
export async function setTenderCheckAction(id: string, done: boolean): Promise<{ ok: true; entry: { by: string; at: string } | null } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can(user, "users.manage")) return { ok: false, error: "Fără permisiune." };
  // bifele le modifică doar contul din lib/tender-editor.ts (ceilalți le văd)
  if (!canEditTenderChecks(user.email)) return { ok: false, error: "Nu ai dreptul să modifici bifele." };
  if (DEMO) return { ok: false, error: "Mod demo." };
  if (typeof id !== "string" || !SPEC_IDS.has(id)) return { ok: false, error: "Punct necunoscut." };
  if (!done) {
    await prisma.tenderCheck.deleteMany({ where: { id } });
    return { ok: true, entry: null };
  }
  const row = await prisma.tenderCheck.upsert({
    where: { id },
    create: { id, byId: user.id, byName: user.name },
    update: { byId: user.id, byName: user.name },
    select: { byName: true, updatedAt: true },
  });
  return { ok: true, entry: { by: row.byName, at: row.updatedAt.toISOString() } };
}
