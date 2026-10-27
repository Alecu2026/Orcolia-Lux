import { createHash } from "node:crypto";
import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getFieldList } from "@/lib/services/meter-readings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Lista pentru „Citiri teren": contoarele active, în ordinea adreselor, cu ultimul index cunoscut și citirea de luna aceasta (dacă există).
 * Doar pentru cine are „Citiri contoare" — fără acces la restul datelor plătitorilor (telefon, facturi…): lista are doar abonat, adresă și indexuri.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "meters.read")) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  try {
    const list = await getFieldList();
    const body = JSON.stringify(list);
    // ETag după conținut: dacă nimeni n-a citit nimic de la ultima cerere, răspunsul e „304” (fără corp) — reîmprospătarea din fundal costă aproape nimic.
    const etag = `W/"${createHash("sha1").update(body).digest("base64url").slice(0, 22)}"`;
    const headers = { "Cache-Control": "private, no-cache", ETag: etag };
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(body, { headers: { ...headers, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[contoare-teren] eșuat:", e);
    return Response.json({ error: "Nu am putut încărca lista de contoare." }, { status: 500 });
  }
}
