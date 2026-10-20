import "server-only";
import { env } from "./env";

const TIMEOUT_MS = 15_000;

function headers(): Record<string, string> {
  return { "X-API-KEY": env.pbx.apiKey, "Content-Type": "application/json", Accept: "application/json" };
}

/**
 * fetch către PBX cu eroare lizibilă: „fetch failed" ascunde cauza reală (adresă inexistentă, timeout, certificat…). Dacă PBX-ul
 * nici nu răspunde, de obicei adresa API-ului e greșită sau PBX-ul acceptă conexiuni doar de la anumite adrese IP.
 */
async function pbxFetch(path: string, init: RequestInit = {}, opts: { idempotent?: boolean } = {}): Promise<Response> {
  const url = `${env.pbx.apiUrl.replace(/\/$/, "")}${path}`;
  // Serverul PBX e instabil uneori (același request: 20 ms, apoi 503 sau fără răspuns). O reîncercare scurtă rezolvă de obicei.
  // La citiri reîncercăm orice eșec; la comenzi (makecall) doar un 503 explicit sau o conexiune care nici nu s-a stabilit —
  // altfel riscăm să sunăm de două ori.
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 700));
    try {
      const res = await fetch(url, { ...init, headers: headers(), signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.status === 503 && attempt === 0) { lastError = new Error("PBX 503"); continue; }
      if (opts.idempotent && res.status >= 500 && res.status !== 501 && attempt === 0) { lastError = new Error(`PBX ${res.status}`); continue; }
      return res;
    } catch (e) {
      lastError = e;
      const code = (e as { cause?: { code?: string } }).cause?.code ?? "";
      const notSent = code === "UND_ERR_CONNECT_TIMEOUT" || code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EAI_AGAIN";
      if (!opts.idempotent && !notSent) break;
    }
  }
  const e = lastError as { message?: string; name?: string; cause?: { code?: string; message?: string } };
  if (e?.message?.startsWith("PBX ")) throw new Error(`${e.message}: PBX-ul e temporar indisponibil — încearcă din nou în câteva secunde.`);
  const code = e?.cause?.code ?? (e instanceof DOMException && e.name === "TimeoutError" ? "ETIMEDOUT" : "");
  const host = new URL(url).host;
  const why =
    code === "ENOTFOUND" ? "adresa nu există (verifică PBX_API_URL)"
    : code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT" ? "nu a răspuns la timp — încearcă din nou în câteva secunde (serverul PBX e uneori lent)"
    : code === "ECONNREFUSED" ? "conexiune refuzată (port/adresă greșită)"
    : e?.cause?.message || code || "eroare de rețea";
  throw new Error(`PBX ${host}: ${why}`);
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
  const res = await pbxFetch("/makecall", {
    method: "POST",
    // PBX-ul așteaptă numărul doar cu cifre, cu prefixul țării (ex. 37369123456)
    body: JSON.stringify({ phone: phoneE164.replace(/\D/g, ""), user }),
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
  const res = await pbxFetch("/users", {}, { idempotent: true });
  if (!res.ok) throw new Error(`PBX ${res.status}: ${await detail(res)}`);
  const j = (await res.json().catch(() => ({}))) as { items?: { login?: string; name?: string; ext?: string }[] };
  return (j.items ?? [])
    .filter((u): u is { login: string; name?: string; ext?: string } => !!u.login)
    .map((u) => ({ login: u.login, name: u.name || u.login, ext: u.ext || null }));
}
