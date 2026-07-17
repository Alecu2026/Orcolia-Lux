import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { pollInbox } from "@/lib/services/imap-poller";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function run() {
  const result = await pollInbox();
  return NextResponse.json({ ok: true, ...result, timestamp: new Date().toISOString() });
}

export async function GET(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret") ?? "";
  if (env.cronSecret && secret !== env.cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run();
}

export async function POST() {
  return run();
}
