import { env } from "@/lib/env";
import { processDueReminders } from "@/lib/services/reminders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Procesează remindere scadente pentru programări (Appointment).
 * checkTaskReminders și checkOverdueTasks rulează din /api/cron (o dată pe zi).
 */
async function run(req: Request) {
  const auth = req.headers.get("authorization");
  const url = new URL(req.url);
  const tokenOk =
    auth === `Bearer ${env.cronSecret}` ||
    url.searchParams.get("secret") === env.cronSecret;

  if (!env.cronSecret || !tokenOk) {
    return new Response("forbidden", { status: 401 });
  }

  const reminders = await processDueReminders();
  return Response.json({ ok: true, reminders });
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
