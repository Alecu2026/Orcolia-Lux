import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { countPendingChains, recomputePaymentChains } from "@/lib/services/payment-chain";
import { countStaleDueMonths, normalizeApaCanalDueDates } from "@/lib/services/apa-canal-due";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Plățile din lanțul de facturi (vezi lib/payment-chain.ts) — doar administratori.
 *  GET  → câte facturi Apă-Canal nu au fost încă procesate și câte luni au scadențe greșite (scadența corectă: 25 a lunii următoare emiterii).
 *  POST → procesează o rundă (până la ~200 s, cel mult 4000 de plătitori) și răspunde cu `{ processed, changed, pending }`; repetă POST-ul până `pending` ajunge la 0.
 * Altfel istoricul se procesează singur, treptat, la fiecare sincronizare 1C și în cron-ul zilnic.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !can(user, "admin")) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  const [pending, staleDue] = await Promise.all([countPendingChains(), countStaleDueMonths()]);
  return Response.json({ pending, staleDue });
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user || !can(user, "admin")) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  // întâi scadențele (dacă sunt greșite se corectează; altfel costă o singură agregare), apoi plățile din lanțul de facturi
  const dueFixed = await normalizeApaCanalDueDates().catch((e) => {
    console.error("[admin] scadențele:", e);
    return 0;
  });
  const s = await recomputePaymentChains({ limitClients: 4000, budgetMs: 200_000, reason: "istoric complet (administrare)" });
  if (s.skipped) return Response.json({ skipped: true, message: "O altă rulare e în curs; încearcă din nou peste un minut.", pending: await countPendingChains() });
  return Response.json({ dueFixed, processed: s.clients, invoices: s.invoices, changed: s.changed, pending: await countPendingChains(), staleDue: 0 });
}
