import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { notifiedClientIds } from "@/lib/queries/payer-notify";
import { notifyCriterion, sanitizeFilters } from "@/lib/payer-notify";

export const dynamic = "force-dynamic";

/**
 * Plătitorii cărora li s-a trimis (sau nu) o notificare pe un canal, într-o perioadă — din jurnalul de trimiteri. Motorul local din browser
 * (filtrele din /notificari-platitori) le folosește ca mulțime de id-uri, pentru ca filtrul „canal + perioadă" să rămână instant.
 * ?via=EMAIL|SMS|CALL|ANY (sau cu „!" în față) &notifiedFrom=YYYY-MM-DD &notifiedTo=YYYY-MM-DD. Răspunsul conține mereu id-urile care AU primit
 * notificarea; negația („!") o aplică clientul.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "payers.view")) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  const f = sanitizeFilters(new URL(req.url).searchParams);
  const crit = notifyCriterion(f);
  if (!crit) return Response.json({ ids: [] as string[] });
  try {
    return Response.json({ ids: await notifiedClientIds(crit) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[notificari-ids] eșuat:", e);
    return Response.json({ error: "Nu am putut încărca jurnalul de notificări." }, { status: 500 });
  }
}
