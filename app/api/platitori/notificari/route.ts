import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { listPayers, normalizePerPage } from "@/lib/queries/payers";
import { filtersToListOpts } from "@/lib/queries/payer-notify";
import { normalizePerPageClient, sanitizeFilters } from "@/lib/payer-notify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Tabelul de notificări: plătitorii filtrați/sortați/paginați pe server. Clientul trimite filtrele ca
 * query-string (aceleași chei ca în `NotifyFilters`) și poate anula cererea (AbortController) când
 * utilizatorul schimbă iar un filtru — de aceea GET, nu server action (acestea se execută pe rând).
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "clients.view")) return Response.json({ error: "Fără permisiune." }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const filters = sanitizeFilters(sp);
  const page = Math.max(1, Math.floor(Number(sp.get("page"))) || 1);
  const perPage = normalizePerPage(normalizePerPageClient(sp.get("perPage")));

  try {
    const res = await listPayers({ ...filtersToListOpts(filters), page, perPage });
    return Response.json({
      items: res.items,
      total: res.total,
      page: res.page,
      perPage: "perPage" in res ? res.perPage : perPage,
    });
  } catch (e) {
    console.error("[notificari-platitori] listare eșuată:", e);
    return Response.json({ error: "Nu am putut încărca lista de plătitori." }, { status: 500 });
  }
}
