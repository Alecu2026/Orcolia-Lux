import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getInvoiceServiceReport } from "@/lib/services/invoice-cache";
import { isValidPeriod } from "@/lib/invoice-list";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Raportul pe servicii (apă / canalizare / amândouă) al facturilor Apă-Canal dintr-o perioadă. Parametru: `p` = perioada (`AAAA-LL` / `last3` / `year:AAAA` / `all`).
 * Răspunde cu rânduri defalcate pe (serviciu, status, valută); filtrele de status / valută le aplică browserul.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "invoices.view")) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  const p = new URL(req.url).searchParams.get("p") ?? "all";
  if (!isValidPeriod(p)) return Response.json({ error: "Perioadă necunoscută." }, { status: 400 });
  try {
    const r = await getInvoiceServiceReport(p);
    return Response.json(r, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[invoices-report] eșuat:", e);
    return Response.json({ error: "Nu am putut calcula raportul." }, { status: 500 });
  }
}
