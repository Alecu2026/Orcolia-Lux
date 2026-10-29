"use client";

import { useState } from "react";
import { deleteRoleTemplateAction, saveRoleTemplateAction } from "@/app/actions/role-templates";
import { PERMISSION_GROUPS } from "@/lib/permissions";
import { ROLE_TEMPLATE_MAX_DESCRIPTION, ROLE_TEMPLATE_MAX_NAME, VIEW_OF, type RoleTemplate } from "@/lib/role-templates";
import { IconPencil, IconTrash, IconX } from "./icons";
import { useToast } from "./toast";
import { useMessages, useT } from "@/lib/i18n/context";

const input = "h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";
const label = "mb-1 block text-xs font-semibold text-ink-soft";

type Draft = { key?: string; name: string; description: string; role: "ADMIN" | "STAFF"; permissions: Set<string>; taskView: "" | "ALL" | "OWN"; builtin: boolean };

const blank = (): Draft => ({ name: "", description: "", role: "STAFF", permissions: new Set(), taskView: "", builtin: false });
const fromTemplate = (t: RoleTemplate): Draft => ({ key: t.key, name: t.name, description: t.description, role: t.role, permissions: new Set(t.permissions), taskView: t.taskView, builtin: t.builtin });

/**
 * Șabloane de roluri: lista (tipurile implicite + ale tale), crearea unui șablon nou și modificarea celor existente. Un șablon completează formularul de utilizator
 * (rol, permisiuni, ce sarcini vede) când îl alegi acolo; conturile deja create nu se schimbă. La un tip implicit modificat apare „Revino la original”.
 */
export default function RoleTemplatesDialog({
  templates,
  viewerIsAdmin,
  onChange,
  onClose,
}: {
  templates: RoleTemplate[];
  viewerIsAdmin: boolean;
  onChange: (t: RoleTemplate[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const m = useMessages();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setPerm(key: string, on: boolean) {
    setDraft((d) => {
      if (!d) return d;
      const next = new Set(d.permissions);
      if (on) {
        next.add(key);
        if (VIEW_OF[key]) next.add(VIEW_OF[key]);
      } else {
        next.delete(key);
        for (const [k, v] of Object.entries(VIEW_OF)) if (v === key) next.delete(k);
      }
      return { ...d, permissions: next };
    });
  }
  function setGroup(keys: string[], on: boolean) {
    setDraft((d) => {
      if (!d) return d;
      const next = new Set(d.permissions);
      for (const k of keys) (on ? next.add(k) : next.delete(k));
      return { ...d, permissions: next };
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError(null);
    const res = await saveRoleTemplateAction({ key: draft.key, name: draft.name, description: draft.description, role: draft.role, permissions: [...draft.permissions], taskView: draft.taskView }).catch(() => null);
    setSaving(false);
    if (!res) return setError(t(m.common.error));
    if (!res.ok) return setError(t(res.error));
    onChange(res.templates);
    toast.success(t("Șablon salvat."));
    setDraft(null);
  }

  async function remove(tpl: RoleTemplate) {
    const msg = tpl.builtin ? t("Revii la valorile originale ale șablonului „{name}”?", { name: tpl.name }) : t("Ștergi șablonul „{name}”?", { name: tpl.name });
    if (!confirm(msg)) return;
    const res = await deleteRoleTemplateAction(tpl.key).catch(() => null);
    if (!res || !res.ok) return toast.error(res && !res.ok ? t(res.error) : t(m.common.error));
    onChange(res.templates);
    toast.success(tpl.builtin ? t("Șablonul a revenit la original.") : t("Șablon șters."));
  }

  const permCount = draft ? draft.permissions.size : 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card max-h-[92dvh] w-full max-w-2xl overflow-auto rounded-b-none rounded-t-2xl p-5 sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold">{draft ? (draft.key ? t("Editează șablonul de rol") : t("Șablon de rol nou")) : t("Șabloane de roluri")}</h2>
          <button type="button" onClick={onClose} className="tap grid size-9 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={m.common.close}>
            <IconX className="size-4" />
          </button>
        </div>

        {!draft ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-ink-soft">{t("Un șablon de rol bifează dintr-o atingere permisiunile unui utilizator nou (cititor, dispecer, contabil, administrator…). Le poți modifica pe cele existente sau crea altele; conturile deja create nu se schimbă.")}</p>
            {templates.map((tpl) => (
              <div key={tpl.key} className="flex items-center gap-2 rounded-xl border border-[var(--color-line)] p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {t(tpl.name)}
                    {tpl.builtin && !tpl.customized && <span className="ml-2 rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] font-medium text-ink-soft">{t("implicit")}</span>}
                    {tpl.customized && <span className="ml-2 rounded bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold text-brand-strong">{t("modificat")}</span>}
                    {tpl.role === "ADMIN" && <span className="ml-2 rounded bg-st-progress/15 px-1.5 py-0.5 text-[10px] font-semibold text-st-progress">{t("Administrator")}</span>}
                  </p>
                  <p className="truncate text-[11px] text-ink-soft">
                    {tpl.role === "ADMIN" ? t("Acces la tot") : t("{n} permisiuni", { n: tpl.permissions.length })}
                    {tpl.description ? ` · ${t(tpl.description)}` : ""}
                  </p>
                </div>
                <button type="button" onClick={() => { setError(null); setDraft(fromTemplate(tpl)); }} title={m.common.edit} className="tap grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg border border-[var(--color-line)] hover:bg-brand-soft">
                  <IconPencil className="size-3.5" />
                </button>
                {(!tpl.builtin || tpl.customized) && (
                  <button type="button" onClick={() => remove(tpl)} title={tpl.builtin ? t("Revino la original") : m.common.delete} className="tap grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg border border-[var(--color-line)] text-st-cancelled hover:bg-st-cancelled/10">
                    {tpl.builtin ? <span className="text-xs">↺</span> : <IconTrash className="size-3.5" />}
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={() => { setError(null); setDraft(blank()); }} className="tap mt-1 h-10 cursor-pointer rounded-xl border border-dashed border-brand text-sm font-semibold text-brand hover:bg-brand-soft">
              {t("+ Șablon de rol nou")}
            </button>
          </div>
        ) : (
          <form onSubmit={save} className="flex flex-col gap-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className={label}>{t("Numele șablonului")}</label>
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={ROLE_TEMPLATE_MAX_NAME} required autoFocus placeholder={t("ex. Dispecer")} className={input} />
              </div>
              <div>
                <label className={label}>{t("Rol")}</label>
                <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as "ADMIN" | "STAFF" })} className={input}>
                  <option value="STAFF">{t("Angajat (cu permisiunile de mai jos)")}</option>
                  {(viewerIsAdmin || draft.role === "ADMIN") && <option value="ADMIN" disabled={!viewerIsAdmin}>{t("Administrator (acces la tot)")}</option>}
                </select>
              </div>
            </div>
            <div>
              <label className={label}>{t("Descriere")} <span className="font-normal text-ink-soft">({t("opțional")})</span></label>
              <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={ROLE_TEMPLATE_MAX_DESCRIPTION} placeholder={t("ce face acest rol")} className={input} />
            </div>
            <div>
              <label className={label}>{t("Ce sarcini vede")}</label>
              <select value={draft.taskView} onChange={(e) => setDraft({ ...draft, taskView: e.target.value as Draft["taskView"] })} className={input}>
                <option value="">{t("Nu schimba (rămâne ce e în formular)")}</option>
                <option value="OWN">{t("Doar ale lui (create de el / asignate lui)")}</option>
                <option value="ALL">{t("Toate sarcinile")}</option>
              </select>
            </div>

            {draft.role === "ADMIN" ? (
              <p className="rounded-xl bg-brand-soft/40 p-3 text-sm">{t("Administratorii au acces la tot. Permisiunile individuale se aplică doar angajaților.")}</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">{t("Permisiuni")} <span className="font-normal normal-case">({t("{n} bifate", { n: permCount })})</span></p>
                  <div className="flex items-center gap-1.5">
                    <select
                      value=""
                      onChange={(e) => {
                        const src = templates.find((x) => x.key === e.target.value);
                        if (src) setDraft({ ...draft, permissions: new Set(src.permissions) });
                      }}
                      aria-label={t("Pornește de la un alt șablon")}
                      className="h-8 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-xs"
                    >
                      <option value="">{t("Pornește de la…")}</option>
                      {templates.filter((x) => x.role === "STAFF").map((x) => <option key={x.key} value={x.key}>{t(x.name)}</option>)}
                    </select>
                    <button type="button" onClick={() => setDraft({ ...draft, permissions: new Set() })} className="cursor-pointer text-xs font-medium text-brand hover:underline">{t("Debifează tot")}</button>
                  </div>
                </div>
                <p className="text-[11px] text-ink-soft">{t("Orice permisiune cere și „Vizualizare” din același grup — se bifează automat.")}</p>
                <div className="flex flex-col gap-2">
                  {PERMISSION_GROUPS.map((g) => {
                    const keys = g.items.map((i) => i.key as string).filter((k) => k !== "admin");
                    if (keys.length === 0) return null;
                    const on = keys.filter((k) => draft.permissions.has(k)).length;
                    return (
                      <div key={g.group} className="rounded-xl border border-[var(--color-line)] p-2.5">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <p className="text-[11px] font-semibold uppercase text-ink-soft">{t(g.group)} <span className="font-normal normal-case">({on}/{keys.length})</span></p>
                          <span className="flex gap-1 text-[11px]">
                            <button type="button" className="cursor-pointer font-medium text-brand hover:underline" onClick={() => setGroup(keys, true)}>{t("toate")}</button>
                            <span className="text-ink-soft">·</span>
                            <button type="button" className="cursor-pointer font-medium text-brand hover:underline" onClick={() => setGroup(keys, false)}>{t("niciuna")}</button>
                          </span>
                        </div>
                        <div className="grid gap-x-3 gap-y-0.5 sm:grid-cols-2">
                          {g.items.filter((i) => i.key !== "admin").map((i) => (
                            <label key={i.key} className="flex cursor-pointer items-start gap-2 py-0.5 text-[12px]">
                              <input type="checkbox" checked={draft.permissions.has(i.key)} onChange={(e) => setPerm(i.key, e.target.checked)} className="mt-0.5 size-3.5 shrink-0 accent-[var(--color-brand)]" />
                              <span>{t(i.label)}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {error && <p className="text-sm text-st-cancelled">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setDraft(null)} className="tap h-11 flex-1 cursor-pointer rounded-xl border border-[var(--color-line)] text-sm font-medium hover:bg-[var(--color-surface-2)]">{t("Înapoi")}</button>
              <button type="submit" disabled={saving} className="tap h-11 flex-[2] cursor-pointer rounded-xl bg-brand text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
                {saving ? m.common.saving : t("Salvează șablonul")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
