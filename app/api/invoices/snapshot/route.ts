import { gunzipSync } from "node:zlib";
import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getInvoiceMonths, getInvoiceShardPayload } from "@/lib/services/invoice-cache";
import { MONTH_RE } from "@/lib/invoice-list";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Facturile unei luni (după data emiterii) pentru motorul local din /invoices (vezi lib/invoice-list.ts): gzip pre-comprimat, ETag, 304 când browserul are deja versiunea curentă.
 * `?month=AAAA-LL` (fără parametru: luna cea mai recentă). Lunile fără facturi nu se construiesc (404). Lista lunilor: /api/invoices/months.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "invoices.view")) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  try {
    const months = await getInvoiceMonths();
    const asked = new URL(req.url).searchParams.get("month");
    const month = asked ?? months[0]?.month ?? "";
    if (asked && !MONTH_RE.test(asked)) return Response.json({ error: "Lună invalidă." }, { status: 400 });
    if (!month || !months.some((m) => m.month === month)) return Response.json({ error: "Nu există facturi în această lună." }, { status: 404 });
    const snap = await getInvoiceShardPayload(month);
    const etag = `"${snap.version}"`;
    const base = { ETag: etag, "Cache-Control": "private, max-age=15, must-revalidate", Vary: "Accept-Encoding", "X-Invoice-Month": month };
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
