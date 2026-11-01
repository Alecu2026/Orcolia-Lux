import "server-only";
import { headers } from "next/headers";

/**
 * Adresa clientului, pentru limitarea încercărilor și jurnal. `X-Forwarded-For` poate fi scris de oricine dacă aplicația e expusă direct, așa că nu se ia prima valoare (falsificabilă):
 * se numără de la DREAPTA `TRUSTED_PROXY_HOPS` intrări (implicit 1 = un nginx în fața aplicației, care adaugă adresa reală la sfârșit — vezi `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`).
 * `TRUSTED_PROXY_HOPS=0` = fără proxy: antetul se ignoră. Fără o adresă sigură întoarce null (regulile pe adresă se sar, rămân cele pe cont).
 */
const HOPS = Math.max(0, Number(process.env.TRUSTED_PROXY_HOPS ?? 1));

export async function clientIp(): Promise<string | null> {
  if (HOPS === 0) return null;
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    const i = parts.length - HOPS;
    if (i >= 0 && parts[i]) return parts[i].slice(0, 64);
  }
  const real = h.get("x-real-ip")?.trim();
  return real ? real.slice(0, 64) : null;
}
