"use client";

import { daysLabel, daysUntil } from "@/lib/contract-expiry";
import { useT } from "@/lib/i18n/context";

/**
 * Data expirării contractului plătitorului, cu culoare după cât mai e: expirat / ≤ 10 zile (roșu), ≤ 30 de zile (portocaliu), altfel normal.
 * `compact` = doar data (pentru celula din tabel), cu „expiră în N zile” în titlu; altfel și textul de lângă dată.
 */
export default function ContractExpiry({ date, compact = false }: { date: string | null; compact?: boolean }) {
  const t = useT();
  if (!date) return <span className="text-ink-soft">—</span>;
  const days = daysUntil(date);
  const cls = days <= 10 ? "font-semibold text-st-cancelled" : days <= 30 ? "font-semibold text-st-progress" : "";
  const label = daysLabel(days, t);
  const shown = date.split("-").reverse().join(".");
  if (compact) return <span className={cls} title={label}>{shown}</span>;
  return (
    <span className={cls}>
      {shown} <span className="font-normal text-ink-soft">· {label}</span>
    </span>
  );
}
