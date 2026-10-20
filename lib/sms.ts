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
export async function sendSms(to: string, message: string): Promise<string | void> {
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
    if (!httpToken) throw new Error("Lipsește tokenul SMS (variabila sms_token / SMS_TOKEN din Vercel) — redeploy după ce o adaugi.");
    const smsid = newSmsId();
    const res = await fetch(httpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ smsid, nr_tel: toLocalMd(to), content: message, sms_token: httpToken }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.clone().text().catch(() => "");
    if (!res.ok) throw new Error(await errorDetail(res, "Gateway SMS"));
    // Un 200 nu înseamnă „trimis": multe gateway-uri răspund 200 și raportează eroarea în corp (token greșit, număr respins).
    const bad = gatewayFailure(text);
    if (bad) throw new Error(`Gateway SMS a respins mesajul: ${bad}`);
    const reply = text.replace(/\s+/g, " ").trim().slice(0, 200);
    console.log(`[sms] ${smsid} → ${toLocalMd(to)}: HTTP ${res.status} ${reply}`);
    return reply;
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

/** Eroarea raportată de gateway într-un răspuns 2xx (JSON cu error/success:false/status:"error…" sau text cu „eroare/invalid/token…"), altfel null. */
function gatewayFailure(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const badWord = /err|fail|reject|invalid|denied|unauthori|forbidden|eroare|gresit|greșit|nu a fost/i;
  try {
    const j = JSON.parse(t) as Record<string, unknown>;
    if (j && typeof j === "object") {
      const msg = String(j.message ?? j.error ?? j.status ?? j.result ?? "").slice(0, 160);
      if (j.success === false || j.ok === false) return msg || t.slice(0, 160);
      if (j.error) return msg || t.slice(0, 160);
      if (typeof j.status === "string" && badWord.test(j.status)) return msg;
      return null;
    }
  } catch {
    // nu e JSON — verificăm textul simplu
  }
  return badWord.test(t) ? t.replace(/\s+/g, " ").slice(0, 160) : null;
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
