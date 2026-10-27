import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { sanitizeMeterFilters } from "@/lib/meters";
import { normalizePerPageClient } from "@/lib/payer-notify";
import { listMetersFromSnap } from "@/lib/services/meter-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * O pagină de contoare filtrate/sortate pe server (din cache-ul din memorie) — folosită doar cât timp lista completă încă nu a ajuns în browser.
 * Filtrele vin ca query-string (aceleași chei ca în `MeterFilters`); GET, ca browserul să poată anula cererea când se schimbă un filtru.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "payers.view")) return Response.json({ error: "Fără permisiune." }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const filters = sanitizeMeterFilters(sp);
  const page = Math.max(1, Math.floor(Number(sp.get("page"))) || 1);
  // Plafon la 1000 de rânduri: un răspuns obișnuit de funcție nu poate depăși ~4,5 MB pe Vercel; „Toate" se servește din snapshot.
  const perPage = Math.min(1000, normalizePerPageClient(sp.get("perPage")));
  try {
    const res = await listMetersFromSnap(filters, page, perPage);
    return Response.json({ items: res.items, total: res.total, page: res.page, perPage });
  } catch (e) {
    console.error("[contoare-list] listare eșuată:", e);
    return Response.json({ error: "Nu am putut încărca lista de contoare." }, { status: 500 });
  }
}
