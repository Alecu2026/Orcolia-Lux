import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { listInvoicesPage } from "@/lib/services/invoice-cache";
import { normalizeInvoicePerPage, queryFromParams } from "@/lib/invoice-list";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * O pagină din lista de facturi, filtrată pe server: din snapshot-urile lunilor când perioada încape în memorie, altfel din baza de date (căutare peste „toate lunile").
 * Parametri: filtrele (vezi `queryFromParams`), `p` = perioada (`AAAA-LL` / `last3` / `year:AAAA` / `all`), `page`, `ps`.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "invoices.view")) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  try {
    const res = await listInvoicesPage(
      queryFromParams(sp),
      sp.get("p"),
      Math.max(1, Math.floor(Number(sp.get("page"))) || 1),
      normalizeInvoicePerPage(sp.get("ps")),
    );
    return Response.json(res, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[invoices-list] eșuat:", e);
    return Response.json({ error: "Nu am putut încărca facturile." }, { status: 500 });
  }
}
