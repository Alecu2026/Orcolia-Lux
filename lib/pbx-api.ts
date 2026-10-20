import "server-only";
import { env } from "./env";

const TIMEOUT_MS = 15_000;

function headers(): Record<string, string> {
  return { "X-API-KEY": env.pbx.apiKey, "Content-Type": "application/json", Accept: "application/json" };
}

async function detail(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text) as { message?: string; error?: string | { message?: string }; description?: string };
    const e = typeof j.error === "string" ? j.error : j.error?.message;
    return (j.message ?? e ?? j.description ?? text).replace(/\s+/g, " ").slice(0, 160);
  } catch {
    return text.replace(/\s+/g, " ").slice(0, 160);
  }
}

/**
 * Pornește un apel prin PBX Moldcell (POST /makecall): PBX-ul sună ÎNTÂI operatorul `user` (login sau număr scurt), iar
 * când acesta răspunde îl leagă cu `phoneE164`. Returnează id-ul apelului (același `callid` care apare apoi în webhook-ul
 * /api/pbx, deci rezultatul se vede în pagina PBX). Aruncă eroare dacă PBX-ul refuză comanda.
 */
export async function placePbxCall(phoneE164: string, user: string): Promise<string> {
  if (!env.pbx.apiKey) throw new Error("PBX_API_KEY nu este setat.");
  const res = await fetch(`${env.pbx.apiUrl.replace(/\/$/, "")}/makecall`, {
    method: "POST",
    headers: headers(),
    // PBX-ul așteaptă numărul doar cu cifre, cu prefixul țării (ex. 37369123456)
    body: JSON.stringify({ phone: phoneE164.replace(/\D/g, ""), user }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const d = await detail(res);
    const hint = res.status === 401 || res.status === 403 ? " (verifică PBX_API_KEY și drepturile cheii)" : "";
    throw new Error(`PBX ${res.status}${d ? `: ${d}` : ""}${hint}`);
  }
  const j = (await res.json().catch(() => ({}))) as { callid?: string | number };
  if (j.callid == null) throw new Error("PBX nu a întors id-ul apelului.");
  return String(j.callid);
}

export type PbxUser = { login: string; name: string; ext: string | null };

/** Angajații PBX (GET /users) — operatorii care pot primi apelul. */
export async function listPbxUsers(): Promise<PbxUser[]> {
  if (!env.pbx.apiKey) throw new Error("PBX_API_KEY nu este setat.");
  const res = await fetch(`${env.pbx.apiUrl.replace(/\/$/, "")}/users`, { headers: headers(), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`PBX ${res.status}: ${await detail(res)}`);
  const j = (await res.json().catch(() => ({}))) as { items?: { login?: string; name?: string; ext?: string }[] };
  return (j.items ?? [])
    .filter((u): u is { login: string; name?: string; ext?: string } => !!u.login)
    .map((u) => ({ login: u.login, name: u.name || u.login, ext: u.ext || null }));
}
