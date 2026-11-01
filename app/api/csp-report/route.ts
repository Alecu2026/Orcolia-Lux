import { isRateLimited } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

export const dynamic = "force-dynamic";

/**
 * Primește rapoartele de încălcare CSP trimise de browser (report-uri) și le scrie în jurnalul serverului — ca să se vadă dacă politica blochează ceva legitim.
 * Fără autentificare (browserul nu trimite cookie-uri aici), deci: corp mic, limitat pe IP, nimic nu se salvează în baza de date.
 */
export async function POST(req: Request) {
  const ip = (await clientIp()) ?? "?";
  if (isRateLimited(`csp-report:${ip}`, 30, 60_000)) return new Response(null, { status: 204 });
  try {
    const text = (await req.text()).slice(0, 4000);
    const j = JSON.parse(text) as Record<string, Record<string, unknown>>;
    const r = j["csp-report"] ?? j;
    console.warn(
      "[csp]",
      String(r["violated-directive"] ?? r["effective-directive"] ?? "?"),
      "blocked:",
      String(r["blocked-uri"] ?? "?").slice(0, 200),
      "page:",
      String(r["document-uri"] ?? "?").slice(0, 200),
    );
  } catch {
    /* raport malformat: ignorat */
  }
  return new Response(null, { status: 204 });
}
