import { getCurrentUser, isSuper } from "@/lib/dal";
import { filterFromState, listAuditChunk, listAuditLogs, normalizeAuditPageSize } from "@/lib/queries/audit";
import { sanitizeAuditState } from "@/lib/audit-meta";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Jurnalele, pe pagini (`ps=50`, `page=2`) sau — cu `ps=all` — pe bucăți cu cursor (`cursor=<id>&loaded=<câte are deja browserul>&limit=…`).
 * Doar pentru super-admini; pagina se actualizează fără reîncărcare completă.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!isSuper(user)) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const state = sanitizeAuditState(Object.fromEntries(sp.entries()));
  const fresh = sp.get("fresh") === "1";
  try {
    if (sp.get("ps") === "all") {
      const res = await listAuditChunk(filterFromState(state), {
        cursor: sp.get("cursor") ?? undefined,
        limit: Number(sp.get("limit")) || undefined,
        loaded: Number(sp.get("loaded")) || 0,
        fresh,
      });
      return Response.json(res, { headers: { "Cache-Control": "private, no-store" } });
    }
    const page = Math.max(1, Math.floor(Number(sp.get("page"))) || 1);
    const res = await listAuditLogs({ ...filterFromState(state, page, normalizeAuditPageSize(sp.get("ps"))), fresh });
    return Response.json(res, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[audit] listă eșuată:", e);
    return Response.json({ error: "Nu am putut încărca jurnalul." }, { status: 500 });
  }
}
