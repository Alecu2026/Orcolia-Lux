import { gunzipSync } from "node:zlib";
import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getOneCSnap, snapshotPeriod } from "@/lib/services/onec-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Tabelul 1C pentru motorul local din „Tabel 1C”: toate rândurile unei perioade (?period=latest | YYYY-MM), comprimate gzip și cu ETag; dacă browserul are deja versiunea curentă
 * (If-None-Match), răspunsul e 304, fără corp. „Toate lunile” nu are snapshot (se citește pe server, paginat).
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "payers.view")) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  const period = snapshotPeriod(new URL(req.url).searchParams.get("period"));
  if (!period) return Response.json({ error: "Perioadă invalidă." }, { status: 400 });
  try {
    const snap = await getOneCSnap(period);
    const etag = `"${snap.version}"`;
    // max-age scurt: răspunsul preîncărcat din HTML (<link rel=preload>) se poate folosi fără o a doua descărcare; cererile cu If-None-Match (ale aplicației) validează
    const base = { ETag: etag, "Cache-Control": "private, max-age=15, must-revalidate", Vary: "Accept-Encoding" };
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: base });
    if (/\bgzip\b/i.test(req.headers.get("accept-encoding") ?? "")) {
      return new Response(new Uint8Array(snap.gz), { headers: { ...base, "Content-Type": "application/json", "Content-Encoding": "gzip", "Content-Length": String(snap.gz.length) } });
    }
    const bytes = gunzipSync(snap.gz);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 262_144) controller.enqueue(new Uint8Array(bytes.subarray(i, i + 262_144)));
        controller.close();
      },
    });
    return new Response(stream, { headers: { ...base, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[tabel-1c-snapshot] eșuat:", e);
    return Response.json({ error: "Nu am putut încărca tabelul 1C." }, { status: 500 });
  }
}
