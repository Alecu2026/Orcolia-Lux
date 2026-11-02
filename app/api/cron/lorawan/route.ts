import { after } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { checkLorawanSchedule, runLorawanSync } from "@/lib/services/lorawan";

export const dynamic = "force-dynamic";
// Câteva mii de contoare: descărcare + salvarea citirilor (zeci de secunde, uneori minute).
export const maxDuration = 300;

/**
 * Extragerea contoarelor LoRaWAN (vezi lib/services/lorawan.ts). Pe un server propriu pornește singură la 23:30 din temporizatorul aplicației; ruta e pentru un scheduler extern
 * (crontab: `0 23 * * * curl -s -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron/lorawan`). Răspunde imediat și lucrează în fundal (serviciile de cron închid conexiunea după ~30 s);
 * pentru un apel care așteaptă rezultatul: `?wait=1`. Pe Vercel: două intrări în vercel.json (20:30 și 21:30 UTC) cu `?daily=1` — una cade la 23:30 ora firmei vara, cealaltă iarna.
 */
async function run(req: Request) {
  if (!isCronAuthorized(req)) return new Response("forbidden", { status: 401 });
  // `?daily=1`: pentru cron-ul Vercel (ora în UTC, fără ora de vară): pornește doar dacă în fusul firmei e după 23:30 și extragerea zilei nu s-a făcut încă
  if (new URL(req.url).searchParams.get("daily") === "1") {
    after(async () => {
      await checkLorawanSchedule();
    });
    return Response.json({ started: true, daily: true });
  }
  if (new URL(req.url).searchParams.get("wait") === "1") return Response.json(await runLorawanSync("cron"));
  after(async () => {
    await runLorawanSync("cron");
  });
  return Response.json({ started: true });
}

export const GET = run;
export const POST = run;
