import { gunzipSync } from "node:zlib";
import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/queries/settings";
import { getApptShard } from "@/lib/services/appointment-cache";
import { APPT_MONTH_RE } from "@/lib/appt-snapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Programările utilizatorului dintr-o lună (`?month=AAAA-LL`), compact și comprimat (vezi lib/services/appointment-cache.ts). ETag = versiunea lunii din manifest:
 * browserul care o are deja primește 304 fără ca serverul să mai construiască ceva. Lunile fără programări: 404.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "appointments.view")) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  const month = new URL(req.url).searchParams.get("month") ?? "";
  if (!APPT_MONTH_RE.test(month)) return Response.json({ error: "Lună invalidă." }, { status: 400 });
  try {
    const settings = await getSettings(user.id);
    const shard = await getApptShard(user.id, settings.timezone, month);
    if (!shard) return Response.json({ error: "Nu există programări în această lună." }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
    const etag = `"${shard.version}"`;
    const base = { ETag: etag, "Cache-Control": "private, max-age=0, must-revalidate", Vary: "Accept-Encoding" };
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: base });
    if (/\bgzip\b/i.test(req.headers.get("accept-encoding") ?? "")) {
      return new Response(new Uint8Array(shard.gz), { headers: { ...base, "Content-Type": "application/json", "Content-Encoding": "gzip", "Content-Length": String(shard.gz.length) } });
    }
    return new Response(new Uint8Array(gunzipSync(shard.gz)), { headers: { ...base, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[appointments-snapshot] eșuat:", e);
    return Response.json({ error: "Nu am putut încărca programările." }, { status: 500 });
  }
}
