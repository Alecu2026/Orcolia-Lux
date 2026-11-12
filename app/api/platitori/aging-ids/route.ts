import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { agingIds } from "@/lib/services/debt-aging";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Plătitorii dintr-un interval de „datorie pe vechime” (?bucket=m1_3|m3_12|y1_3|y3p), ca mulțime de id-uri: motorul local din browser (filtrul „Datorie pe vechime” din Plătitori /
 * Notificări) o folosește ca să filtreze direct tabelul, fără fereastră separată. Același raport ca „Datorii pe vechime” din Facturi (ținut 10 minute în memorie).
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "payers.view")) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  const bucket = new URL(req.url).searchParams.get("bucket") ?? "";
  try {
    return Response.json({ ids: await agingIds(bucket) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[aging-ids] eșuat:", e);
    return Response.json({ error: "Nu am putut calcula datoriile pe vechime." }, { status: 500 });
  }
}
