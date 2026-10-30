import "server-only";
import { env } from "./env";

/**
 * Adresa la care serverul se poate apela pe el însuși (Chromium deschide paginile de tipărire — factura, decontarea — pe această adresă ca să facă PDF-ul).
 *
 * Adresa publică (NEXT_PUBLIC_APP_URL) nu e mereu accesibilă din interior (NAT / firewall / fără „hairpin”), iar fără INTERNAL_APP_URL setat PDF-ul dădea eroare.
 * Acum se încearcă pe rând, și se păstrează prima care răspunde: INTERNAL_APP_URL, http://127.0.0.1:$PORT, adresa cererii curente, adresa publică.
 */

let good: string | null = null;

async function reachable(base: string): Promise<boolean> {
  try {
    const r = await fetch(`${base}/manifest.webmanifest`, { signal: AbortSignal.timeout(2500), redirect: "manual", cache: "no-store" });
    return r.status < 500;
  } catch {
    return false;
  }
}

export async function selfBaseUrl(requestUrl?: string): Promise<string> {
  if (good) return good;
  const raw = [
    env.internalAppUrl,
    process.env.PORT ? `http://127.0.0.1:${process.env.PORT}` : "",
    requestUrl ? new URL(requestUrl).origin : "",
    env.appUrl,
  ];
  const candidates = [...new Set(raw.map((c) => (c ?? "").replace(/\/$/, "")).filter(Boolean))];
  for (const c of candidates) {
    if (await reachable(c)) {
      good = c;
      return c;
    }
  }
  console.error("[self-url] nicio adresă nu răspunde:", candidates.join(", "), "— setează INTERNAL_APP_URL (ex. http://127.0.0.1:3000)");
  return (env.internalAppUrl || env.appUrl).replace(/\/$/, "");
}
