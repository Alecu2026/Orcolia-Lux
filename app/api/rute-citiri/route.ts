import { createHash } from "node:crypto";
import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getRouteOptions, getRoutesBundle } from "@/lib/services/meter-routes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Datele paginii „Rute de citire” pentru reîmprospătare fără reîncărcarea paginii: `?part=options` = valorile pentru regulile unei rute (sectoare, localități, străzi — se cer abia când
 * deschizi fereastra rutei); altfel pachetul (raport + rute + nereguli + cititori). `fresh=1` ocolește memoria serverului. ETag după conținut: neschimbat ⇒ 304.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "meters.manage")) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  try {
    const data = sp.get("part") === "options" ? await getRouteOptions() : await getRoutesBundle({ fresh: sp.get("fresh") === "1" });
    // „at” (momentul calculării) nu intră în ETag: același conținut ⇒ 304 chiar dacă a fost recalculat
    const { at, ...rest } = data as { at?: number };
    const body = JSON.stringify(data);
    const etag = `W/"${createHash("sha1").update(JSON.stringify(rest)).digest("base64url").slice(0, 22)}"`;
    const headers = { "Cache-Control": "private, no-cache", ETag: etag };
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    void at;
    return new Response(body, { headers: { ...headers, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[rute-citiri] eșuat:", e);
    return Response.json({ error: "Nu am putut încărca datele." }, { status: 500 });
  }
}
