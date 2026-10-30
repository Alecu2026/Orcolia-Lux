"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import type { PortalInvoiceItem } from "@/lib/services/portal-home";
import { fmtDate, INVOICE_STATUS, INVOICE_STATUS_LIST, money, type InvoiceStatusKey } from "./invoice-meta";
import { IconChevronDown } from "./icons";

/**
 * Lista de facturi din portal. Filtrul pe status se aplică în browser, pe lista deja primită: apăsarea unui chip nu mai pornește o navigare
 * (adică nicio cerere către server, nicio randare în plus); adresa din bara browserului se actualizează doar ca să poată fi copiată.
 */
export default function PortalInvoiceList({ invoices, initialStatus }: { invoices: PortalInvoiceItem[]; initialStatus: string | null }) {
  const t = useT();
  const [status, setStatus] = useState<InvoiceStatusKey | null>(INVOICE_STATUS_LIST.includes(initialStatus as InvoiceStatusKey) ? (initialStatus as InvoiceStatusKey) : null);

  function choose(s: InvoiceStatusKey | null) {
    setStatus(s);
    try {
      window.history.replaceState(null, "", s ? `/portal?status=${s}` : "/portal");
    } catch {}
  }

  const shown = status ? invoices.filter((i) => i.status === status) : invoices;

  return (
    <details open={!!status} className="card group p-0">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4">
        <span className="text-sm font-semibold">
          {t("Facturi")} <span className="font-normal text-ink-soft">({invoices.length})</span>
        </span>
        <IconChevronDown className="size-4 text-ink-soft transition-transform group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-3 border-t border-[var(--color-line)] p-3">
        {invoices.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <Chip active={!status} label={t("Toate")} onClick={() => choose(null)} />
            {INVOICE_STATUS_LIST.filter((s) => invoices.some((i) => i.status === s)).map((s) => (
              <Chip key={s} active={status === s} label={t(INVOICE_STATUS[s].label)} onClick={() => choose(s)} />
            ))}
          </div>
        )}

        {shown.length === 0 ? (
          <p className="p-3 text-center text-sm text-ink-soft">{invoices.length === 0 ? t("Nu ai încă nicio factură.") : t("Nicio factură cu acest status.")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {shown.map((inv) => {
              const st = INVOICE_STATUS[inv.status as InvoiceStatusKey];
              return (
                <Link key={inv.id} href={`/invoice/public/${inv.token}`} className="tap flex items-center justify-between rounded-xl border border-[var(--color-line)] p-3 hover:border-brand">
                  <div>
                    <p className="text-sm font-semibold">{inv.number}</p>
                    <p className="text-xs text-ink-soft">
                      {t("Emisă:")} {fmtDate(inv.issue)}
                      {inv.due && <> {t("· Scadență:")} {fmtDate(inv.due)}</>}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums">{money(inv.grandTotal, inv.currency)}</p>
                    <span className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>{t(st.label)}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </details>
  );
}

function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={`tap cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium ${active ? "bg-brand text-white" : "card text-ink-soft"}`}>
      {label}
    </button>
  );
}
