import "server-only";
import { timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Autorizarea joburilor programate (cron): `Authorization: Bearer <CRON_SECRET>` — așa trimite Vercel Cron — sau `?secret=<CRON_SECRET>`
 * (pentru un scheduler propriu, ex. `curl` din crontab). Fără CRON_SECRET setat, nimeni nu e autorizat: altfel oricine de pe internet
 * ar putea porni joburile (notificări, remindere, citirea căsuței de email).
 */
export function isCronAuthorized(req: Request): boolean {
  const secret = env.cronSecret;
  if (!secret) return false;
  const header = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const query = new URL(req.url).searchParams.get("secret") ?? "";
  const same = (given: string) => {
    const a = Buffer.from(given);
    const b = Buffer.from(secret);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  return (header !== "" && same(header)) || (query !== "" && same(query));
}
