"use client";

import type { PortalTemplate } from "@/lib/portal-template";
import { PORTAL_REQUEST_EVENT, type PortalRequestDetail } from "./PortalRequestPanel";
import { useT } from "@/lib/i18n/context";

/** Lista de la fiecare factură: alegi un șablon (sau „Altă cerere”) și formularul se deschide sus, deja completat pentru factura respectivă. */
export default function InvoiceRequestMenu({ templates, invoiceNumber }: { templates: PortalTemplate[]; invoiceNumber: string }) {
  const t = useT();
  return (
    <select
      value=""
      onChange={(e) => {
        const v = e.target.value;
        if (!v) return;
        window.dispatchEvent(new CustomEvent<PortalRequestDetail>(PORTAL_REQUEST_EVENT, { detail: { templateId: v === "_custom" ? "" : v, invoiceNumber } }));
      }}
      aria-label={t("Cerere despre această factură")}
      className="h-9 max-w-full cursor-pointer rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-xs text-ink-soft outline-none focus:border-brand"
    >
      <option value="">{t("📋 Cerere despre factură…")}</option>
      {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
      <option value="_custom">{t("✍ Altă cerere (scriu eu)…")}</option>
    </select>
  );
}
