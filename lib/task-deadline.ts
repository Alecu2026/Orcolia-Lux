import { formatTime, zonedToUtc } from "./date";

/**
 * Situația unei cereri față de termenul (scadența) ei: anulată, expirată (nerezolvată și termenul a trecut), rezolvată în termen, rezolvată după termen.
 * Cod comun server (export) + browser (filtru), ca ambele să dea aceleași rezultate.
 *
 * Termenul fără oră (00:00 în Europe/Bucharest) înseamnă „până la sfârșitul zilei”. Momentul rezolvării = data închiderii; la cererile închise
 * înainte să se păstreze data închiderii se folosește data executării (sfârșitul acelei zile); fără niciuna, momentul rezolvării nu se știe.
 */
const TZ = "Europe/Bucharest";
const DAY_MS = 86_400_000;

/** Valoare de filtru (nu o stare): termen depășit = expirate (nerezolvate) + rezolvate după termen. */
export const DEADLINE_OVER = "over";

export type DeadlineState =
  | "cancelled" // anulată
  | "expired" // nerezolvată, termenul a trecut
  | "done_on_time" // rezolvată în termen
  | "done_late" // rezolvată după termen
  | "done_no_due" // rezolvată, fără termen
  | "done_unknown" // rezolvată, cu termen, dar nu se știe când
  | "open_on_time" // în lucru, termenul nu a trecut
  | "open_no_due"; // în lucru, fără termen

/** Etichetele din filtru (cele patru situații cerute) — în română, de tradus cu t(). */
export const DEADLINE_FILTER_OPTIONS: { value: DeadlineState | typeof DEADLINE_OVER; label: string }[] = [
  { value: DEADLINE_OVER, label: "Termen depășit (expirate + rezolvate după termen)" },
  { value: "cancelled", label: "Anulate" },
  { value: "expired", label: "Expirate (nerezolvate, termen depășit)" },
  { value: "done_on_time", label: "Rezolvate în termen" },
  { value: "done_late", label: "Rezolvate după termen" },
];

/** Etichetele din export / detalii pentru toate situațiile. */
export const DEADLINE_LABEL: Record<DeadlineState, string> = {
  cancelled: "Anulată",
  expired: "Expirată",
  done_on_time: "Rezolvată în termen",
  done_late: "Rezolvată după termen",
  done_no_due: "Rezolvată (fără termen)",
  done_unknown: "Rezolvată (data rezolvării necunoscută)",
  open_on_time: "În lucru, în termen",
  open_no_due: "În lucru, fără termen",
};

type DeadlineInput = {
  status: string;
  dueAt: Date | string | null;
  closedAt?: Date | string | null;
  /** „YYYY-MM-DD” */
  executedOn?: string | null;
};

const ms = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : null);

/** Ultimul moment în care cererea mai e „în termen”. */
export function deadlineEnd(dueAt: Date | string | null | undefined): number | null {
  const t = ms(dueAt);
  if (t == null || Number.isNaN(t)) return null;
  return formatTime(new Date(t), TZ) === "00:00" ? t + DAY_MS - 1 : t;
}

/** Momentul rezolvării / anulării: data închiderii, altfel sfârșitul zilei de executare, altfel necunoscut. */
export function closedAtMs(t: Pick<DeadlineInput, "closedAt" | "executedOn">): number | null {
  const c = ms(t.closedAt);
  if (c != null && !Number.isNaN(c)) return c;
  if (t.executedOn && /^\d{4}-\d{2}-\d{2}$/.test(t.executedOn)) return zonedToUtc(t.executedOn, "23:59", TZ).getTime();
  return null;
}

/** A depășit termenul? Nerezolvată cu termenul trecut SAU rezolvată după termen — filtrul „Termen depășit” și „Termen → Expirate”. */
export function isOverDeadline(t: DeadlineInput, now: number = Date.now()): boolean {
  const s = deadlineState(t, now);
  return s === "expired" || s === "done_late";
}

export function deadlineState(t: DeadlineInput, now: number = Date.now()): DeadlineState {
  if (t.status === "CANCELLED") return "cancelled";
  const end = deadlineEnd(t.dueAt);
  if (t.status === "DONE") {
    if (end == null) return "done_no_due";
    const closed = closedAtMs(t);
    if (closed == null) return "done_unknown";
    return closed <= end ? "done_on_time" : "done_late";
  }
  if (end == null) return "open_no_due";
  return end < now ? "expired" : "open_on_time";
}
