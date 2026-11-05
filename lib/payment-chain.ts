/**
 * Plățile deduse din lanțul de facturi al unui plătitor (Apă-Canal). 1C nu trimite plăți separate, dar fiecare factură poartă soldul anterior:
 *
 *   „Datorii(+) / avans(−)” (D) = ce a rămas de plată din facturile trecute, la emiterea facturii.
 *   Total de plată (G) = calculat + D.
 *
 * Deci, între factura anterioară (G_prev) și cea nouă (D_nou):
 *   plătit în perioadă      = max(0, G_prev − D_nou)
 *   rămas din factura prev. = clamp(D_nou, 0, G_prev)      (datoria se reportează pe factura următoare)
 *
 * Statusul fiecărei facturi (scadența nu intervine: „restantă” se știe abia când factura următoare arată datorie):
 *   – G ≤ 0 (avansul acoperă factura)         → ACHITATĂ, imediat, fără să aștepte următoarea factură;
 *   – există factura următoare:  D_nou ≤ 0    → ACHITATĂ;  D_nou > 0 → rămâne neachitată (parțial dacă D_nou < G) → RESTANTĂ (factura următoare se emite după scadență);
 *   – nu există factura următoare             → TRIMISĂ, chiar și după scadență: dacă a fost plătită sau nu se vede abia în factura următoare (ex. factura din octombrie, scadentă 25.11,
 *                                               rămâne „Trimisă” până se emite cea din noiembrie; dacă aceea arată datorie, octombrie devine „Restantă”). O factură deja marcată ACHITATĂ
 *                                               rămâne așa (plata ei încă nu apare în nicio factură, iar singura sursă e marcajul operatorului — nu o retragem).
 * Facturile CIORNĂ și ANULATE nu se ating și nu sunt vecine în lanț (o factură anulată nu e nici „anterioară”, nici „următoare”). Cod pur (fără baza de date), comun server + teste.
 */

export type ChainInvoice = {
  id: string;
  issueMs: number;
  dueMs: number | null;
  status: string;
  /** „Datorii(+) / avans(−)” de pe factură. */
  debt: number;
  /** Total de plată (calculat + datorii / avans). */
  total: number;
};

export type ChainResult = {
  id: string;
  /** Statusul după regulile de mai sus (egal cu cel curent dacă nu se schimbă). */
  status: string;
  /** Cât din ACEASTĂ factură s-a achitat (cunoscut doar când există factura următoare, sau când avansul o acoperă); null = încă nu se știe. */
  paidAmount: number | null;
  /** Cât s-a plătit între factura anterioară și aceasta; null la prima factură. */
  prevPaid: number | null;
  /** Data estimată a achitării, când factura devine achitată din lanț: emiterea facturii următoare (plata a apărut până atunci) sau, dacă avansul o acoperă, emiterea ei. null = nu se știe / nu e achitată. */
  paidOnMs: number | null;
};

const EPS = 0.005;

/** Filtrele de plăți (aceeași definiție în lista de facturi, în filtrele de plătitori / notificări și în cererile de pe server). */
export type PayBal = "settled" | "owes" | "advance" | "paidprev" | "partial" | "unpaid";
export function matchesPayBal(bal: PayBal, inv: { status: string; debt: number | null | undefined; prevPaid: number | null | undefined; paid: number | null | undefined }): boolean {
  switch (bal) {
    // Pe factura lunii X, plata facturii anterioare se vede din datoria de pe ea (factura X nu poate fi încă „achitată”: asta se află luna viitoare):
    case "settled": return (inv.prevPaid ?? 0) > EPS && (inv.debt ?? 0) <= EPS; // a achitat factura anterioară (datorie 0 sau avans)
    case "owes": return (inv.debt ?? 0) > EPS; // nu a achitat-o integral: datoria s-a reportat pe această factură
    case "advance": return (inv.debt ?? 0) < -EPS; // are avans
    case "paidprev": return (inv.prevPaid ?? 0) > EPS; // a plătit între factura anterioară și aceasta
    case "partial": return (inv.prevPaid ?? 0) > EPS && (inv.debt ?? 0) > EPS; // a achitat doar o parte din factura anterioară
    case "unpaid": return inv.status === "SENT" || inv.status === "OVERDUE"; // trimisă sau restantă
  }
}
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const FROZEN = new Set(["DRAFT", "CANCELLED"]);

/**
 * Plățile deduse pentru facturile UNUI plătitor, în orice ordine primite (doar cele Apă-Canal intră în lanț). Se folosește la afișarea fișei plătitorului, a decontării și a dialogului,
 * ca statusul „Achitată” și sumele plătite să se vadă corect imediat, chiar înainte de recalcularea în masă a istoricului (care scrie aceleași valori pe facturi).
 */
export function derivePayerInvoices<T extends { id: string; kind?: string | null; issueDate: Date; status: string; datoriiAvans?: number | null; grandTotal: number }>(list: T[]): Map<string, ChainResult> {
  const apa = list.filter((x) => (x.kind ?? "APA_CANAL") === "APA_CANAL").sort((a, b) => a.issueDate.getTime() - b.issueDate.getTime());
  const res = deriveChain(apa.map((x) => ({ id: x.id, issueMs: x.issueDate.getTime(), dueMs: null, status: x.status, debt: x.datoriiAvans ?? 0, total: x.grandTotal })));
  return new Map(res.map((r) => [r.id, r]));
}

/** `list` = facturile aceluiași plătitor, în ordinea emiterii (cele mai vechi primele). */
export function deriveChain(list: ChainInvoice[]): ChainResult[] {
  const live = list.filter((x) => !FROZEN.has(x.status));
  const pos = new Map(live.map((x, i) => [x.id, i]));
  return list.map((inv) => {
    const i = pos.get(inv.id);
    if (i === undefined) return { id: inv.id, status: inv.status, paidAmount: null, prevPaid: null, paidOnMs: null };
    const prev = i > 0 ? live[i - 1] : null;
    const next = i + 1 < live.length ? live[i + 1] : null;
    const prevPaid = prev ? r2(Math.max(0, prev.total - inv.debt)) : null;

    const owed = Math.max(0, inv.total);
    let status: string;
    let paidAmount: number | null;
    let paidOnMs: number | null = null;
    if (inv.total <= EPS) {
      // avansul acoperă factura
      status = "PAID";
      paidAmount = 0;
      paidOnMs = inv.issueMs;
    } else if (next) {
      const remaining = clamp(next.debt, 0, owed);
      paidAmount = r2(owed - remaining);
      status = remaining <= EPS ? "PAID" : "OVERDUE";
      if (status === "PAID") paidOnMs = next.issueMs;
    } else {
      paidAmount = null;
      // fără factura următoare nu se știe dacă s-a plătit: rămâne „Trimisă” (și după scadență), sau „Achitată” dacă a marcat-o un operator
      status = inv.status === "PAID" ? "PAID" : "SENT";
    }
    return { id: inv.id, status, paidAmount, prevPaid, paidOnMs };
  });
}
