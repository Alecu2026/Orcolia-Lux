import { getCurrentUser, isSuper } from "@/lib/dal";
import { deliverySummary } from "@/lib/queries/delivery";

export const dynamic = "force-dynamic";

/** Rezumatul ultimelor 24 de ore (pe canal și status) pentru antetul paginii. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!isSuper(user)) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  return Response.json(await deliverySummary(), { headers: { "Cache-Control": "private, no-store" } });
}
