import { getCurrentUser } from "@/lib/dal";
import { canViewManual, manualFor } from "@/lib/services/manual-access";
import { readManualShot } from "@/lib/services/manual-shots";
import { isManualPublished } from "@/lib/services/manual-state";

export const dynamic = "force-dynamic";

/**
 * Poza unui loc din „Manual de utilizare”, servită din baza de date (optimizată, WebP). Adresa conține versiunea (?v=…), care se schimbă la fiecare înlocuire,
 * deci browserul o păstrează în cache un an. O văd cei care văd manualul.
 */
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Autentificare necesară.", { status: 401 });
  if (!canViewManual(user, await isManualPublished())) return new Response("Fără permisiune.", { status: 403 });
  const { key } = await params;
  // doar pozele din paginile pe care le vede (screenshot-urile paginilor de administrare nu ajung la cei fără acces la ele)
  if (!manualFor(user).keys.has(key)) return new Response("Not found", { status: 404 });
  const shot = await readManualShot(key);
  if (!shot) return new Response("Not found", { status: 404 });
  const etag = `"${shot.updatedAt.getTime().toString(16)}-${shot.data.length.toString(16)}"`;
  const headers = new Headers({
    "Content-Type": shot.mime,
    "Content-Length": String(shot.data.length),
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    ETag: etag,
  });
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(shot.data), { headers });
}
