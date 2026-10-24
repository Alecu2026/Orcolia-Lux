import { getCurrentUser } from "@/lib/dal";
import { canAny } from "@/lib/permissions";
import { searchPayerAddresses } from "@/lib/services/address-search";

export const dynamic = "force-dynamic";

/**
 * Sugestii de adresă pentru câmpul „Adresă" din task-uri / tichete: ?q=<text> → cel mult 8 adrese din lista plătitorilor.
 * Pentru oricine poate crea / edita task-uri sau vede plătitorii; întoarce doar adrese (fără nume sau alte date).
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!canAny(user, ["tasks.create", "tasks.edit", "tickets.view", "payers.view", "clients.view"])) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 80);
  try {
    // private + max-age scurt: aceeași literă tastată din nou nu mai cere nimic
    return Response.json({ items: await searchPayerAddresses(q) }, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (e) {
    console.error("[addresses] eșuat:", e);
    return Response.json({ items: [] });
  }
}
