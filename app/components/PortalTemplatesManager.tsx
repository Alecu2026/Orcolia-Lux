"use client";

import { useState, useTransition } from "react";
import { savePortalTemplateAction, deletePortalTemplateAction, addDefaultPortalTemplatesAction } from "@/app/actions/portal-templates";
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
const EMPTY = { id: "", name: "", title: "", description: "", teamId: "" };

/** Administrare: șabloanele de cereri pe care clienții le văd în cabinetul personal (listă la „Creează cerere” și pe pagina cu facturi). */
export default function PortalTemplatesManager({ initial, teams: initialTeams = [] }: { initial: PortalTemplate[]; teams?: { id: string; name: string }[] }) {
  const t = useT();
  const toast = useToast();
  const [items, setItems] = useState(initial);
  const [teams, setTeams] = useState(initialTeams);
  // se deschide singură doar cât timp nu există șabloane; după aceea o ține deschisă sau închisă alegerea utilizatorului (nu se mai închide când apar șabloane)
  const [open, setOpen] = useState(initial.length === 0);
  const teamName = (id: string | null) => teams.find((x) => x.id === id)?.name ?? null;
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    if (!form) return;
    startTransition(async () => {
      const res = await savePortalTemplateAction({ id: form.id || undefined, name: form.name, title: form.title, description: form.description, teamId: form.teamId || null });
      if (!res.ok) return toast.error(res.error);
      setItems(res.templates);
      setForm(null);
      toast.success(t("Șablon salvat."));
    });
  }

  function addDefaults() {
    startTransition(async () => {
      const res = await addDefaultPortalTemplatesAction();
      if (!res.ok) return toast.error(res.error);
      setItems(res.templates);
      if (res.teams) setTeams(res.teams);
      toast.success(res.added || res.addedTeams ? t("{n} șabloane și {m} secții adăugate.", { n: res.added ?? 0, m: res.addedTeams ?? 0 }) : t("Toate șabloanele standard există deja."));
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
    <details className="card p-0" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-bold">
        {t("Șabloane de cereri pentru clienți")} <span className="font-normal text-ink-soft">({items.length})</span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-[var(--color-line)] p-4">
        <p className="text-xs text-ink-soft">
          {t("Clientul le alege dintr-o listă când creează o cerere în cabinetul personal: titlul și descrierea se completează singure, iar el le poate modifica înainte să trimită.")}
        </p>

        <button type="button" onClick={addDefaults} disabled={pending} className="tap h-9 cursor-pointer self-start rounded-xl border border-brand px-3 text-xs font-semibold text-brand hover:bg-brand-soft disabled:opacity-50">
          {t("Adaugă șabloanele standard (7 cereri + petiție)")}
        </button>

        {items.length === 0 && <p className="rounded-xl border border-dashed border-[var(--color-line)] p-3 text-center text-sm text-ink-soft">{t("Nu ai niciun șablon încă.")}</p>}
        {items.map((tpl) => (
          <div key={tpl.id} className="flex items-center gap-2 rounded-xl border border-[var(--color-line)] p-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{tpl.name}</p>
              <p className="truncate text-[11px] text-ink-soft">{tpl.title}</p>
              <p className={`truncate text-[11px] font-medium ${tpl.teamId && teamName(tpl.teamId) ? "text-brand-strong" : "text-ink-soft"}`}>
                {tpl.teamId && teamName(tpl.teamId) ? `🏢 ${teamName(tpl.teamId)}` : t("🏢 Fără secție — cererea merge la administratori")}
              </p>
            </div>
            <button type="button" disabled={pending} onClick={() => setForm({ ...tpl, teamId: tpl.teamId ?? "" })} className="tap h-8 cursor-pointer rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium hover:bg-[var(--color-surface-2)]">
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
            <label className="text-xs font-semibold">{t("Secția responsabilă")}</label>
            <select value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })} className={input} aria-label={t("Secția responsabilă")}>
              <option value="">{t("— fără secție (cererea merge la administratori)")}</option>
              {teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <p className="text-[11px] text-ink-soft">{t("Cererile de acest tip se atribuie secției, iar doar membrii ei primesc notificarea. Dacă secția n-are încă persoane, notificarea merge la administratori.")}</p>
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
