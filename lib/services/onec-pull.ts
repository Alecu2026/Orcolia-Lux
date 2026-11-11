import "server-only";
import { createHash } from "node:crypto";
import { revalidateTag } from "next/cache";
import { rebuildPayerSnap } from "./payer-cache";
import { rebuildInvoiceSnap } from "./invoice-cache";
import { normalizeApaCanalDueDates } from "./apa-canal-due";
import { syncPaymentChains } from "./payment-chain";
import { importApaCanalBuffer } from "./apa-canal-import";
import { acquireSyncLock, ApiFetchError, fetchFromConfiguredApi, getApiConfigPublic, recordSync, releaseSyncLock } from "./apa-canal-api";
import { prisma } from "../prisma";

/**
 * Extragerea din 1C (aceeași ca sincronizarea din Plătitori și ca cron-ul zilnic), făcută ÎNAINTE de a trimite citirile: contoarele, abonații și facturile din CRM
 * se pun la zi, apoi pleacă citirile. Un răspuns identic cu cel de data trecută nu rescrie nimic („unchanged”).
 */
export type PullResult = {
  status: "not_configured" | "locked" | "unchanged" | "updated" | "error";
  message: string;
};

export async function pullFromOneC(actor: { id: string }): Promise<PullResult> {
  if (!(await getApiConfigPublic()).url) {
    return { status: "not_configured", message: "Extragerea din 1C nu e configurată (Plătitori → Sincronizare API): se trimit citirile fără a actualiza întâi datele din 1C." };
  }
  const lock = await acquireSyncLock();
  if (!lock.ok) return { status: "locked", message: "O sincronizare cu 1C rulează deja. Încearcă din nou peste câteva minute." };
  try {
    const buf = await fetchFromConfiguredApi();
    const hash = createHash("sha256").update(buf).digest("hex");
    const row = await prisma.apiIntegration.findFirst({ where: { key: "apa-canal-1c" }, select: { lastContentHash: true } });
    if (row?.lastContentHash && row.lastContentHash === hash) {
      await recordSync(true, "Înainte de trimiterea citirilor: fără schimbări față de ultima sincronizare (răspuns identic).");
      return { status: "unchanged", message: "Datele din 1C sunt deja la zi (răspuns identic cu ultima extragere)." };
    }
    const { applied } = await importApaCanalBuffer(buf, { ownerId: actor.id, commit: true });
    if (!applied) throw new Error("Import fără rezultat.");
    revalidateTag("clients", { expire: 0 });
    await rebuildPayerSnap("trimitere citiri 1C").catch((e) => console.error("[onec-pull] plătitori:", e));
    await normalizeApaCanalDueDates().catch((e) => console.error("[onec-pull] scadențe:", e));
    await syncPaymentChains("trimitere citiri 1C").catch((e) => console.error("[onec-pull] plăți:", e));
    await rebuildInvoiceSnap("trimitere citiri 1C").catch((e) => console.error("[onec-pull] facturi:", e));
    const msg = `Extras din 1C: ${applied.clientsCreated} clienți noi, ${applied.clientsUpdated} actualizați, ${applied.invoicesCreated} facturi noi, ${applied.invoicesUpdated} actualizate.`;
    await recordSync(true, msg, { wrote: true, contentHash: hash });
    return { status: "updated", message: msg };
  } catch (e) {
    const message = e instanceof ApiFetchError || e instanceof Error ? e.message : "Eroare necunoscută la extragerea din 1C.";
    if (!(e instanceof ApiFetchError)) console.error("[onec-pull] eșuat:", e);
    await recordSync(false, message).catch(() => {});
    return { status: "error", message };
  } finally {
    await releaseSyncLock().catch(() => {});
  }
}
