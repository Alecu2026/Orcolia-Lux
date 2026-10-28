import { getCurrentUser, isSuper } from "@/lib/dal";
import { deliveryFilterFromState, listDelivery, listDeliveryChunk, normalizeDeliveryPageSize } from "@/lib/queries/delivery";
import { sanitizeDeliveryState } from "@/lib/delivery-meta";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Jurnalul trimiterilor, pe pagini (`ps=50`, `page=2`) sau — cu `ps=all` — pe bucăți cu cursor. Doar pentru super-admini. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!isSuper(user)) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const state = sanitizeDeliveryState(Object.fromEntries(sp.entries()));
  const fresh = sp.get("fresh") === "1";
  try {
    if (sp.get("ps") === "all") {
      const res = await listDeliveryChunk(deliveryFilterFromState(state), { cursor: sp.get("cursor") ?? undefined, limit: Number(sp.get("limit")) || undefined, loaded: Number(sp.get("loaded")) || 0, fresh });
      return Response.json(res, { headers: { "Cache-Control": "private, no-store" } });
    }
    const page = Math.max(1, Math.floor(Number(sp.get("page"))) || 1);
    const res = await listDelivery({ ...deliveryFilterFromState(state, page, normalizeDeliveryPageSize(sp.get("ps"))), fresh });
    return Response.json(res, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[delivery] listă eșuată:", e);
    return Response.json({ error: "Nu am putut încărca jurnalul." }, { status: 500 });
  }
}
