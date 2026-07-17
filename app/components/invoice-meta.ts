export type InvoiceStatusKey =
  | "DRAFT"
  | "SENT"
  | "PAID"
  | "CANCELLED"
  | "OVERDUE";

export const INVOICE_STATUS: Record<InvoiceStatusKey, { label: string; cls: string }> = {
  DRAFT: { label: "Ciornă", cls: "bg-st-new/12 text-st-new" },
  SENT: { label: "Trimisă", cls: "bg-st-confirmed/12 text-st-confirmed" },
  PAID: { label: "Plătită", cls: "bg-st-done/12 text-st-done" },
  CANCELLED: { label: "Anulată", cls: "bg-st-cancelled/12 text-st-cancelled" },
  OVERDUE: { label: "Restantă", cls: "bg-st-progress/12 text-st-progress" },
};

export const INVOICE_STATUS_LIST: InvoiceStatusKey[] = [
  "DRAFT",
  "SENT",
  "PAID",
  "OVERDUE",
  "CANCELLED",
];

export function money(n: number, currency = "MDL"): string {
  return `${(Number(n) || 0).toFixed(2)} ${currency}`;
}

export function fmtDate(d: string | Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("ro-RO", { timeZone: "Europe/Bucharest" });
}
