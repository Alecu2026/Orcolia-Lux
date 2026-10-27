import { env } from "@/lib/env";
import { processDueReminders } from "@/lib/services/reminders";
import { checkTaskReminders } from "@/lib/services/tasks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Procesează remindere scadente pentru programări (Appointment) ȘI reamintirile sarcinilor / tichetelor (interval fix sau programate la o oră anume):
 * apelat des (la 5–15 minute), ca reamintirile programate să plece la ora aleasă. checkOverdueTasks rulează din /api/cron (o dată pe zi).
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

  const [reminders, taskReminders] = await Promise.all([
    processDueReminders(),
    checkTaskReminders().catch((e) => {
      console.error("[cron/reminders] reamintirile sarcinilor:", e);
      return { checked: 0, notified: 0 };
    }),
  ]);
  return Response.json({ ok: true, reminders, taskReminders });
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
