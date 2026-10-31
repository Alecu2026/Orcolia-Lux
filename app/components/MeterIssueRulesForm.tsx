"use client";

import { useState, useTransition } from "react";
import { saveMeterIssueRulesAction } from "@/app/actions/meter-issues";
import { DEFAULT_ISSUE_RULES, ISSUE_DAYS_MAX, ISSUE_KINDS, ISSUE_LABELS, type IssueRules } from "@/lib/meter-issues";
import { useT } from "@/lib/i18n/context";
import { useToast } from "./toast";

const inp = "h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-sm outline-none focus:border-brand";

/**
 * Regulile neregulilor de contor, pe tipuri: cine remediază (client / companie / de stabilit la fața locului), în câte zile de la raportare și ce secție răspunde.
 * Se aplică automat când un cititor sau clientul raportează o neregulă; biroul le poate corecta apoi pe fiecare neregulă în parte.
 */
export default function MeterIssueRulesForm({ initial, teams, canEdit }: { initial: IssueRules; teams: { id: string; name: string }[]; canEdit: boolean }) {
  const t = useT();
  const toast = useToast();
  const [rules, setRules] = useState<IssueRules>(initial);
  const [pending, start] = useTransition();

  const set = (k: (typeof ISSUE_KINDS)[number], patch: Partial<IssueRules[typeof k]>) => setRules((r) => ({ ...r, [k]: { ...r[k], ...patch } }));
  function save() {
    start(async () => {
      const r = await saveMeterIssueRulesAction(rules);
      if (r.error) toast.error(t(r.error));
      else toast.success(t("Regulile neregulilor au fost salvate."));
    });
  }

  return (
    <div className="card flex flex-col gap-4 p-5" data-issue-rules="">
      <div>
        <h2 className="text-base font-bold">{t("Reguli pentru nereguli de contor")}</h2>
        <p className="text-sm text-ink-soft">{t("Pentru fiecare tip de neregulă: cine remediază, în câte zile de la raportare și ce secție răspunde. Se aplică automat la raportare; pe fiecare neregulă se pot corecta apoi.")}</p>
      </div>
      <div className="flex flex-col gap-3">
        {ISSUE_KINDS.map((k) => (
          <div key={k} className="grid grid-cols-2 items-end gap-2 border-b border-[var(--color-line)] pb-3 last:border-0 sm:grid-cols-[1.4fr_1fr_5.5rem_1.2fr]" data-rule={k}>
            <p className="col-span-2 text-sm font-semibold sm:col-span-1 sm:self-center">{t(ISSUE_LABELS[k])}</p>
            <label className="text-xs text-ink-soft">
              {t("Cine remediază")}
              <select name={`${k}-responsible`} value={rules[k].responsible} disabled={!canEdit} onChange={(e) => set(k, { responsible: e.target.value as IssueRules[typeof k]["responsible"] })} className={`${inp} mt-1 w-full`}>
                <option value="">{t("De stabilit")}</option>
                <option value="CLIENT">{t("Clientul")}</option>
                <option value="COMPANY">{t("Compania")}</option>
              </select>
            </label>
            <label className="text-xs text-ink-soft">
              {t("Zile")}
              <input name={`${k}-days`} type="number" min={1} max={ISSUE_DAYS_MAX} value={rules[k].days} disabled={!canEdit} onChange={(e) => set(k, { days: Math.max(1, Math.min(ISSUE_DAYS_MAX, Math.floor(Number(e.target.value)) || 1)) })} className={`${inp} mt-1 w-full`} />
            </label>
            <label className="col-span-2 text-xs text-ink-soft sm:col-span-1">
              {t("Secția responsabilă")}
              <select name={`${k}-team`} value={rules[k].teamId} disabled={!canEdit} onChange={(e) => set(k, { teamId: e.target.value })} className={`${inp} mt-1 w-full`}>
                <option value="">{t("Fără secție")}</option>
                {teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="flex gap-2">
          <button type="button" onClick={save} disabled={pending} className="tap h-9 rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-60">{pending ? t("Se salvează…") : t("Salvează")}</button>
          <button type="button" onClick={() => setRules(structuredClone(DEFAULT_ISSUE_RULES))} className="tap h-9 rounded-lg border border-[var(--color-line)] px-3 text-sm hover:bg-[var(--color-surface-2)]">{t("Valori implicite")}</button>
        </div>
      )}
    </div>
  );
}
