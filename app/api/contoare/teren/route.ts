import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getFieldList } from "@/lib/services/meter-readings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Lista pentru „Citiri teren": contoarele active, în ordinea adreselor, cu ultimul index cunoscut și citirea de luna aceasta (dacă există).
 * Doar pentru cine are „Citiri contoare" — fără acces la restul datelor plătitorilor (telefon, facturi…): lista are doar abonat, adresă și indexuri.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "meters.read")) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  try {
    const list = await getFieldList();
    return Response.json(list, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[contoare-teren] eșuat:", e);
    return Response.json({ error: "Nu am putut încărca lista de contoare." }, { status: 500 });
  }
}
