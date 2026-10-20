import "server-only";
import { env } from "./env";
import { gatewayFailure, newSmsId, redactSecret, toLocalMd } from "./sms";

const TIMEOUT_MS = 15_000;

/**
 * Trimite un apel de notificare (robot) către gateway-ul de apeluri: POST JSON { smsid, nr_tel, content, sms_token }, același
 * format ca la SMS (`content` = mesajul de transmis). Numărul se trimite în format local (078446611).
 *
 * Atenție: gateway-ul răspunde 200 și întoarce corpul cererii oricum ar fi (nu validează tokenul și numărul la primire), deci
 * „trimis" înseamnă doar „acceptat de gateway", nu „apelul a avut loc". Un răspuns cu eroare explicită îl tratăm ca eșec.
 * Returnează id-ul cererii (`smsid`) și răspunsul, fără token.
 */
export async function sendCall(toE164: string, text: string): Promise<{ id: string; reply: string }> {
  const { url, token } = env.voice;
  if (!url || !token) throw new Error("Apelurile nu sunt configurate (CALL_HTTP_URL și tokenul).");
  const id = newSmsId();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ smsid: id, nr_tel: toLocalMd(toE164), content: text, sms_token: token }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const raw = redactSecret(await res.text().catch(() => ""), token).replace(/\s+/g, " ").trim();
  if (!res.ok) throw new Error(`Gateway apeluri ${res.status}${raw ? `: ${raw.slice(0, 160)}` : ""}`);
  const bad = gatewayFailure(raw);
  if (bad) throw new Error(`Gateway apeluri a respins cererea: ${bad}`);
  console.log(`[call] ${id} → ${toLocalMd(toE164)}: HTTP ${res.status}`);
  return { id, reply: raw.slice(0, 200) };
}
