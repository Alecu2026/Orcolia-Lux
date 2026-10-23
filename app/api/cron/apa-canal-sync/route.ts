import { createHash } from "node:crypto";
import { revalidateTag } from "next/cache";
import { rebuildPayerSnap } from "@/lib/services/payer-cache";
import { env } from "@/lib/env";
import { logAudit } from "@/lib/services/audit";
import { importApaCanalBuffer } from "@/lib/services/apa-canal-import";
import {
  acquireSyncLock,
  fetchFromConfiguredApi,
  getAutoSyncState,
  recordSync,
  releaseSyncLock,
} from "@/lib/services/apa-canal-api";

export const dynamic = "force-dynamic";
// Descărcare + procesare (~1 minut pentru ~18.000 de abonați) — marjă generoasă.
export const maxDuration = 300;

/**
 * Extragerea AUTOMATĂ a plătitorilor din API (cron zilnic, vezi vercel.json). Face ceva doar dacă un
 * administrator a pornit "Sincronizare automată" în fereastra din Plătitori — ceea ce se poate abia după
 * o sincronizare reușită cu aceleași setări. Dacă API-ul întoarce exact același răspuns ca data trecută,
 * nu scrie nimic. Rezultatul (și eventualele erori) apare în fereastra "Sincronizare API".
 */
async function run(req: Request) {
  const auth = req.headers.get("authorization");
  const url = new URL(req.url);
  const ok = auth === `Bearer ${env.cronSecret}` || url.searchParams.get("secret") === env.cronSecret;
  if (!env.cronSecret || !ok) return new Response("forbidden", { status: 401 });

  const state = await getAutoSyncState();
  if (!state) return Response.json({ ok: true, skipped: "Sincronizarea automată nu e pornită." });

  if (!(await acquireSyncLock()).ok) return Response.json({ ok: true, skipped: "O sincronizare rulează deja." });
  try {
    const buf = await fetchFromConfiguredApi();
    const hash = createHash("sha256").update(buf).digest("hex");
    if (state.lastContentHash && state.lastContentHash === hash) {
      await recordSync(true, "Automat: fără schimbări față de ultima sincronizare (răspuns identic).");
      return Response.json({ ok: true, skipped: "Răspuns identic cu cel de data trecută." });
    }

    const { plan, applied } = await importApaCanalBuffer(buf, { ownerId: state.owner.id, commit: true });
    if (!applied) throw new Error("Import fără rezultat.");

    revalidateTag("clients", { expire: 0 });
    // Cache-ul zilnic al listei de plătitori se reface acum, ca prima deschidere de dimineață să fie instantanee.
    await rebuildPayerSnap("cron 1C").catch((e) => console.error("[payer-cache] după cron:", e));
    const msg = `Automat: ${applied.clientsCreated} clienți noi, ${applied.clientsUpdated} actualizați, ${applied.invoicesCreated} facturi noi, ${applied.invoicesUpdated} actualizate (din ${plan.stats.documenteTotale} abonați).`;
    await recordSync(true, msg, { wrote: true, contentHash: hash });
    await logAudit(
      { id: state.owner.id, name: state.owner.name, role: state.owner.role, isSuperAdmin: state.owner.isSuperAdmin },
      { action: "invoice.bulk_import", module: "Invoices", objectName: `Sincronizare automată API Apă-Canal — ${plan.stats.documenteTotale} documente`, newValue: msg },
    );
    return Response.json({ ok: true, applied, stats: plan.stats });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Eroare necunoscută.";
    console.error("[cron apa-canal-sync] eșuat:", e);
    await recordSync(false, `Automat: ${message}`).catch(() => {});
    // 200: eroarea e a API-ului lor (indisponibil, parolă schimbată...), nu a cron-ului — se vede în fereastră.
    return Response.json({ ok: false, error: message });
  } finally {
    await releaseSyncLock().catch(() => {});
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
