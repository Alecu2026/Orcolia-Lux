import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getMeterDetail } from "@/lib/queries/meters";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Detaliile unui contor pentru pop-up: câmpurile brute din 1C, calculul, consumatorul și istoricul citirilor (toate lunile importate). */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "payers.view")) return Response.json({ error: "Fără permisiune." }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id || id.length > 80) return Response.json({ error: "Id invalid." }, { status: 400 });
  try {
    const detail = await getMeterDetail(id);
    if (!detail) return Response.json({ error: "Contorul nu mai există în ultima sincronizare. Reîncarcă lista." }, { status: 404 });
    return Response.json(detail, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[contoare-detail] eșuat:", e);
    return Response.json({ error: "Nu am putut încărca detaliile." }, { status: 500 });
  }
}
