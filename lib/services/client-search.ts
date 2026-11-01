import "server-only";
import { prisma } from "../prisma";
import { clientSearchEpoch } from "../lookup-memory";

/**
 * Căutarea de clienți după nume / telefon (autocomplete din formulare, botul Telegram) pe un index în memoria serverului, nu în baza de date: interogarea veche (`contains`, fără diferență
 * de majuscule, pe nume SAU telefon) nu poate folosi niciun index și parcurge TOȚI clienții (și plătitorii — ~190.000) la fiecare tastă apăsată.
 *
 * Indexul = (id, nume, nume cu litere mici, telefon), sortat după nume (aceeași ordine ca `orderBy name asc`), deci primele 8 potriviri în ordine sunt exact rezultatul interogării vechi, iar
 * parcurgerea se oprește la a 8-a. Un client creat / șters / redenumit (sau cu telefon schimbat) prin aplicație invalidează indexul (`clientSearchEpoch`, extensia Prisma din lib/prisma.ts); între
 * invalidare și terminarea reconstruirii căutarea întoarce `null` și apelantul folosește interogarea din baza de date — niciodată un rezultat vechi. Scrierile obișnuite (ultima programare,
 * absențe) nu invalidează nimic. Reconstruirea rulează în fundal (cel mult o dată la `MIN_REBUILD_MS`); la scrieri făcute direct în bază / alt proces, indexul se reface cel târziu la `MAX_AGE_MS`.
 */
const MAX_AGE_MS = 5 * 60_000;
const MIN_REBUILD_MS = 15_000;

type Index = { builtAt: number; epoch: number; ids: string[]; names: string[]; lower: string[]; phones: string[] };
type State = { idx: Index | null; building: Promise<void> | null; lastStart: number };
const g = globalThis as unknown as { __clientSearch?: State };
const S: State = (g.__clientSearch ??= { idx: null, building: null, lastStart: 0 });

async function build(): Promise<void> {
  const t0 = Date.now();
  const epoch = clientSearchEpoch();
  const rows = await prisma.client.findMany({ select: { id: true, name: true, phone: true } });
  // aceeași ordine ca MongoDB (comparare pe octeți UTF-8 ≈ pe unități UTF-16 pentru textul obișnuit)
  rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const idx: Index = {
    builtAt: t0,
    epoch,
    ids: rows.map((r) => r.id),
    names: rows.map((r) => r.name),
    lower: rows.map((r) => r.name.toLowerCase()),
    phones: rows.map((r) => r.phone ?? ""),
  };
  S.idx = idx;
  console.log(`[client-search] index reconstruit: ${rows.length} clienți, ${Date.now() - t0} ms`);
}

function startBuild(): void {
  if (S.building) return;
  S.lastStart = Date.now();
  S.building = build()
    .catch((e) => console.error("[client-search] reconstruire eșuată:", String(e?.message ?? e).slice(0, 200)))
    .finally(() => {
      S.building = null;
    });
}

/**
 * Primele `limit` potriviri (nume conține textul, fără diferență de majuscule, SAU telefon îl conține), în ordinea numelui; `null` dacă indexul nu e (încă) la zi — atunci se folosește baza de date.
 */
export function searchClientIndex(q: string, limit: number): { id: string; name: string; phone: string | null }[] | null {
  const cur = S.idx;
  const fresh = !!cur && cur.epoch === clientSearchEpoch() && Date.now() - cur.builtAt < MAX_AGE_MS;
  if (!fresh && Date.now() - S.lastStart >= MIN_REBUILD_MS) startBuild();
  if (!fresh || !cur) return null;
  const needle = q.toLowerCase();
  const out: { id: string; name: string; phone: string | null }[] = [];
  const { lower, phones } = cur;
  for (let i = 0; i < lower.length && out.length < limit; i++) {
    if (lower[i].includes(needle) || (phones[i] !== "" && phones[i].includes(q))) out.push({ id: cur.ids[i], name: cur.names[i], phone: phones[i] === "" ? null : phones[i] });
  }
  return out;
}
