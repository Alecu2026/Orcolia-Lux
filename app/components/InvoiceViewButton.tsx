"use client";

import { useState } from "react";
import InvoicePreviewDialog from "./InvoicePreviewDialog";
import { useT } from "@/lib/i18n/context";

/** Buton „Vezi" care deschide factura într-un pop-up cu zoom (în loc să părăsești pagina). */
export default function InvoiceViewButton({
  token,
  title,
  className = "tap h-9 cursor-pointer rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium hover:bg-[var(--color-surface-2)]",
  label = "Vezi",
}: {
  token: string;
  title?: string;
  className?: string;
  label?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(true); }} className={className} title={t("Vezi factura (pop-up)")}>
        {label}
      </button>
      {open && <InvoicePreviewDialog token={token} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}
