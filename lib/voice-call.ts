import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { DEFAULT_VOICE, NOTIFY_VOICES } from "./payer-notify";

const TIMEOUT_MS = 15_000;

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const base = () => env.appUrl.replace(/\/$/, "");
export const voiceStatusUrl = () => `${base()}/api/voice/status`;
export const voiceReplyUrl = (voiceId: string) => `${base()}/api/voice/reply?v=${encodeURIComponent(voiceId)}`;

export const resolveVoice = (id: string | null | undefined) =>
  NOTIFY_VOICES.find((v) => v.id === id) ?? NOTIFY_VOICES.find((v) => v.id === DEFAULT_VOICE)!;

const THANKS: Record<string, string> = {
  "ro-RO": "Vă mulțumim. La revedere.",
  "ru-RU": "Спасибо. До свидания.",
};
export const thanksText = (lang: string) => THANKS[lang] ?? THANKS["ro-RO"];

/**
 * Sună un număr (E.164, +373…) și redă `text` cu vocea aleasă (Twilio Voice + Google TTS). După mesaj, ascultă ~6 secunde:
 * dacă destinatarul spune ceva sau apasă o tastă, răspunsul ajunge la /api/voice/reply. Starea apelului (sună, răspuns,
 * durată, ocupat…) ajunge la /api/voice/status. Returnează id-ul apelului; aruncă eroare dacă Twilio îl respinge
 * (cont fără credit, număr neacceptat, voce inexistentă…). „Apel trimis" = Twilio a pornit apelul, nu că a și răspuns cineva.
 */
export async function placeVoiceCall(to: string, text: string, voiceId: string): Promise<string> {
  if (!env.voice.enabled) throw new Error("Apelurile nu sunt configurate (TWILIO_* și VOICE_FROM).");
  const voice = resolveVoice(voiceId);
  const sid = env.sms.twilioSid;
  const say = (t: string) => `<Say voice="${voice.id}" language="${voice.lang}">${xmlEscape(t)}</Say>`;
  const twiml =
    `<Response><Pause length="1"/>` +
    `<Gather input="speech dtmf" language="${voice.lang}" speechTimeout="auto" timeout="6" numDigits="1" method="POST" action="${xmlEscape(voiceReplyUrl(voice.id))}">${say(text)}</Gather>` +
    `${say(thanksText(voice.lang))}</Response>`;

  const body = new URLSearchParams({ To: to, From: env.voice.from, Twiml: twiml, StatusCallback: voiceStatusUrl(), StatusCallbackMethod: "POST" });
  for (const ev of ["initiated", "ringing", "answered", "completed"]) body.append("StatusCallbackEvent", ev);

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${env.sms.twilioToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const raw = await res.text().catch(() => "");
  let j: { sid?: string; message?: string } = {};
  try {
    j = JSON.parse(raw);
  } catch {
    // corp non-JSON — rămâne doar codul HTTP
  }
  if (!res.ok) throw new Error(`Twilio ${res.status}${j.message ? `: ${j.message.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
  if (!j.sid) throw new Error("Twilio nu a întors id-ul apelului.");
  console.log(`[voice] ${j.sid} → ${to}: HTTP ${res.status}`);
  return j.sid;
}

/**
 * Verifică semnătura Twilio (X-Twilio-Signature = HMAC-SHA1(token, URL + parametrii sortați)). Fără ea, oricine ar putea
 * trimite „rezultate" false. URL-ul trebuie să fie exact cel dat furnizorului (NEXT_PUBLIC_APP_URL + calea + query).
 */
export function verifyTwilioSignature(url: string, params: Record<string, string>, signature: string | null): boolean {
  const token = env.sms.twilioToken;
  if (!signature || !token) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = Buffer.from(createHmac("sha1", token).update(data).digest("base64"));
  const got = Buffer.from(signature);
  return expected.length === got.length && timingSafeEqual(expected, got);
}
