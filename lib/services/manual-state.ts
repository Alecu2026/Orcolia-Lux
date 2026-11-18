import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { logAudit } from "./audit";

/**
 * Starea manualului: CIORNĂ (îl vede doar contul editor, care pune pozele) sau PUBLICAT (îl văd și ceilalți, după drepturile lor). Editorul apasă „Finalizat” când a pus toate pozele.
 * Starea stă în baza de date (ManualState, un singur rând) și se ține 15 secunde în memoria procesului (meniul o citește la fiecare pagină); publicarea golește imediat memoria procesului curent.
 * În modul demo (fără bază de date) manualul se arată ca publicat, ca să se poată vedea.
 */

export type ManualState = { published: boolean; publishedAt: string | null; by: string | null };

const TTL_MS = 15_000;
const g = globalThis as unknown as { __manualState?: { at: number; v: ManualState } };

export async function getManualState(): Promise<ManualState> {
  if (DEMO) return { published: true, publishedAt: null, by: null };
  const hit = g.__manualState;
  if (hit && Date.now() - hit.at < TTL_MS) return hit.v;
  const row = await prisma.manualState.findUnique({ where: { singleton: "main" }, select: { published: true, publishedAt: true, byName: true } }).catch(() => null);
  const v: ManualState = { published: !!row?.published, publishedAt: row?.publishedAt ? row.publishedAt.toISOString() : null, by: row?.byName ?? null };
  g.__manualState = { at: Date.now(), v };
  return v;
}

export const isManualPublished = async (): Promise<boolean> => (await getManualState()).published;

type Actor = { id: string; name: string; role: string; isSuperAdmin?: boolean };

export async function setManualPublished(user: Actor, published: boolean): Promise<{ ok: true; state: ManualState } | { ok: false; error: string }> {
  if (DEMO) return { ok: false, error: "Mod demo: conectează o bază de date." };
  const row = await prisma.manualState.upsert({
    where: { singleton: "main" },
    create: { singleton: "main", published, publishedAt: published ? new Date() : null, byName: user.name },
    update: { published, publishedAt: published ? new Date() : null, byName: user.name },
    select: { published: true, publishedAt: true, byName: true },
  });
  const v: ManualState = { published: row.published, publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null, by: row.byName };
  g.__manualState = { at: Date.now(), v };
  await logAudit(
    { id: user.id, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin },
    { action: published ? "manual.publish" : "manual.unpublish", module: "Manual", objectName: "Manual de utilizare" },
  ).catch(() => {});
  return { ok: true, state: v };
}
