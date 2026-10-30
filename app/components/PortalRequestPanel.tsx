"use client";

import { useState } from "react";
import Link from "next/link";
import PortalNewTicketForm from "./PortalNewTicketForm";
import { IconTicket } from "./icons";
import type { PortalTemplate } from "@/lib/portal-template";
import { useT } from "@/lib/i18n/context";

/**
 * Butonul „Creează cerere” din cabinetul personal: se deschide chiar pe pagină un formular în care alegi un șablon din listă
 * sau scrii singur cererea (titlu + descriere).
 */
export default function PortalRequestPanel({ templates, defaults }: { templates: PortalTemplate[]; defaults?: { address: string | null; consumerName: string } }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);

  return (
    <div className="flex flex-col gap-3">
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
              {t("Creează o cerere nouă")}
            </h2>
            <button type="button" onClick={() => setOpen(false)} className="tap h-8 cursor-pointer rounded-lg px-2 text-xs text-ink-soft hover:bg-[var(--color-surface-2)]">
              {t("Închide")}
            </button>
          </div>
          <PortalNewTicketForm templates={templates} defaults={defaults} onSent={() => { setOpen(false); setSent(true); }} />
        </div>
      )}
    </div>
  );
}
