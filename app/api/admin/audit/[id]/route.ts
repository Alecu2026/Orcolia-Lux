import { getCurrentUser, isSuper } from "@/lib/dal";
import { getAuditLogDetail } from "@/lib/queries/audit";

export const dynamic = "force-dynamic";

/** Un jurnal întreg (pop-up): valorile complete, detaliile, istoricul aceluiași obiect și ce a mai făcut persoana în jurul acelui moment. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!isSuper(user)) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  const { id } = await ctx.params;
  try {
    const detail = await getAuditLogDetail(id);
    if (!detail) return Response.json({ error: "Jurnalul nu există." }, { status: 404 });
    return Response.json(detail, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[audit] detaliu eșuat:", e);
    return Response.json({ error: "Nu am putut încărca detaliile." }, { status: 500 });
  }
}
