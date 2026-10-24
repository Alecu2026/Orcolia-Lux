import "server-only";
import { getPayerSnap } from "./payer-cache";

/**
 * Sugestii de adrese din lista plătitorilor (adresa de consum). Lista distinctă de adrese se construiește O SINGURĂ DATĂ per versiune a
 * cache-ului zilnic de plătitori (în memorie, ~19.000 de rânduri → câteva mii de adrese distincte), iar o căutare e doar o trecere prin ea
 * (sub o milisecundă): fără interogări în baza de date la fiecare literă tastată.
 */

type Entry = { a: string; k: string };
const g = globalThis as unknown as { __addrIdx?: { version: string | null; list: Entry[] } };

/** Litere mici, fără diacritice (Ș/ș/Ț/ț/Ă/Â/Î), spațiile unificate: „Ștefan cel Mare" se găsește cu „stefan". */
export function normalizeAddress(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function index(): Promise<Entry[]> {
  const snap = await getPayerSnap();
  const cur = g.__addrIdx;
  if (cur && cur.version === snap.version) return cur.list;
  const seen = new Map<string, string>();
  for (const r of snap.rows) {
    const a = r.consumAddress?.trim();
    if (!a) continue;
    const k = normalizeAddress(a);
    if (!seen.has(k)) seen.set(k, a);
  }
  const list = [...seen].map(([k, a]) => ({ a, k })).sort((x, y) => x.k.localeCompare(y.k));
  g.__addrIdx = { version: snap.version, list };
  return list;
}

/** Cel mult `limit` adrese care conțin toate cuvintele căutate; cele care ÎNCEP cu textul tastat primele. */
export async function searchPayerAddresses(q: string, limit = 8): Promise<string[]> {
  const needle = normalizeAddress(q);
  if (needle.length < 2) return [];
  const tokens = needle.split(" ").filter(Boolean);
  const list = await index();
  const starts: string[] = [];
  const contains: string[] = [];
  for (const e of list) {
    if (!tokens.every((t) => e.k.includes(t))) continue;
    (e.k.startsWith(needle) ? starts : contains).push(e.a);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}
