import { after } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { runLorawanSync } from "@/lib/services/lorawan";

export const dynamic = "force-dynamic";
// Câteva mii de contoare: descărcare + salvarea citirilor (zeci de secunde, uneori minute).
export const maxDuration = 300;

/**
 * Extragerea contoarelor LoRaWAN (vezi lib/services/lorawan.ts). Pe un server propriu pornește singură la 23:30 din temporizatorul aplicației; ruta e pentru un scheduler extern
 * (crontab: `0 23 * * * curl -s -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron/lorawan`). Răspunde imediat și lucrează în fundal (serviciile de cron închid conexiunea după ~30 s);
 * pentru un apel care așteaptă rezultatul: `?wait=1`.
 */
async function run(req: Request) {
  if (!isCronAuthorized(req)) return new Response("forbidden", { status: 401 });
  if (new URL(req.url).searchParams.get("wait") === "1") return Response.json(await runLorawanSync("cron"));
  after(async () => {
    await runLorawanSync("cron");
  });
  return Response.json({ started: true });
}

export const GET = run;
export const POST = run;
