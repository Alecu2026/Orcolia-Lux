"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import PortalNewTicketForm from "./PortalNewTicketForm";
import { IconTicket } from "./icons";
import type { PortalTemplate } from "@/lib/portal-template";
import { useT } from "@/lib/i18n/context";

/** Evenimentul prin care meniul de la o factură deschide panoul (fără stare comună între componentele de pe pagină). */
export const PORTAL_REQUEST_EVENT = "portal-request-open";
export type PortalRequestDetail = { templateId: string; invoiceNumber?: string };

/**
 * Butonul „Creează cerere” din cabinetul personal: se deschide chiar pe pagină un formular în care alegi un șablon din listă
 * sau scrii singur cererea. Meniul de la fiecare factură îl deschide deja completat (șablonul ales + numărul facturii).
 */
export default function PortalRequestPanel({ templates }: { templates: PortalTemplate[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState<PortalRequestDetail & { n: number }>({ templateId: "", n: 0 });
  const [sent, setSent] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOpen(e: Event) {
      const d = (e as CustomEvent<PortalRequestDetail>).detail;
      setSeed((s) => ({ templateId: d.templateId, invoiceNumber: d.invoiceNumber, n: s.n + 1 }));
      setSent(false);
      setOpen(true);
      setTimeout(() => box.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
    window.addEventListener(PORTAL_REQUEST_EVENT, onOpen);
    return () => window.removeEventListener(PORTAL_REQUEST_EVENT, onOpen);
  }, []);

  return (
    <div ref={box} className="flex scroll-mt-4 flex-col gap-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => { setSent(false); setOpen((o) => !o); }}
          aria-expanded={open}
          className="tap flex h-10 items-center gap-1.5 rounded-xl bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong"
        >
          <IconTicket className="size-4" />
          {t("Creează cerere")}
        </button>
      </div>

      {sent && !open && (
        <p className="card p-3 text-sm text-brand-strong">
          {t("Cerere trimisă cu succes.")}{" "}
          <Link href="/portal/cereri" className="font-semibold underline">{t("Vezi cererile mele")}</Link>
        </p>
      )}

      {open && (
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <IconTicket className="size-4 text-brand" />
              {seed.invoiceNumber ? t("Cerere pentru factura {nr}", { nr: seed.invoiceNumber }) : t("Creează o cerere nouă")}
            </h2>
            <button type="button" onClick={() => setOpen(false)} className="tap h-8 cursor-pointer rounded-lg px-2 text-xs text-ink-soft hover:bg-[var(--color-surface-2)]">
              {t("Închide")}
            </button>
          </div>
          <PortalNewTicketForm
            key={`${seed.n}:${seed.templateId}:${seed.invoiceNumber ?? ""}`}
            templates={templates}
            initialTemplateId={seed.templateId}
            invoiceNumber={seed.invoiceNumber}
            onSent={() => { setOpen(false); setSent(true); }}
          />
        </div>
      )}
    </div>
  );
}
