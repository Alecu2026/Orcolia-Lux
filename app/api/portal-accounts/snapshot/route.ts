import { gunzipSync } from "node:zlib";
import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getPortalAccountsSnap } from "@/lib/services/portal-accounts-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Lista conturilor din portal pentru tabelul din Setări → Conturi portal clienți (doar administratori): comprimată gzip, cu ETag; dacă browserul are deja versiunea
 * curentă (If-None-Match) răspunsul e 304, fără corp.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "admin")) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  try {
    const snap = await getPortalAccountsSnap();
    const etag = `"${snap.version}"`;
    const base = { ETag: etag, "Cache-Control": "private, no-cache", Vary: "Accept-Encoding" };
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: base });
    if (/\bgzip\b/i.test(req.headers.get("accept-encoding") ?? "")) {
      return new Response(new Uint8Array(snap.gz), { headers: { ...base, "Content-Type": "application/json", "Content-Encoding": "gzip", "Content-Length": String(snap.gz.length) } });
    }
    return new Response(new Uint8Array(gunzipSync(snap.gz)), { headers: { ...base, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[portal-accounts-snapshot] eșuat:", e);
    return Response.json({ error: "Nu am putut încărca conturile." }, { status: 500 });
  }
}
