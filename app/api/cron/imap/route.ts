import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { pollInbox } from "@/lib/services/imap-poller";
import { withDeliveryMeta } from "@/lib/delivery-log";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function run() {
  const result = await withDeliveryMeta({ source: "cron:imap" }, () => pollInbox());
  return NextResponse.json({ ok: true, ...result, timestamp: new Date().toISOString() });
}

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return run();
}

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return run();
}
