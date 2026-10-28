import { getCurrentUser, isSuper } from "@/lib/dal";
import { getDeliveryDetail } from "@/lib/queries/delivery";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!isSuper(user)) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  const { id } = await ctx.params;
  try {
    const detail = await getDeliveryDetail(id);
    if (!detail) return Response.json({ error: "Mesajul nu există." }, { status: 404 });
    return Response.json(detail, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[delivery] detaliu eșuat:", e);
    return Response.json({ error: "Nu am putut încărca detaliile." }, { status: 500 });
  }
}
