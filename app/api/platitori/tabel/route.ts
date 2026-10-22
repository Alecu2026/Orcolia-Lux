import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getOneCDetail, listOneC, parseOneCQuery } from "@/lib/queries/onec";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Tabelul 1C: listă filtrată/sortată/paginată (server-side) sau, cu ?detail=<id>, detaliile unui abonat. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "payers.view")) return Response.json({ error: "Fără permisiune." }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const detailId = sp.get("detail");
  if (detailId) {
    if (!/^[0-9a-f]{24}$/i.test(detailId)) return Response.json({ error: "Id invalid." }, { status: 400 });
    const d = await getOneCDetail(detailId);
    if (!d) return Response.json({ error: "Nu există." }, { status: 404 });
    return Response.json(d);
  }

  try {
    return Response.json(await listOneC(parseOneCQuery(sp)));
  } catch (e) {
    console.error("[tabel-1c] listare eșuată:", e);
    return Response.json({ error: "Nu am putut încărca tabelul." }, { status: 500 });
  }
}
