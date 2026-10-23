import { gunzipSync } from "node:zlib";
import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getMonthSlice, getPayerSnap } from "@/lib/services/payer-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Lista tuturor plătitorilor (sau, cu ?month=YYYY-MM, facturile lunii) pentru motorul local din /platitori și /notificari-platitori:
 * browserul o ține în memorie și filtrează în JS.
 *
 * Nu se mai citește din baza de date la fiecare cerere: se servește cache-ul zilnic (lib/services/payer-cache.ts), deja comprimat gzip
 * (~1 MB în loc de ~4 MB) și cu ETag. Dacă browserul are deja versiunea curentă (If-None-Match), răspunsul e 304, fără corp.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "payers.view")) return Response.json({ error: "Fără permisiune." }, { status: 403 });

  const month = new URL(req.url).searchParams.get("month");
  try {
    const snap = await getPayerSnap();
    const etag = `"${month ? `${snap.version}-${month}` : snap.version}"`;
    // private: conține date personale. max-age scurt: răspunsul preîncărcat din HTML (<link rel=preload>) se poate folosi și când hidratarea
    // durează (telefoane lente) fără o a doua descărcare; cererile cu If-None-Match (cele ale aplicației) ocolesc oricum acest cache și validează.
    const base = { ETag: etag, "Cache-Control": "private, max-age=15, must-revalidate", Vary: "Accept-Encoding" };
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: base });

    if (month) {
      const { gz, tuples } = await getMonthSlice(month);
      if (/\bgzip\b/i.test(req.headers.get("accept-encoding") ?? "")) {
        return new Response(new Uint8Array(gz), { headers: { ...base, "Content-Type": "application/json", "Content-Encoding": "gzip", "Content-Length": String(gz.length) } });
      }
      return Response.json({ month, rows: tuples }, { headers: base });
    }
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
    console.error("[platitori-snapshot] eșuat:", e);
    return Response.json({ error: "Nu am putut încărca lista de plătitori." }, { status: 500 });
  }
}
