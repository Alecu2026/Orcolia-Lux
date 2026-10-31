import { gunzipSync } from "node:zlib";
import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getClientSnap } from "@/lib/services/client-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Toți clienții CRM pentru tabelul din /clients (vezi lib/services/client-cache.ts): gzip pre-comprimat, ETag, 304 când browserul are deja versiunea curentă. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "clients.view")) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  try {
    const snap = await getClientSnap();
    const etag = `"${snap.version}"`;
    const base = { ETag: etag, "Cache-Control": "private, max-age=15, must-revalidate", Vary: "Accept-Encoding" };
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: base });
    if (/\bgzip\b/i.test(req.headers.get("accept-encoding") ?? "")) {
      return new Response(new Uint8Array(snap.gz), { headers: { ...base, "Content-Type": "application/json", "Content-Encoding": "gzip", "Content-Length": String(snap.gz.length) } });
    }
    return new Response(new Uint8Array(gunzipSync(snap.gz)), { headers: { ...base, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[clients-snapshot] eșuat:", e);
    return Response.json({ error: "Nu am putut încărca clienții." }, { status: 500 });
  }
}
