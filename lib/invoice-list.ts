/**
 * Lista de facturi — motor local, același tipar ca la plătitori (vezi lib/payer-notify.ts): serverul trimite O DATĂ toate facturile ca tupluri
 * compacte (comprimat gzip, cu ETag), iar filtrarea / paginarea rulează în browser — fără interogări la fiecare schimbare de filtru.
 * Partajat între server (lib/services/invoice-cache.ts) și browser. Fără dependențe de server.
 */

export const INVOICE_STATUS_CODES = ["DRAFT", "SENT", "PAID", "CANCELLED", "OVERDUE"] as const;
export type InvoiceStatusName = (typeof INVOICE_STATUS_CODES)[number];

/**
 * O factură în snapshot, ca tuplu (mai puțin JSON): [id, număr, status (index în INVOICE_STATUS_CODES), tip (0 standard / 1 Apă-Canal),
 * emisă ms, scadentă ms | null, achitată ms | null, total, valută, nume client | null, cod public, text suplimentar de căutare | null].
 * Ordinea din snapshot = ordinea listei (cele mai noi create primele); nu se mai sortează niciodată.
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

export type InvoiceFilters = { status: string; q: string };

/** O singură trecere, comparații simple: milisecunde la zeci de mii de facturi. */
export function filterInvoices(rows: InvRow[], f: InvoiceFilters): InvRow[] {
  const q = f.q.trim().toLowerCase();
  if (!f.status && !q) return rows;
  const out: InvRow[] = [];
  for (let i = 0, n = rows.length; i < n; i++) {
    const r = rows[i];
    if (f.status && r.status !== f.status) continue;
    if (q && !r._h.includes(q)) continue;
    out.push(r);
  }
  return out;
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
