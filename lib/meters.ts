/**
 * Cod partajat (server + client) pentru pagina /contoare: tuplurile compacte ale snapshot-ului, decodarea lor și motorul de filtrare/sortare
 * care rulează în memorie (în browser, iar la prima afișare și pe server). Fără "server-only" — rulează și în browser.
 *
 * Un rând = UN contor (nu un plătitor): un abonat cu mai multe contoare apare cu toate, iar mai multe contoare de la aceeași adresă
 * rămân rânduri separate (nu se unesc pe adresă).
 */

import type { SnapInvoice } from "./payer-notify";

// ── Filtre ──────────────────────────────────────────────────────────────────────────────────────

export type MeterSort = "" | "contor" | "installDesc" | "installAsc" | "consumDesc" | "consumAsc" | "debtDesc" | "readDesc";

export type MeterFilters = {
  /** Căutare text (toate cuvintele): nr. contor, abonat, cont, contract, adresă, consumator, telefon, email. */
  q: string;
  street: string;
  status: "" | "active" | "removed";
  /** Are (sau nu) citire curentă. */
  reading: "" | "has" | "none";
  consum: "" | "positive" | "zero";
  /** Sursa citirii, exact ca în date (1C: „Источник"; Axioma). */
  sursa: string;
  /** "address" = adrese la care sunt mai multe contoare active; "subscriber" = abonați cu mai multe contoare active. */
  shared: "" | "address" | "subscriber";
  kind: "" | "person" | "company";
  sector: "" | "privat" | "comunal";
  account: "" | "activated" | "pending";
  debt: "" | "has" | "none";
  invoiceStatus: string;
  /** "YYYY-MM-DD" — contor instalat în intervalul acesta (capetele incluse; oricare poate lipsi). */
  installedFrom: string;
  installedTo: string;
  /** Sursa datelor: exportul 1C sau exportul Axioma (contoare fără rând în 1C). */
  source: "" | "1c" | "axioma";
  sort: MeterSort;
};

export const EMPTY_METER_FILTERS: MeterFilters = {
  q: "", street: "", status: "", reading: "", consum: "", sursa: "", shared: "", kind: "", sector: "", account: "", debt: "",
  invoiceStatus: "", installedFrom: "", installedTo: "", source: "", sort: "",
};

const ONE_OF = <T extends string>(v: unknown, allowed: readonly T[]): T | "" =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : "";
const txt = (v: unknown, max = 120): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

type Source = URLSearchParams | Record<string, unknown>;
const get = (src: Source, k: string): unknown => (src instanceof URLSearchParams ? src.get(k) : src[k]);

/** Normalizează orice sursă (URL, localStorage, corp de cerere) la un `MeterFilters` valid — valorile necunoscute dispar. */
export function sanitizeMeterFilters(src: Source): MeterFilters {
  const day = (k: string) => {
    const v = txt(get(src, k), 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
  };
  let installedFrom = day("installedFrom");
  let installedTo = day("installedTo");
  if (installedFrom && installedTo && installedFrom > installedTo) [installedFrom, installedTo] = [installedTo, installedFrom];
  return {
    q: txt(get(src, "q")),
    street: txt(get(src, "street")),
    status: ONE_OF(get(src, "status"), ["active", "removed"] as const),
    reading: ONE_OF(get(src, "reading"), ["has", "none"] as const),
    consum: ONE_OF(get(src, "consum"), ["positive", "zero"] as const),
    sursa: txt(get(src, "sursa"), 60),
    shared: ONE_OF(get(src, "shared"), ["address", "subscriber"] as const),
    kind: ONE_OF(get(src, "kind"), ["person", "company"] as const),
    sector: ONE_OF(get(src, "sector"), ["privat", "comunal"] as const),
    account: ONE_OF(get(src, "account"), ["activated", "pending"] as const),
    debt: ONE_OF(get(src, "debt"), ["has", "none"] as const),
    invoiceStatus: ONE_OF(get(src, "invoiceStatus"), ["DRAFT", "SENT", "PAID", "OVERDUE", "CANCELLED"] as const),
    installedFrom,
    installedTo,
    source: ONE_OF(get(src, "source"), ["1c", "axioma"] as const),
    sort: ONE_OF(get(src, "sort"), ["contor", "installDesc", "installAsc", "consumDesc", "consumAsc", "debtDesc", "readDesc"] as const),
  };
}

/** Câte filtre sunt active (sortarea nu se numără — nu restrânge lista). */
export function countActiveMeterFilters(f: MeterFilters): number {
  return (Object.keys(f) as (keyof MeterFilters)[]).filter((k) => k !== "sort" && f[k]).length;
}

export function meterFiltersToParams(f: MeterFilters, extra: Record<string, string | number> = {}): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
  return p;
}

// ── Tupluri (snapshot) ─────────────────────────────────────────────────────────────────────────

/**
 * Partea „statică" a unui contor (din exportul 1C / Axioma). Indici: 0 id, 1 clientId, 2 nr. contor, 3 abonat, 4 cont personal, 5 contract,
 * 6 adresă, 7 consumator, 8 IDNO, 9 instalat, 10 scos, 11 sigiliu, 12 citire anterioară, 13 data ei, 14 citire curentă, 15 data ei, 16 consum,
 * 17 sursa citirii, 18 apă: volum, 19 apă: sumă, 20 canal: volum, 21 canal: sumă, 22 data documentului 1C, 23 câte contoare active are abonatul,
 * 24 sursa datelor (0 = 1C, 1 = Axioma).
 */
export type MeterStatic = [
  string, string | null, string, string, string | null, string | null,
  string | null, string | null, string | null, string | null, string | null, string | null,
  number | null, string | null, number | null, string | null, number | null,
  string | null, number | null, number | null, number | null, number | null,
  string | null, number, 0 | 1,
];

/**
 * Tuplul trimis browserului = partea statică + datele plătitorului (alipite la servire, din lista de plătitori din memorie):
 * 25 telefon, 26 email, 27 cont portal activat, 28 persoană fizică (are cont personal), 29 nr. factură, 30 status factură,
 * 31 total (de achitat), 32 valută, 33 scadență (ms), 34 sector („Sector privat" / „Sector comunal").
 */
export type MeterTuple = [
  ...MeterStatic,
  string | null, string | null, 0 | 1, 0 | 1,
  string | null, string | null, number | null, string | null, number | null,
  string | null,
];

export type MeterRowBase = {
  id: string;
  clientId: string | null;
  contor: string;
  name: string;
  account: string | null;
  contract: string | null;
  address: string | null;
  consumator: string | null;
  inn: string | null;
  installedAt: string | null;
  removedAt: string | null;
  sigiliu: string | null;
  prev: number | null;
  prevDate: string | null;
  curr: number | null;
  currDate: string | null;
  consum: number | null;
  sursa: string | null;
  apaVol: number | null;
  apaSum: number | null;
  canalVol: number | null;
  canalSum: number | null;
  docDate: string | null;
  /** Câte contoare active are abonatul. */
  meterCount: number;
  source: "1c" | "axioma";
  phone: string | null;
  email: string | null;
  activated: boolean;
  person: boolean;
  invoice: SnapInvoice | null;
  sector: string | null;
};

/**
 * Câmpurile cu „_" sunt PRE-CALCULATE o singură dată la decodare, ca fiecare schimbare de filtru să fie o trecere simplă prin ~25.000 de
 * rânduri cu comparații pe numere: _h = text de căutare, _a = cheia adresei, _ac = câte contoare ACTIVE sunt la adresa asta,
 * _st = sector (0 necunoscut, 1 privat, 2 comunal), _dk = soldul facturii (NaN = fără factură), _ct = consumul (NaN = fără citire).
 */
export type MeterRow = MeterRowBase & { _h: string; _a: string; _ac: number; _st: 0 | 1 | 2; _dk: number; _ct: number };

/** Rândul fără câmpurile de lucru — ce se trimite din server către componentele client. */
export function plainMeter(r: MeterRow): MeterRowBase {
  const { _h, _a, _ac, _st, _dk, _ct, ...base } = r;
  return base;
}

/** Litere mici, fără diacritice, spații unificate: aceeași adresă scrisă ușor diferit ajunge la aceeași cheie. */
export function addressKey(s: string | null | undefined): string {
  if (!s) return "";
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.,;]+/g, " ").replace(/\s+/g, " ").trim();
}

const SECTOR_CODE = (s: string | null): 0 | 1 | 2 => (s === "Sector privat" ? 1 : s === "Sector comunal" ? 2 : 0);
const collatorRo = new Intl.Collator("ro");
const collatorNum = new Intl.Collator("ro", { numeric: true });
const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());

/** Sortarea implicită (aceeași pe server și în browser): abonat A–Z, apoi nr. contor. */
export function sortMeterTuples(tuples: MeterTuple[]): MeterTuple[] {
  return tuples.sort((a, b) => collatorRo.compare(a[3], b[3]) || collatorNum.compare(a[2], b[2]));
}

/** `presorted`: serverul a sortat deja tuplurile (vezi sortMeterTuples). */
export function decodeMeters(tuples: MeterTuple[], presorted = false): MeterRow[] {
  const rows: MeterRow[] = tuples.map((t) => {
    const invoice: SnapInvoice | null =
      t[29] == null
        ? null
        : { number: t[29], status: (t[30] ?? "SENT") as SnapInvoice["status"], grandTotal: t[31] ?? 0, currency: t[32] ?? "MDL", dueDate: iso(t[33]) };
    return {
      id: t[0],
      clientId: t[1],
      contor: t[2],
      name: t[3],
      account: t[4],
      contract: t[5],
      address: t[6],
      consumator: t[7],
      inn: t[8],
      installedAt: t[9],
      removedAt: t[10],
      sigiliu: t[11],
      prev: t[12],
      prevDate: t[13],
      curr: t[14],
      currDate: t[15],
      consum: t[16],
      sursa: t[17],
      apaVol: t[18],
      apaSum: t[19],
      canalVol: t[20],
      canalSum: t[21],
      docDate: t[22],
      meterCount: t[23],
      source: t[24] === 1 ? "axioma" : "1c",
      phone: t[25],
      email: t[26],
      activated: t[27] === 1,
      person: t[28] === 1,
      invoice,
      sector: t[34],
      _h: [t[2], t[3], t[4], t[5], t[6], t[7], t[25], t[26]].filter(Boolean).join("\n").toLowerCase(),
      _a: addressKey(t[6]),
      _ac: 0,
      _st: SECTOR_CODE(t[34]),
      _dk: invoice ? invoice.grandTotal : NaN,
      _ct: t[16] ?? NaN,
    };
  });
  // Câte contoare ACTIVE sunt la fiecare adresă (un contor înlocuit nu face adresa „cu mai multe contoare").
  const perAddress = new Map<string, number>();
  for (const r of rows) if (r._a && !r.removedAt) perAddress.set(r._a, (perAddress.get(r._a) ?? 0) + 1);
  for (const r of rows) r._ac = r._a ? (perAddress.get(r._a) ?? 0) : 0;
  if (!presorted) rows.sort((a, b) => collatorRo.compare(a.name, b.name) || collatorNum.compare(a.contor, b.contor));
  return rows;
}

// ── Sortare: ordinea (indici) se calculează o dată per set de rânduri, nu la fiecare filtru ─────────────

const orderCache = new WeakMap<MeterRow[], Map<string, Uint32Array>>();
function orderFor(rows: MeterRow[], sort: Exclude<MeterSort, "">): Uint32Array {
  let m = orderCache.get(rows);
  if (!m) orderCache.set(rows, (m = new Map()));
  let ord = m.get(sort);
  if (!ord) {
    const idx = Array.from({ length: rows.length }, (_, k) => k);
    // Fără valoare → mereu la final, indiferent de direcție; la egalitate rămâne ordinea alfabetică (stabil).
    const byNum = (get: (r: MeterRow) => number, mul: 1 | -1) =>
      idx.sort((a, b) => {
        const x = get(rows[a]), y = get(rows[b]);
        const xn = Number.isNaN(x), yn = Number.isNaN(y);
        if (xn && yn) return a - b;
        if (xn) return 1;
        if (yn) return -1;
        return (x - y) * mul || a - b;
      });
    const byStr = (get: (r: MeterRow) => string, mul: 1 | -1, numeric = false) =>
      idx.sort((a, b) => {
        const x = get(rows[a]), y = get(rows[b]);
        if (!x && !y) return a - b;
        if (!x) return 1;
        if (!y) return -1;
        const c = numeric ? collatorNum.compare(x, y) : x < y ? -1 : x > y ? 1 : 0;
        return c * mul || a - b;
      });
    if (sort === "debtDesc") byNum((r) => r._dk, -1);
    else if (sort === "consumDesc") byNum((r) => r._ct, -1);
    else if (sort === "consumAsc") byNum((r) => r._ct, 1);
    else if (sort === "installDesc") byStr((r) => r.installedAt ?? "", -1);
    else if (sort === "installAsc") byStr((r) => r.installedAt ?? "", 1);
    else if (sort === "readDesc") byStr((r) => r.currDate ?? "", -1);
    else byStr((r) => r.contor, 1, true); // "contor"
    ord = Uint32Array.from(idx);
    m.set(sort, ord);
  }
  return ord;
}

/** O singură trecere cu comparații pe câmpuri pre-calculate: milisecunde la ~25.000 de rânduri. */
export function filterMeters(allRows: MeterRow[], f: MeterFilters): MeterRow[] {
  const tokens = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  const street = addressKey(f.street);
  const sursa = f.sursa.toLowerCase();
  const sectorCode = f.sector === "privat" ? 1 : f.sector === "comunal" ? 2 : 0;
  const order = f.sort ? orderFor(allRows, f.sort) : null;
  const out: MeterRow[] = [];

  for (let k = 0, n = allRows.length; k < n; k++) {
    const r = order ? allRows[order[k]] : allRows[k];
    if (tokens.length) {
      let ok = true;
      for (const tk of tokens) if (!r._h.includes(tk)) { ok = false; break; }
      if (!ok) continue;
    }
    if (street && !r._a.includes(street)) continue;
    if (f.status === "active" ? r.removedAt != null : f.status === "removed" ? r.removedAt == null : false) continue;
    if (f.reading === "has" ? r.curr == null : f.reading === "none" ? r.curr != null : false) continue;
    if (f.consum === "positive" ? !(r._ct > 0) : f.consum === "zero" ? r._ct !== 0 : false) continue;
    if (sursa && (r.sursa ?? "").toLowerCase() !== sursa) continue;
    if (f.shared === "address" ? r._ac < 2 : f.shared === "subscriber" ? r.meterCount < 2 : false) continue;
    if (f.kind === "person" ? !r.person : f.kind === "company" ? r.person : false) continue;
    if (sectorCode && r._st !== sectorCode) continue;
    if (f.account === "activated" ? !r.activated : f.account === "pending" ? r.activated : false) continue;
    if (f.source === "1c" ? r.source !== "1c" : f.source === "axioma" ? r.source !== "axioma" : false) continue;
    if (f.invoiceStatus && r.invoice?.status !== f.invoiceStatus) continue;
    if (f.debt === "has" ? !(r.invoice && r._dk > 0) : f.debt === "none" ? !(r.invoice && r._dk <= 0) : false) continue;
    if (f.installedFrom && !(r.installedAt && r.installedAt >= f.installedFrom)) continue;
    if (f.installedTo && !(r.installedAt && r.installedAt <= f.installedTo)) continue;
    out.push(r);
  }
  return out;
}

/** Valorile distincte ale „sursei citirii" din date (pentru lista de filtre), cele mai frecvente primele. */
export function distinctSources(rows: MeterRow[]): string[] {
  const c = new Map<string, number>();
  for (const r of rows) if (r.sursa) c.set(r.sursa, (c.get(r.sursa) ?? 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1]).map(([s]) => s);
}
