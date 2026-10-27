import { gunzipSync } from "node:zlib";
import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getMeterSnap } from "@/lib/services/meter-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Lista tuturor contoarelor pentru motorul local din /contoare: browserul o ține în memorie și filtrează în JS.
 * Se servește din cache-ul din memorie (vezi lib/services/meter-cache.ts), deja comprimat gzip și cu ETag; dacă browserul are deja versiunea
 * curentă (If-None-Match), răspunsul e 304, fără corp.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "payers.view")) return Response.json({ error: "Fără permisiune." }, { status: 403 });

  try {
    const snap = await getMeterSnap();
    const etag = `"${snap.version}"`;
    // private: conține date personale. max-age scurt: răspunsul preîncărcat din HTML (<link rel=preload>) se poate folosi fără o a doua descărcare;
    // cererile cu If-None-Match (cele ale aplicației) ocolesc acest cache și validează.
    const base = { ETag: etag, "Cache-Control": "private, max-age=15, must-revalidate", Vary: "Accept-Encoding" };
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: base });

    if (/\bgzip\b/i.test(req.headers.get("accept-encoding") ?? "")) {
      return new Response(new Uint8Array(snap.gz), { headers: { ...base, "Content-Type": "application/json", "Content-Encoding": "gzip", "Content-Length": String(snap.gz.length) } });
    }
    // Client fără gzip (rar): decomprimăm; ca flux, ca să nu depășim limita de răspuns a unei funcții.
    const bytes = gunzipSync(snap.gz);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 262_144) controller.enqueue(new Uint8Array(bytes.subarray(i, i + 262_144)));
        controller.close();
      },
    });
    return new Response(stream, { headers: { ...base, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[contoare-snapshot] eșuat:", e);
    return Response.json({ error: "Nu am putut încărca lista de contoare." }, { status: 500 });
  }
}
