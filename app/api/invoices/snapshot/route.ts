import { gunzipSync } from "node:zlib";
import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getInvoicePayload } from "@/lib/services/invoice-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Toate facturile pentru motorul local din /invoices (vezi lib/invoice-list.ts): gzip pre-comprimat, ETag, 304 când browserul are deja versiunea curentă.
 * În modul „server" (prea multe facturi) răspunsul e doar `{ mode: "server", rows: [] }`, iar lista se aduce pagină cu pagină din /api/invoices/list.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "invoices.view")) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  try {
    const snap = await getInvoicePayload();
    const etag = `"${snap.version}"`;
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
    console.error("[invoices-snapshot] eșuat:", e);
    return Response.json({ error: "Nu am putut încărca lista de facturi." }, { status: 500 });
  }
}
