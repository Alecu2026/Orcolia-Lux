import { gunzipSync } from "node:zlib";
import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getProjectCounts } from "@/lib/services/project-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Numărul de sarcini al fiecărui proiect (hartă mică id → număr; vezi lib/services/project-cache.ts). Se cere de fiecare dată cu validare (ETag): 304 când nu s-a schimbat nimic. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "projects.view")) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  try {
    const c = await getProjectCounts();
    const etag = `"${c.version}"`;
    const base = { ETag: etag, "Cache-Control": "private, no-cache", Vary: "Accept-Encoding" };
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: base });
    if (/\bgzip\b/i.test(req.headers.get("accept-encoding") ?? "")) {
      return new Response(new Uint8Array(c.gz), { headers: { ...base, "Content-Type": "application/json", "Content-Encoding": "gzip", "Content-Length": String(c.gz.length) } });
    }
    return new Response(new Uint8Array(gunzipSync(c.gz)), { headers: { ...base, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[projects-counts] eșuat:", e);
    return Response.json({ error: "Nu am putut încărca numărul de sarcini." }, { status: 500 });
  }
}
