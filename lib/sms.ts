import "server-only";
import { env } from "./env";

const TIMEOUT_MS = 15_000;

/**
 * Trimite un SMS către un număr deja în format E.164 (+373…). Aruncă eroare la eșec — apelantul
 * decide ce face (în /notificari-platitori, eșecul se salvează în jurnal și continuăm cu ceilalți).
 *  - Twilio: TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + SMS_FROM (număr sau nume de expeditor).
 *  - Gateway propriu: POST JSON { to, message, from } la SMS_HTTP_URL, cu `Authorization: Bearer SMS_HTTP_TOKEN`
 *    dacă e setat; orice răspuns 2xx = trimis.
 */
export async function sendSms(to: string, message: string): Promise<void> {
  const provider = env.sms.provider;
  if (!provider) throw new Error("SMS neconfigurat.");

  if (provider === "twilio") {
    const { twilioSid, twilioToken, from } = env.sms;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioSid)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${twilioSid}:${twilioToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: message }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(await errorDetail(res, "Twilio"));
    return;
  }

  const { httpUrl, httpToken, from } = env.sms;

  // Gateway-ul ACC Cahul: corp { smsid, nr_tel, content, sms_token }, număr în format local (078608080), token în corp.
  const accahul = env.sms.httpFormat === "accahul" || (!env.sms.httpFormat && /(^|\.)accahul\.md$/i.test(new URL(httpUrl).hostname));
  if (accahul) {
    const res = await fetch(httpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ smsid: newSmsId(), nr_tel: toLocalMd(to), content: message, sms_token: httpToken }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(await errorDetail(res, "Gateway SMS"));
    return;
  }

  const res = await fetch(httpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(httpToken ? { Authorization: `Bearer ${httpToken}` } : {}),
    },
    body: JSON.stringify({ to, message, from: from || undefined }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(await errorDetail(res, "Gateway SMS"));
}

/** +37378608080 → 078608080 (formatul local moldovenesc cerut de gateway); alte țări rămân doar cifre. */
function toLocalMd(e164: string): string {
  const d = e164.replace(/\D/g, "");
  return d.startsWith("373") && d.length === 11 ? `0${d.slice(3)}` : d;
}

/** Id unic al mesajului (16 caractere A–Z0–9), ca să-l putem găsi în jurnalul gateway-ului. */
function newSmsId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "";
  for (const b of crypto.getRandomValues(new Uint8Array(16))) id += chars[b % chars.length];
  return id;
}

async function errorDetail(res: Response, who: string): Promise<string> {
  let detail = "";
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text) as { message?: string; error?: string };
      detail = j.message ?? j.error ?? "";
    } catch {
      detail = text;
    }
  } catch {
    // corp ilizibil — rămâne doar codul HTTP
  }
  return `${who} ${res.status}${detail ? `: ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`;
}
