import { createHash } from "node:crypto";
import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getMeterPins } from "@/lib/services/meter-pins";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Contoarele cu locație pentru hartă (cele fără coordonate nu apar). Necesită „Hartă” și acces la contoare (Plătitori / Citiri contoare / Rute de citire), fiindcă punctele au numele
 * abonatului și adresa. ETag după conținut: neschimbat ⇒ „304” (reîmprospătarea din fundal costă aproape nimic).
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "map.view") || !(can(user, "payers.view") || can(user, "meters.read") || can(user, "meters.manage"))) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  try {
    const body = JSON.stringify(await getMeterPins());
    const etag = `W/"${createHash("sha1").update(body).digest("base64url").slice(0, 22)}"`;
    const headers = { "Cache-Control": "private, no-cache", ETag: etag };
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(body, { headers: { ...headers, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[harta-contoare] eșuat:", e);
    return Response.json({ error: "Nu am putut încărca contoarele." }, { status: 500 });
  }
}
