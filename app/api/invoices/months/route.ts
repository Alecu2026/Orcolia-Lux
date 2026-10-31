import { createHash } from "node:crypto";
import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getInvoiceMonths } from "@/lib/services/invoice-cache";

export const dynamic = "force-dynamic";

/** Lunile cu facturi și câte are fiecare (cea mai recentă prima) — mic, cu ETag; pentru selectorul de perioadă din /invoices. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "invoices.view")) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  try {
    const months = await getInvoiceMonths();
    const body = JSON.stringify({ months });
    const etag = `"${createHash("sha1").update(body).digest("hex").slice(0, 16)}"`;
    const headers = { ETag: etag, "Cache-Control": "private, max-age=10, must-revalidate" };
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(body, { headers: { ...headers, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[invoices-months] eșuat:", e);
    return Response.json({ error: "Nu am putut încărca lunile." }, { status: 500 });
  }
}
