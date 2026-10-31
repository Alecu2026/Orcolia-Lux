// Tabelul 1C (Plătitori → Tabel 1C): tuplul compact din snapshot și motorul de filtrare / sortare / totaluri care rulează în browser (cod partajat server / browser).
// Un rând = un abonat (luna cea mai recentă) sau un abonat într-o lună; filtrele au aceeași semantică ca cele din baza de date (vezi lib/queries/onec.ts), dar rulează în memorie.

import { ONEC_COLUMNS } from "./apa-canal-1c";

/** Ordinea valorilor într-un tuplu: id, clientId, nr. factură, apoi coloanele 1C (ONEC_COLUMNS), apoi total PWA, diferență, token factură. */
export type OneCTuple = (string | number | null)[];

export const HEAD = 3; // id, clientId, invoiceNumber
export const IDX = Object.fromEntries(ONEC_COLUMNS.map((c, i) => [c.key, HEAD + i])) as Record<string, number>;
export const IDX_PWA_TOTAL = HEAD + ONEC_COLUMNS.length;
export const IDX_DIFF = IDX_PWA_TOTAL + 1;
export const IDX_TOKEN = IDX_PWA_TOTAL + 2;
export const TOLERANCE = 0.011;

export type OneCPayload = { v: 1; rows: OneCTuple[]; months: { month: string; count: number }[] };

/** Filtru numeric: `>100`, `>=100`, `<5`, `<=5`, `=45.3`, `10-20` (interval) sau `45.3` (egal ±0,005). Null = text invalid (filtrul se ignoră). */
export function numericPredicate(raw: string): ((n: number) => boolean) | null {
  const s = raw.replace(/\s+/g, "").replace(/,/g, ".");
  let m = s.match(/^(>=|<=|>|<|=)(-?\d+(?:\.\d+)?)$/);
  if (m) {
    const n = Number(m[2]);
    if (m[1] === ">") return (x) => x > n;
    if (m[1] === ">=") return (x) => x >= n;
    if (m[1] === "<") return (x) => x < n;
    if (m[1] === "<=") return (x) => x <= n;
    return (x) => x >= n - 0.005 && x <= n + 0.005;
  }
  m = s.match(/^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/);
  if (m) {
    const lo = Number(m[1]), hi = Number(m[2]);
    return (x) => x >= lo && x <= hi;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(s)) {
    const n = Number(s);
    return (x) => x >= n - 0.005 && x <= n + 0.005;
  }
  return null;
}

const collator = new Intl.Collator("ro");
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// text cu litere mici, pe coloană, calculat o singură dată per set de rânduri (la prima folosire a coloanei într-un filtru)
const lowerCache = new WeakMap<OneCTuple[], Map<number, string[]>>();
function lowerCol(rows: OneCTuple[], ci: number): string[] {
  let m = lowerCache.get(rows);
  if (!m) lowerCache.set(rows, (m = new Map()));
  let a = m.get(ci);
  if (!a) {
    a = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) { const v = rows[i][ci]; a[i] = v == null ? "" : String(v).toLowerCase(); }
    m.set(ci, a);
  }
  return a;
}

// ordinea sortată (indici) pe (coloană, direcție): se calculează o dată per set de rânduri, nu la fiecare filtru
const orderCache = new WeakMap<OneCTuple[], Map<string, Uint32Array>>();
function orderFor(rows: OneCTuple[], key: string, dir: "asc" | "desc"): Uint32Array {
  let m = orderCache.get(rows);
  if (!m) orderCache.set(rows, (m = new Map()));
  const ck = `${key}|${dir}`;
  let ord = m.get(ck);
  if (!ord) {
    const col = ONEC_COLUMNS.find((c) => c.key === key) ?? ONEC_COLUMNS[1];
    const ci = IDX[col.key];
    const uidI = IDX.uid;
    const mul = dir === "asc" ? 1 : -1;
    const idx = Array.from({ length: rows.length }, (_, i) => i);
    // aceeași ordine ca pe server: valorile lipsă primele la crescător; la egalitate, după UID
    idx.sort((x, y) => {
      const a = rows[x][ci], b = rows[y][ci];
      let c: number;
      if (a == null && b == null) c = 0;
      else if (a == null) c = -1;
      else if (b == null) c = 1;
      else c = col.type === "num" ? Number(a) - Number(b) : collator.compare(String(a), String(b));
      return c * mul || collator.compare(String(rows[x][uidI]), String(rows[y][uidI]));
    });
    ord = Uint32Array.from(idx);
    m.set(ck, ord);
  }
  return ord;
}

export type OneCFilterOpts = { filters: Record<string, string>; onlyDiff: boolean; sort: string; dir: "asc" | "desc" };
export type OneCResult = { idx: Uint32Array; total: number; sums: { calculat: number; datorieAvans: number; deAchitat: number } };

/** O singură trecere, în ordinea cerută, cu predicate pe coloanele filtrate; totalurile se calculează pe rândurile rămase. */
export function filterOneC(rows: OneCTuple[], o: OneCFilterOpts): OneCResult {
  const checks: ((i: number) => boolean)[] = [];
  for (const [key, raw] of Object.entries(o.filters)) {
    const value = raw.trim();
    const col = ONEC_COLUMNS.find((c) => c.key === key);
    if (!value || !col) continue;
    const ci = IDX[key];
    if (col.type === "num") {
      const pred = numericPredicate(value);
      if (!pred) continue; // text invalid: filtrul se ignoră, nu golește lista
      checks.push((i) => { const v = rows[i][ci]; return v != null && pred(Number(v)); });
    } else {
      const needle = value.toLowerCase();
      const lower = lowerCol(rows, ci);
      checks.push((i) => lower[i].includes(needle));
    }
  }
  if (o.onlyDiff) {
    // abonații la care „De achitat” din 1C diferă de totalul facturii din PWA (sau factura lipsește din PWA); doar cei cu număr de factură
    const inv = HEAD - 1, de = IDX.deAchitat;
    checks.push((i) => {
      const num = rows[i][inv];
      if (!num) return false;
      const pwa = rows[i][IDX_PWA_TOTAL];
      return pwa == null || Math.abs(Number(pwa) - (Number(rows[i][de]) || 0)) > TOLERANCE;
    });
  }
  const order = orderFor(rows, o.sort, o.dir);
  const out: number[] = [];
  let calc = 0, dat = 0, dea = 0;
  const ic = IDX.calculat, id = IDX.datorieAvans, ia = IDX.deAchitat;
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    let ok = true;
    for (let c = 0; c < checks.length; c++) if (!checks[c](i)) { ok = false; break; }
    if (!ok) continue;
    out.push(i);
    calc += Number(rows[i][ic]) || 0;
    dat += Number(rows[i][id]) || 0;
    dea += Number(rows[i][ia]) || 0;
  }
  return { idx: Uint32Array.from(out), total: out.length, sums: { calculat: round2(calc), datorieAvans: round2(dat), deAchitat: round2(dea) } };
}
