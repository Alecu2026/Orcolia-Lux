import { prisma } from "@/lib/prisma";
import { resolveVoice, thanksText, verifyTwilioSignature, voiceReplyUrl } from "@/lib/voice-call";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const xml = (body: string) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { headers: { "Content-Type": "text/xml" } });

/**
 * Răspunsul destinatarului la un apel de notificare: ce a spus (transcriere) sau ce tastă a apăsat. Se salvează pe apel și
 * se confirmă vocal. Se acceptă doar mesaje cu semnătură validă.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 32 * 1024) return new Response("too large", { status: 413 });
  const params = Object.fromEntries(new URLSearchParams(raw).entries());
  const voice = resolveVoice(new URL(req.url).searchParams.get("v"));
  if (!verifyTwilioSignature(voiceReplyUrl(voice.id), params, req.headers.get("x-twilio-signature"))) {
    console.error("[voice] semnătură invalidă pe /api/voice/reply (verifică NEXT_PUBLIC_APP_URL și TWILIO_AUTH_TOKEN)");
    return new Response("forbidden", { status: 403 });
  }

  const say = (t: string) => `<Say voice="${voice.id}" language="${voice.lang}">${t.replace(/[<>&]/g, "")}</Say>`;
  const callSid = params.CallSid;
  const speech = (params.SpeechResult ?? "").trim().slice(0, 500);
  const digits = (params.Digits ?? "").replace(/[^0-9*#]/g, "").slice(0, 20);
  if (callSid && (speech || digits)) {
    const row = await prisma.notifyCall.findUnique({ where: { callSid }, select: { id: true } });
    if (row) await prisma.notifyCall.update({ where: { id: row.id }, data: { reply: speech || null, replyDigits: digits || null } });
  }
  return xml(say(thanksText(voice.lang)));
}
