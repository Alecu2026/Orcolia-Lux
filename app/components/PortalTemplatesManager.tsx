"use client";

import { useState, useTransition } from "react";
import { savePortalTemplateAction, deletePortalTemplateAction } from "@/app/actions/portal-templates";
import {
  PORTAL_TEMPLATE_MAX_DESCRIPTION,
  PORTAL_TEMPLATE_MAX_NAME,
  PORTAL_TEMPLATE_MAX_TITLE,
  type PortalTemplate,
} from "@/lib/portal-template";
import { useToast } from "./toast";
import { useT } from "@/lib/i18n/context";

const input =
  "w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30";
const EMPTY = { id: "", name: "", title: "", description: "" };

/** Administrare: șabloanele de cereri pe care clienții le văd în cabinetul personal (listă la „Creează cerere” și pe pagina cu facturi). */
export default function PortalTemplatesManager({ initial }: { initial: PortalTemplate[] }) {
  const t = useT();
  const toast = useToast();
  const [items, setItems] = useState(initial);
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    if (!form) return;
    startTransition(async () => {
      const res = await savePortalTemplateAction({ id: form.id || undefined, name: form.name, title: form.title, description: form.description });
      if (!res.ok) return toast.error(res.error);
      setItems(res.templates);
      setForm(null);
      toast.success(t("Șablon salvat."));
    });
  }

  function remove(tpl: PortalTemplate) {
    if (!confirm(t("Ștergi șablonul „{name}”?", { name: tpl.name }))) return;
    startTransition(async () => {
      const res = await deletePortalTemplateAction(tpl.id);
      if (!res.ok) return toast.error(res.error);
      setItems(res.templates);
      if (form?.id === tpl.id) setForm(null);
    });
  }

  return (
    <details className="card p-0" open={items.length === 0}>
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-bold">
        {t("Șabloane de cereri pentru clienți")} <span className="font-normal text-ink-soft">({items.length})</span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-[var(--color-line)] p-4">
        <p className="text-xs text-ink-soft">
          {t("Clientul le alege dintr-o listă când creează o cerere în cabinetul personal: titlul și descrierea se completează singure, iar el le poate modifica înainte să trimită.")}
        </p>

        {items.length === 0 && <p className="rounded-xl border border-dashed border-[var(--color-line)] p-3 text-center text-sm text-ink-soft">{t("Nu ai niciun șablon încă.")}</p>}
        {items.map((tpl) => (
          <div key={tpl.id} className="flex items-center gap-2 rounded-xl border border-[var(--color-line)] p-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{tpl.name}</p>
              <p className="truncate text-[11px] text-ink-soft">{tpl.title}</p>
            </div>
            <button type="button" disabled={pending} onClick={() => setForm({ ...tpl })} className="tap h-8 cursor-pointer rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium hover:bg-[var(--color-surface-2)]">
              {t("Editează")}
            </button>
            <button type="button" disabled={pending} onClick={() => remove(tpl)} className="tap h-8 cursor-pointer rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium text-st-cancelled hover:bg-[var(--color-surface-2)]">
              {t("Șterge")}
            </button>
          </div>
        ))}

        {form ? (
          <div className="flex flex-col gap-2 rounded-xl border border-brand/40 p-3">
            <label className="text-xs font-semibold">{t("Numele șablonului (îl vede clientul în listă)")}</label>
            <input value={form.name} maxLength={PORTAL_TEMPLATE_MAX_NAME} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("ex. Contestare factură")} className={input} />
            <label className="text-xs font-semibold">{t("Titlul cererii")}</label>
            <input value={form.title} maxLength={PORTAL_TEMPLATE_MAX_TITLE} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t("ex. Nu sunt de acord cu factura")} className={input} />
            <label className="text-xs font-semibold">{t("Descriere (opțional)")}</label>
            <textarea value={form.description} rows={4} maxLength={PORTAL_TEMPLATE_MAX_DESCRIPTION} onChange={(e) => setForm({ ...form, description: e.target.value })} className={input} />
            <div className="flex gap-2">
              <button type="button" disabled={pending} onClick={save} className="tap h-9 cursor-pointer rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
                {pending ? t("Se salvează…") : t("Salvează șablonul")}
              </button>
              <button type="button" disabled={pending} onClick={() => setForm(null)} className="tap h-9 cursor-pointer rounded-lg border border-[var(--color-line)] px-4 text-sm hover:bg-[var(--color-surface-2)]">
                {t("Renunță")}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setForm({ ...EMPTY })} className="tap h-10 cursor-pointer rounded-xl border border-dashed border-brand text-sm font-semibold text-brand hover:bg-brand-soft">
            {t("+ Șablon nou")}
          </button>
        )}
      </div>
    </details>
  );
}
