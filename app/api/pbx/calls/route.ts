import { gunzipSync } from "node:zlib";
import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getSnap, pbxDelta } from "@/lib/services/pbx-data";
import type { PbxKind } from "@/lib/pbx-data";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Datele paginii /pbx pentru browser (vezi lib/services/pbx-data.ts):
 *  - `?kind=calls|notify`            → lista completă (gzip pre-comprimat din memoria serverului, ETag / 304);
 *  - `?kind=calls|notify&since=<ms>` → doar rândurile modificate după acel moment (câțiva bytes când nu s-a schimbat nimic).
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "pbx.view")) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const kind: PbxKind = sp.get("kind") === "notify" ? "notify" : "calls";
  try {
    const sinceRaw = sp.get("since");
    if (sinceRaw !== null) {
      const since = Number(sinceRaw);
      if (!Number.isFinite(since) || since < 0) return Response.json({ error: "Moment invalid." }, { status: 400 });
      return Response.json(await pbxDelta(kind, since), { headers: { "Cache-Control": "no-store" } });
    }
    const snap = await getSnap(kind, sp.get("fresh") === "1");
    const etag = `"${snap.version}"`;
    const base = { ETag: etag, "Cache-Control": "private, max-age=15, must-revalidate", Vary: "Accept-Encoding" };
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: base });
    if (/\bgzip\b/i.test(req.headers.get("accept-encoding") ?? "")) {
      return new Response(new Uint8Array(snap.gz), { headers: { ...base, "Content-Type": "application/json", "Content-Encoding": "gzip", "Content-Length": String(snap.gz.length) } });
    }
    return new Response(new Uint8Array(gunzipSync(snap.gz)), { headers: { ...base, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[pbx-data] eșuat:", e);
    return Response.json({ error: "Nu am putut încărca apelurile." }, { status: 500 });
  }
}
