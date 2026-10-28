import { getCurrentUser, isSuper } from "@/lib/dal";
import { deliverySummary } from "@/lib/queries/delivery";
import { PAYER_CAMPAIGN_KINDS } from "@/lib/delivery-meta";

export const dynamic = "force-dynamic";

/** Rezumatul ultimelor 24 de ore (pe canal și status) pentru antetul paginii. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!isSuper(user)) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  const workers = new URL(req.url).searchParams.get("scope") === "workers";
  return Response.json(await deliverySummary(undefined, workers ? PAYER_CAMPAIGN_KINDS : undefined), { headers: { "Cache-Control": "private, no-store" } });
}
