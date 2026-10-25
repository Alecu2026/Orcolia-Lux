"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortalTicket, type PortalTicketState } from "@/app/actions/portal";
import { useT } from "@/lib/i18n/context";
import type { PortalTemplate } from "@/lib/portal-template";

const input =
  "w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-4 py-3 text-[15px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/30";

export default function PortalNewTicketForm({
  templates = [],
  initialTemplateId = "",
  invoiceNumber,
  onSent,
}: {
  /** Șabloanele create de administrator: alegerea completează titlul și descrierea (clientul le poate modifica). */
  templates?: PortalTemplate[];
  initialTemplateId?: string;
  /** Cererea privește o factură: numărul ei se adaugă la descriere, ca să știe cine o citește despre ce e vorba. */
  invoiceNumber?: string;
  /** Apelat după ce cererea a plecat (panoul din pagina cu facturi se închide). */
  onSent?: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const withInvoice = (d: string) => (invoiceNumber ? `${d ? d + "\n\n" : ""}Factura: ${invoiceNumber}` : d);
  const first = templates.find((x) => x.id === initialTemplateId);
  const [tplId, setTplId] = useState(first?.id ?? "");
  const [title, setTitle] = useState(first?.title ?? "");
  const [description, setDescription] = useState(withInvoice(first?.description ?? ""));
  const [state, formAction, pending] = useActionState<PortalTicketState, FormData>(async (prev, fd) => {
    const res = await createPortalTicket(prev, fd);
    if (res?.ok) { setTplId(""); setTitle(""); setDescription(withInvoice("")); onSent?.(); } // cererea a plecat: formularul revine gol
    return res;
  }, undefined);

  function pick(id: string) {
    setTplId(id);
    const tpl = templates.find((x) => x.id === id);
    setTitle(tpl?.title ?? "");
    setDescription(withInvoice(tpl?.description ?? ""));
  }

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {templates.length > 0 && (
        <select value={tplId} onChange={(e) => pick(e.target.value)} aria-label={t("Alege un șablon de cerere")} className={input}>
          <option value="">{t("📋 Alege un șablon (opțional)…")}</option>
          {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
        </select>
      )}
      <input name="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("Titlu (ex: Scurgere la contor)")} required className={input} />
      <textarea name="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("Descriere (opțional)")} rows={3} className={input} />

      {state?.error && <p className="text-sm text-st-cancelled">{t(state.error)}</p>}
      {state?.ok && <p className="text-sm text-brand-strong">{t("Cerere trimisă cu succes.")}</p>}

      <button
        type="submit"
        disabled={pending}
        className="tap h-11 self-start rounded-xl bg-brand px-5 font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
      >
        {pending ? t("Se trimite…") : t("Trimite cerere")}
      </button>
    </form>
  );
}
