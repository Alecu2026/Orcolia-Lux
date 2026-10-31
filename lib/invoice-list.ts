/**
 * Lista de facturi — motor local, același tipar ca la plătitori (vezi lib/payer-notify.ts): serverul trimite facturile ca tupluri compacte (comprimat gzip, cu ETag),
 * iar filtrarea / sortarea / totalurile rulează în browser — fără interogări la fiecare schimbare de filtru. Partajat între server și browser; fără dependențe de server.
 *
 * Volumul real e de sute de mii de facturi (o factură pe plătitor pe lună), deci lista NU se trimite întreagă: se împarte pe LUNA EMITERII (fusul Europe/Bucharest).
 * Browserul ține în memorie doar perioada aleasă (o lună ≈ 19.000 de facturi, câteva luni cel mult `LOCAL_MAX_ROWS`); căutările peste „toate lunile" rulează pe server.
 */

export const INVOICE_STATUS_CODES = ["DRAFT", "SENT", "PAID", "CANCELLED", "OVERDUE"] as const;
export type InvoiceStatusName = (typeof INVOICE_STATUS_CODES)[number];

/**
 * O factură în snapshot, ca tuplu (mai puțin JSON): [id, număr, status (index în INVOICE_STATUS_CODES), tip (0 standard / 1 Apă-Canal),
 * emisă ms, scadentă ms | null, achitată ms | null, total, valută, nume client | null, cod public, text suplimentar de căutare | null].
 * Ordinea din snapshot = ordinea listei (cele mai noi create primele).
 */
export type InvTuple = [
  id: string, number: string, status: number, kind: 0 | 1,
  issueMs: number, dueMs: number | null, paidMs: number | null,
  total: number, currency: string, clientName: string | null, token: string, extra: string | null,
];

/** Un rând decodat. `_h` = text de căutare (minuscule): număr, client, consumator, cont personal. */
export type InvRow = {
  id: string;
  number: string;
  status: InvoiceStatusName;
  kind: "STANDARD" | "APA_CANAL";
  issueMs: number;
  dueMs: number | null;
  paidMs: number | null;
  grandTotal: number;
  currency: string;
  clientName: string | null;
  publicToken: string;
  /** Text suplimentar de căutare (consumator + cont personal), păstrat ca să se poată re-codifica snapshot-ul după o modificare locală. */
  _x: string | null;
  _h: string;
};

/** Inversul lui decodeInvoices: tuplurile pentru browser, după ce s-au modificat rânduri în memoria serverului. */
export function encodeInvoices(rows: InvRow[]): InvTuple[] {
  return rows.map((r): InvTuple => [
    r.id, r.number, Math.max(0, INVOICE_STATUS_CODES.indexOf(r.status)), r.kind === "APA_CANAL" ? 1 : 0, r.issueMs, r.dueMs, r.paidMs,
    r.grandTotal, r.currency, r.clientName, r.publicToken, r._x,
  ]);
}

export function decodeInvoices(tuples: InvTuple[]): InvRow[] {
  const rows: InvRow[] = new Array(tuples.length);
  for (let i = 0; i < tuples.length; i++) {
    const t = tuples[i];
    rows[i] = {
      id: t[0],
      number: t[1],
      status: INVOICE_STATUS_CODES[t[2]] ?? "DRAFT",
      kind: t[3] === 1 ? "APA_CANAL" : "STANDARD",
      issueMs: t[4],
      dueMs: t[5],
      paidMs: t[6],
      grandTotal: t[7],
      currency: t[8],
      clientName: t[9],
      publicToken: t[10],
      _x: t[11],
      _h: (t[1] + "\n" + (t[9] ?? "") + "\n" + (t[11] ?? "")).toLowerCase(),
    };
  }
  return rows;
}

// ───────────────────────────── timp: ziua / luna în fusul Europe/Bucharest ─────────────────────────────

const lastSundayUtc = (y: number, m0: number): number => {
  const last = new Date(Date.UTC(y, m0 + 1, 0));
  return Date.UTC(y, m0, last.getUTCDate() - last.getUTCDay(), 1); // ora 01:00 UTC, ultima duminică din lună (schimbarea orei, regula UE)
};
const dstWindows = new Map<number, [number, number]>();
/** Decalajul față de UTC al României la momentul `ms` (+2 h iarna, +3 h vara). */
export function bucharestOffsetMs(ms: number): number {
  const y = new Date(ms).getUTCFullYear();
  let w = dstWindows.get(y);
  if (!w) dstWindows.set(y, (w = [lastSundayUtc(y, 2), lastSundayUtc(y, 9)]));
  return ms >= w[0] && ms < w[1] ? 3 * 3_600_000 : 2 * 3_600_000;
}
/** Numărul zilei (de la 1970) în ora României — comparabil cu `dayOfKey`. */
export const localDay = (ms: number): number => Math.floor((ms + bucharestOffsetMs(ms)) / 86_400_000);
/** „AAAA-LL-ZZ" → numărul zilei; null dacă nu e dată validă. */
export function dayOfKey(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? Math.floor(t / 86_400_000) : null;
}
/** Luna („AAAA-LL") în care cade momentul, în ora României. */
export const monthOf = (ms: number): string => new Date(ms + bucharestOffsetMs(ms)).toISOString().slice(0, 7);
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Începutul (inclusiv) și sfârșitul (exclusiv) lunii, în ms UTC, la miezul nopții României. Schimbarea orei nu cade niciodată pe 1 a lunii. */
export function monthBoundsMs(month: string): [number, number] {
  const [y, m] = month.split("-").map(Number);
  const a = Date.UTC(y, m - 1, 1);
  const b = Date.UTC(y, m, 1);
  return [a - bucharestOffsetMs(a), b - bucharestOffsetMs(b)];
}

// ───────────────────────────── perioade ─────────────────────────────

/** Câte facturi poate ține browserul în memorie deodată (≈ 6 luni cu 19.000 de plătitori); peste, căutarea rulează pe server. */
export const LOCAL_MAX_ROWS = Math.max(1000, Number(process.env.NEXT_PUBLIC_INVOICE_LOCAL_MAX) || 120_000);
export type MonthCount = { month: string; count: number };

/** Perioade: o lună („AAAA-LL"), „last3" (ultimele 3 luni cu facturi), „year:AAAA", „all". */
export function periodMonths(period: string, months: MonthCount[]): string[] {
  if (period === "all") return months.map((m) => m.month);
  if (period === "last3") return months.slice(0, 3).map((m) => m.month);
  if (period.startsWith("year:")) return months.filter((m) => m.month.startsWith(period.slice(5) + "-")).map((m) => m.month);
  return MONTH_RE.test(period) ? [period] : [];
}
export function isValidPeriod(period: string): boolean {
  return period === "all" || period === "last3" || MONTH_RE.test(period) || /^year:\d{4}$/.test(period);
}
/** Perioada se poate ține local (în browser)? Altfel facturile se aduc pe pagini de pe server. */
export function periodFitsLocally(period: string, months: MonthCount[]): boolean {
  const want = new Set(periodMonths(period, months));
  let n = 0;
  for (const m of months) if (want.has(m.month)) n += m.count;
  return n <= LOCAL_MAX_ROWS;
}
/**
 * Perioada de pornire: cea cerută; altfel, cât timp toate facturile încap local (instalații mici) → „toate”, altfel luna cea mai recentă.
 * Fără facturi → „all”.
 */
export function defaultPeriod(requested: string | null | undefined, months: MonthCount[]): string {
  if (requested && isValidPeriod(requested)) return requested;
  if (months.length === 0) return "all";
  return periodFitsLocally("all", months) ? "all" : months[0].month;
}

// ───────────────────────────── filtre ─────────────────────────────

export type InvKind = "" | "APA_CANAL" | "STANDARD";
export type InvQuick = "" | "unpaid" | "overdue" | "nodue" | "paidnodate";
export type InvSort = "" | "number" | "client" | "issue" | "due" | "paid" | "total" | "status";

export type InvQuery = {
  /** Text: cuvintele (separate prin spațiu) trebuie să apară TOATE în număr / client / consumator / cont personal. */
  q: string;
  /** Statusuri permise; gol = toate. */
  statuses: string[];
  kind: InvKind;
  /** Scurtături: neachitate (nici achitate, nici anulate), restante (neachitate cu scadența trecută), fără scadență, achitate fără dată. */
  quick: InvQuick;
  /** Sumă minimă / maximă (cu virgulă sau punct). */
  min: string;
  max: string;
  currency: string;
  /** Intervale de date „AAAA-LL-ZZ" (în ora României), pe emitere / scadență / achitare. */
  issueFrom: string; issueTo: string;
  dueFrom: string; dueTo: string;
  paidFrom: string; paidTo: string;
  sort: InvSort;
  dir: "asc" | "desc";
};

export const EMPTY_QUERY: InvQuery = {
  q: "", statuses: [], kind: "", quick: "", min: "", max: "", currency: "",
  issueFrom: "", issueTo: "", dueFrom: "", dueTo: "", paidFrom: "", paidTo: "", sort: "", dir: "desc",
};

/** Câte filtre sunt active (fără sortare). */
export function activeFilterCount(q: InvQuery): number {
  let n = 0;
  if (q.q.trim()) n++;
  if (q.statuses.length) n++;
  if (q.kind) n++;
  if (q.quick) n++;
  if (q.min.trim() || q.max.trim()) n++;
  if (q.currency) n++;
  if (q.issueFrom || q.issueTo) n++;
  if (q.dueFrom || q.dueTo) n++;
  if (q.paidFrom || q.paidTo) n++;
  return n;
}

const num = (s: string): number | null => {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export type InvSums = {
  count: number;
  /** Valuta principală a rezultatelor (cea mai frecventă); sumele de mai jos sunt doar în ea. */
  currency: string;
  mixedCurrency: boolean;
  /** Σ facturi neanulate. */
  total: number;
  /** Σ achitate. */
  paid: number;
  /** Σ neachitate (nici achitate, nici anulate). */
  open: number;
  /** Din care cu scadența trecută. */
  overdue: number;
  overdueCount: number;
};

const collator = new Intl.Collator("ro", { numeric: true, sensitivity: "base" });
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ordinea sortată (indici) pe (coloană, direcție): se calculează o dată per set de rânduri, nu la fiecare filtru; valorile lipsă rămân mereu la sfârșit
const orderCache = new WeakMap<InvRow[], Map<string, Uint32Array>>();
function sortOrder(rows: InvRow[], sort: InvSort, dir: "asc" | "desc"): Uint32Array | null {
  if (!sort) return null;
  let m = orderCache.get(rows);
  if (!m) orderCache.set(rows, (m = new Map()));
  const ck = sort + dir;
  let ord = m.get(ck);
  if (ord) return ord;
  const n = rows.length;
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  const sign = dir === "asc" ? 1 : -1;
  const numKey = (r: InvRow): number | null =>
    sort === "issue" ? r.issueMs : sort === "due" ? r.dueMs : sort === "paid" ? r.paidMs : sort === "total" ? r.grandTotal : sort === "status" ? INVOICE_STATUS_CODES.indexOf(r.status) : null;
  if (sort === "number" || sort === "client") {
    const key = (r: InvRow): string | null => (sort === "number" ? r.number : r.clientName);
    idx.sort((a, b) => {
      const x = key(rows[a]), y = key(rows[b]);
      if (x == null || y == null) return x == null ? (y == null ? a - b : 1) : -1;
      return sign * collator.compare(x, y) || a - b;
    });
  } else {
    idx.sort((a, b) => {
      const x = numKey(rows[a]), y = numKey(rows[b]);
      if (x == null || y == null) return x == null ? (y == null ? a - b : 1) : -1;
      return x === y ? a - b : sign * (x < y ? -1 : 1);
    });
  }
  m.set(ck, (ord = idx));
  return ord;
}

/**
 * Filtrează + sortează + totalizează într-o singură trecere (milisecunde la zeci de mii de facturi). `idx` = pozițiile rândurilor care trec de filtre, în ordinea cerută.
 * Fără sortare explicită rămâne ordinea din snapshot (cele mai noi create primele).
 */
export function queryInvoices(rows: InvRow[], f: InvQuery, nowMs: number = Date.now()): { idx: Uint32Array; total: number; sums: InvSums } {
  const tokens = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const statuses = f.statuses.length ? new Set(f.statuses) : null;
  const min = num(f.min), max = num(f.max);
  const dIssueA = dayOfKey(f.issueFrom), dIssueB = dayOfKey(f.issueTo);
  const dDueA = dayOfKey(f.dueFrom), dDueB = dayOfKey(f.dueTo);
  const dPaidA = dayOfKey(f.paidFrom), dPaidB = dayOfKey(f.paidTo);
  const order = sortOrder(rows, f.sort, f.dir);
  const n = rows.length;
  const out = new Uint32Array(n);
  let cnt = 0;
  const byCur = new Map<string, { n: number; total: number; paid: number; open: number; overdue: number; overdueN: number }>();

  for (let k = 0; k < n; k++) {
    const i = order ? order[k] : k;
    const r = rows[i];
    if (statuses && !statuses.has(r.status)) continue;
    if (f.kind && r.kind !== f.kind) continue;
    if (f.currency && r.currency !== f.currency) continue;
    const unpaid = r.status !== "PAID" && r.status !== "CANCELLED";
    if (f.quick) {
      if (f.quick === "unpaid" && !unpaid) continue;
      if (f.quick === "overdue" && !(unpaid && r.dueMs != null && r.dueMs < nowMs)) continue;
      if (f.quick === "nodue" && r.dueMs != null) continue;
      if (f.quick === "paidnodate" && !(r.status === "PAID" && r.paidMs == null)) continue;
    }
    if (min != null && r.grandTotal < min) continue;
    if (max != null && r.grandTotal > max) continue;
    if (dIssueA != null || dIssueB != null) {
      const d = localDay(r.issueMs);
      if ((dIssueA != null && d < dIssueA) || (dIssueB != null && d > dIssueB)) continue;
    }
    if (dDueA != null || dDueB != null) {
      if (r.dueMs == null) continue;
      const d = localDay(r.dueMs);
      if ((dDueA != null && d < dDueA) || (dDueB != null && d > dDueB)) continue;
    }
    if (dPaidA != null || dPaidB != null) {
      if (r.paidMs == null) continue;
      const d = localDay(r.paidMs);
      if ((dPaidA != null && d < dPaidA) || (dPaidB != null && d > dPaidB)) continue;
    }
    if (tokens.length) {
      let all = true;
      for (let t = 0; t < tokens.length; t++) if (!r._h.includes(tokens[t])) { all = false; break; }
      if (!all) continue;
    }
    out[cnt++] = i;
    let c = byCur.get(r.currency);
    if (!c) byCur.set(r.currency, (c = { n: 0, total: 0, paid: 0, open: 0, overdue: 0, overdueN: 0 }));
    c.n++;
    if (r.status !== "CANCELLED") c.total += r.grandTotal;
    if (r.status === "PAID") c.paid += r.grandTotal;
    if (unpaid) {
      c.open += r.grandTotal;
      if (r.dueMs != null && r.dueMs < nowMs) { c.overdue += r.grandTotal; c.overdueN++; }
    }
  }
  let main = "MDL", mainN = -1;
  for (const [cur, c] of byCur) if (c.n > mainN) { main = cur; mainN = c.n; }
  const c = byCur.get(main);
  return {
    idx: out.subarray(0, cnt),
    total: cnt,
    sums: {
      count: cnt, currency: main, mixedCurrency: byCur.size > 1,
      total: round2(c?.total ?? 0), paid: round2(c?.paid ?? 0), open: round2(c?.open ?? 0), overdue: round2(c?.overdue ?? 0), overdueCount: c?.overdueN ?? 0,
    },
  };
}

/** Forma pe care o primește tabelul (date ca ISO, ca să rămână serializabile între server și client). */
export type InvoiceListItem = {
  id: string;
  number: string;
  status: InvoiceStatusName;
  kind: "STANDARD" | "APA_CANAL";
  issueDate: string;
  dueDate: string | null;
  paidAt: string | null;
  grandTotal: number;
  currency: string;
  clientName: string | null;
  publicToken: string;
};

const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());

export function toListItem(r: InvRow): InvoiceListItem {
  return {
    id: r.id, number: r.number, status: r.status, kind: r.kind,
    issueDate: new Date(r.issueMs).toISOString(), dueDate: iso(r.dueMs), paidAt: iso(r.paidMs),
    grandTotal: r.grandTotal, currency: r.currency, clientName: r.clientName, publicToken: r.publicToken,
  };
}

/** Câte facturi pe pagină, doar valori permise (aceleași ca la plătitori). */
export const INVOICE_PER_PAGE = [20, 50, 100, 200, 500, 1000, 25_000] as const;
export const INVOICE_DEFAULT_PER_PAGE = 50;
export const INVOICE_ALL = 25_000;
export function normalizeInvoicePerPage(v: unknown): number {
  const n = Math.floor(Number(v));
  return (INVOICE_PER_PAGE as readonly number[]).includes(n) ? n : INVOICE_DEFAULT_PER_PAGE;
}

// ───────────────────────────── query string (adresă / API) ─────────────────────────────

const KEYS: [keyof InvQuery, string][] = [
  ["q", "q"], ["kind", "kind"], ["quick", "quick"], ["min", "min"], ["max", "max"], ["currency", "cur"],
  ["issueFrom", "if"], ["issueTo", "it"], ["dueFrom", "df"], ["dueTo", "dt"], ["paidFrom", "pf"], ["paidTo", "pt"], ["sort", "sort"], ["dir", "dir"],
];
const QUICK = new Set(["unpaid", "overdue", "nodue", "paidnodate"]);
const SORTS = new Set(["number", "client", "issue", "due", "paid", "total", "status"]);

export function queryToParams(f: InvQuery, sp: URLSearchParams = new URLSearchParams()): URLSearchParams {
  for (const [k, p] of KEYS) {
    const v = f[k] as string;
    if (v && !(k === "dir" && !f.sort)) sp.set(p, v);
  }
  if (f.statuses.length) sp.set("st", f.statuses.join(","));
  return sp;
}
/** Inversul lui queryToParams, cu valori validate (orice necunoscut se ignoră). */
export function queryFromParams(sp: URLSearchParams | { get(k: string): string | null }): InvQuery {
  const g = (p: string) => (sp.get(p) ?? "").trim();
  const q: InvQuery = { ...EMPTY_QUERY };
  q.q = g("q").slice(0, 100);
  const st = g("st");
  q.statuses = st ? st.split(",").filter((s) => (INVOICE_STATUS_CODES as readonly string[]).includes(s)) : [];
  // compatibilitate cu adresele vechi (?status=PAID)
  const legacy = g("status");
  if (!q.statuses.length && (INVOICE_STATUS_CODES as readonly string[]).includes(legacy)) q.statuses = [legacy];
  const kind = g("kind");
  q.kind = kind === "APA_CANAL" || kind === "STANDARD" ? kind : "";
  const quick = g("quick");
  q.quick = QUICK.has(quick) ? (quick as InvQuick) : "";
  q.min = g("min").slice(0, 14);
  q.max = g("max").slice(0, 14);
  q.currency = g("cur").slice(0, 5).toUpperCase();
  for (const [k, p] of [["issueFrom", "if"], ["issueTo", "it"], ["dueFrom", "df"], ["dueTo", "dt"], ["paidFrom", "pf"], ["paidTo", "pt"]] as const) q[k] = dayOfKey(g(p)) != null ? g(p) : "";
  const sort = g("sort");
  q.sort = SORTS.has(sort) ? (sort as InvSort) : "";
  q.dir = g("dir") === "asc" ? "asc" : "desc";
  return q;
}
