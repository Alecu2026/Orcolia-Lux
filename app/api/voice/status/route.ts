import { prisma } from "@/lib/prisma";
import { verifyTwilioSignature, voiceStatusUrl } from "@/lib/voice-call";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Ordinea stărilor: un callback întârziat („ringing" după „completed") nu are voie să dea starea înapoi. */
const RANK: Record<string, number> = { queued: 0, initiated: 0, ringing: 1, "in-progress": 2, completed: 3, busy: 3, "no-answer": 3, failed: 3, canceled: 3 };

/**
 * Webhook-ul furnizorului de apeluri (Twilio) — starea unui apel de notificare: sună, a răspuns, încheiat (cu durata),
 * ocupat, fără răspuns. Se acceptă doar mesaje cu semnătură validă.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 32 * 1024) return new Response("too large", { status: 413 });
  const params = Object.fromEntries(new URLSearchParams(raw).entries());
  if (!verifyTwilioSignature(voiceStatusUrl(), params, req.headers.get("x-twilio-signature"))) {
    console.error("[voice] semnătură invalidă pe /api/voice/status (verifică NEXT_PUBLIC_APP_URL și TWILIO_AUTH_TOKEN)");
    return new Response("forbidden", { status: 403 });
  }

  const callSid = params.CallSid;
  const status = (params.CallStatus ?? "").toLowerCase();
  if (!callSid || !(status in RANK)) return new Response("ok");

  // Primul callback poate sosi imediat după plasarea apelului, înainte să fie salvat rândul — așteptăm puțin o dată.
  let row = await prisma.notifyCall.findUnique({ where: { callSid }, select: { id: true, status: true } });
  if (!row) {
    await new Promise((r) => setTimeout(r, 1500));
    row = await prisma.notifyCall.findUnique({ where: { callSid }, select: { id: true, status: true } });
  }
  if (!row) return new Response("ok");

  if ((RANK[status] ?? 0) < (RANK[row.status] ?? 0)) return new Response("ok");
  const dur = Number.parseInt(params.CallDuration ?? "", 10);
  await prisma.notifyCall.update({
    where: { id: row.id },
    data: {
      status,
      ...(status === "in-progress" ? { answeredAt: new Date() } : {}),
      ...(Number.isFinite(dur) ? { durationSec: dur } : {}),
    },
  });
  return new Response("ok");
}
