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
export type PayBal = "owes" | "advance" | "paidprev" | "partial" | "unpaid";
export function matchesPayBal(bal: PayBal, inv: { status: string; debt: number | null | undefined; prevPaid: number | null | undefined; paid: number | null | undefined }): boolean {
  switch (bal) {
    case "owes": return (inv.debt ?? 0) > EPS; // are datorie din facturile trecute
    case "advance": return (inv.debt ?? 0) < -EPS; // are avans
    case "paidprev": return (inv.prevPaid ?? 0) > EPS; // a plătit între factura anterioară și aceasta
    case "partial": return (inv.paid ?? 0) > EPS && inv.status !== "PAID" && inv.status !== "CANCELLED"; // parțial achitată
    case "unpaid": return inv.status === "SENT" || inv.status === "OVERDUE"; // trimisă sau restantă
  }
}
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const FROZEN = new Set(["DRAFT", "CANCELLED"]);

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
