import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { debtAgingReport } from "@/lib/services/debt-aging";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Raportul datoriilor pe vechime (Facturi): plătitorii cu datorie, pe intervale (1–3 luni, 3 luni–1 an, 1–3 ani, peste 3 ani). Necesită „Facturi – vizualizare”. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "invoices.view")) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  try {
    return Response.json(await debtAgingReport());
  } catch (e) {
    console.error("[debt-aging] eșuat:", e);
    return Response.json({ error: e instanceof Error ? e.message : "Eroare necunoscută." }, { status: 500 });
  }
}
