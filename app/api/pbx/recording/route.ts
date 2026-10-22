import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Redă înregistrarea unui apel în pagină (<audio> din /pbx): aplicația aduce fișierul de la PBX și îl trimite mai departe
 * (în flux, cu suport pentru Range, ca să meargă derularea). Astfel linkul PBX nu ajunge în browser și, dacă Moldcell cere
 * cheia API, se trimite din server (PBX_API_KEY). Doar utilizatori cu acces la clienți; doar adrese de pe domeniul PBX Moldcell.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "pbx.view")) return Response.json({ error: "Fără permisiune." }, { status: 403 });

  const callId = new URL(req.url).searchParams.get("callId") ?? "";
  if (!callId || callId.length > 120) return Response.json({ error: "Apel invalid." }, { status: 400 });
  const call = await prisma.pbxCall.findUnique({ where: { callId }, select: { recordingUrl: true } });
  if (!call?.recordingUrl) return Response.json({ error: "Apelul nu are înregistrare." }, { status: 404 });

  let url: URL;
  try {
    url = new URL(call.recordingUrl);
  } catch {
    return Response.json({ error: "Link invalid." }, { status: 400 });
  }
  // Protecție SSRF: doar HTTPS spre domeniul PBX Moldcell.
  if (url.protocol !== "https:" || !(url.hostname === "pbx.moldcell.md" || url.hostname.endsWith(".pbx.moldcell.md"))) {
    return Response.json({ error: "Adresă de înregistrare nepermisă." }, { status: 400 });
  }

  const headers: Record<string, string> = {};
  if (env.pbx.apiKey) headers["X-API-KEY"] = env.pbx.apiKey;
  const range = req.headers.get("range");
  if (range) headers.Range = range;

  let upstream: Response;
  try {
    upstream = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(25_000) });
  } catch (e) {
    console.error("[pbx] înregistrare: conexiune eșuată:", e);
    return Response.json({ error: "Nu am putut contacta PBX-ul." }, { status: 502 });
  }
  if (!upstream.ok && upstream.status !== 206) {
    const hint = upstream.status === 401 || upstream.status === 403 ? " (PBX-ul cere autentificare — setează PBX_API_KEY)" : "";
    return Response.json({ error: `PBX a răspuns ${upstream.status}${hint}.` }, { status: 502 });
  }

  const out = new Headers();
  out.set("Content-Type", upstream.headers.get("content-type") ?? "audio/mpeg");
  for (const h of ["content-length", "content-range", "accept-ranges"]) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  if (!out.has("accept-ranges")) out.set("Accept-Ranges", "bytes");
  out.set("Cache-Control", "private, max-age=3600");
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
