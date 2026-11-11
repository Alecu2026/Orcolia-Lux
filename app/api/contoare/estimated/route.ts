import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { estimatedMeters } from "@/lib/services/estimated-meters";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Raportul „contoare estimate N luni la rând” (Citiri teren): `?months=3` (2–12). Necesită „Citiri contoare”. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "meters.read")) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  const n = Number(new URL(req.url).searchParams.get("months"));
  try {
    return Response.json(await estimatedMeters(n));
  } catch (e) {
    console.error("[estimated-meters] eșuat:", e);
    return Response.json({ error: e instanceof Error ? e.message : "Eroare necunoscută." }, { status: 500 });
  }
}
