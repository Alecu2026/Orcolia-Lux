import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { placePbxCall } from "@/lib/pbx-api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH = 10;
const MAX_TRIES = 3;
const TZ = "Europe/Chisinau";
/** Apeluri automate doar în program (nu sunăm oamenii noaptea). */
const FROM_HOUR = 8;
const TO_HOUR = 20;

const hourNow = () => Number(new Date().toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false })) % 24;
const errText = (e: unknown) => (e instanceof Error ? e.message : "Eroare necunoscută").slice(0, 200);

/**
 * Sună singur plătitorii rămași în coada de apeluri (/pbx → Notificări apel): cei puși în coadă la care apelul nu a pornit
 * (PBX indisponibil la trimitere, trimiteri mai vechi). Rulează la câteva minute; sună până la 10 pe rând, doar între
 * 08:00 și 20:00 (ora Chișinău), cel mult 3 încercări per rând, prin extensia PBX „robot" (PBX_CALL_USER). Rândurile
 * proaspete (< 3 min) sunt lăsate în pace: trimiterea din pagină le sună ea însăși.
 */
async function run(req: Request) {
  const auth = req.headers.get("authorization");
  const url = new URL(req.url);
  const tokenOk = auth === `Bearer ${env.cronSecret}` || url.searchParams.get("secret") === env.cronSecret;
  if (!env.cronSecret || !tokenOk) return new Response("forbidden", { status: 401 });
  if (!env.pbx.apiKey) return Response.json({ ok: true, skipped: "PBX_API_KEY nesetat" });

  const hour = hourNow();
  if (hour < FROM_HOUR || hour >= TO_HOUR) return Response.json({ ok: true, skipped: `în afara programului (${hour}:00)` });

  const caller = env.pbx.callUser || "robot";
  const started = Date.now();
  const rows = await prisma.notifyCall.findMany({
    where: {
      status: "queued",
      createdAt: { lte: new Date(Date.now() - 3 * 60_000), gte: new Date(Date.now() - 48 * 3_600_000) },
      OR: [{ tries: null }, { tries: { lt: MAX_TRIES } }],
    },
    orderBy: { createdAt: "asc" },
    take: BATCH,
  });

  let dialed = 0;
  let failed = 0;
  for (const r of rows) {
    if (Date.now() - started > 40_000) break; // lăsăm timp să se închidă funcția
    // contorizăm încercarea ÎNAINTE de apel: dacă funcția cade la mijloc, nu sunăm la nesfârșit
    await prisma.notifyCall.update({ where: { id: r.id }, data: { tries: (r.tries ?? 0) + 1 } });
    try {
      const callId = await placePbxCall(r.phone, caller);
      const now = new Date();
      await Promise.all([
        prisma.notifyCall.update({ where: { id: r.id }, data: { status: "dialing", callId, operator: caller, dialedAt: now } }),
        prisma.client.update({ where: { id: r.clientId }, data: { lastNotifiedAt: now } }).catch(() => null),
        prisma.payerNotificationLog
          .create({
            data: {
              campaignId: r.campaignId, clientId: r.clientId, clientName: r.clientName, channel: "CALL", to: r.phone, status: "SENT",
              error: null, subject: `apelant ${caller} (automat)`, body: r.text, userId: r.userId, userName: r.userName,
            },
          })
          .catch(() => null),
      ]);
      dialed++;
    } catch (e) {
      failed++;
      console.error(`[notify-calls] ${r.phone}: ${errText(e)}`);
    }
    await new Promise((res) => setTimeout(res, 1500));
  }
  return Response.json({ ok: true, found: rows.length, dialed, failed });
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
