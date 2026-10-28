"use client";

import { useMemo, useState } from "react";
import { resolveIssueAction } from "@/app/actions/meter-routes";
import { ISSUE_LABELS, SERIOUS_ISSUES, highRatio, onecIndicators, type IssueDto } from "@/lib/meter-issues";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";
import { useToast } from "./toast";

type Month = { month: string; prev: number | null; curr: number | null; consum: number | null; sursa: string | null };

/**
 * „Starea contorului și nereguli”: neregulile raportate de cititori în teren (defect, fraudă, curgere inversă…) și, separat, indicatorii deduși din datele 1C
 * (index mai mic decât cel anterior, consum zero luni la rând, consum estimat, consum mult peste medie, sigiliu lipsă). Cine are dreptul le poate marca rezolvate.
 */
export default function MeterIssuesPanel({
  issues: initial,
  canManage,
  months,
  sigiliu,
  removedAt,
}: {
  issues: IssueDto[];
  canManage: boolean;
  months: Month[];
  sigiliu: string | null;
  removedAt: string | null;
}) {
  const t = useT();
  const toast = useToast();
  const tag = dateTag(useLocale());
  const [issues, setIssues] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const indicators = useMemo(() => onecIndicators({ months, sigiliu, removedAt }), [months, sigiliu, removedAt]);
  const open = issues.filter((i) => !i.resolvedAt);
  const done = issues.filter((i) => i.resolvedAt);
  const dt = (iso: string) => new Date(iso).toLocaleString(tag, { dateStyle: "short", timeStyle: "short" });

  async function resolve(i: IssueDto) {
    const note = window.prompt(t("Cum a fost rezolvată neregula? (opțional)"), "");
    if (note === null) return;
    setBusy(i.id);
    try {
      const r = await resolveIssueAction(i.id, note);
      if (!r.ok) {
        toast.error(t(r.error ?? "Nu am putut salva."));
        return;
      }
      setIssues((list) => list.map((x) => (x.id === i.id ? { ...x, resolvedAt: new Date().toISOString(), resolvedNote: note.trim() || null, resolvedName: "—" } : x)));
      toast.success(t("Neregula a fost marcată ca rezolvată."));
    } catch {
      toast.error(t("Nu am putut salva."));
    } finally {
      setBusy(null);
    }
  }

  const label = (x: (typeof indicators)[number]) => {
    if (x.code === "ZERO") return t(x.label, { n: x.detail });
    if (x.code === "HIGH") return t(x.label, { x: highRatio(x.detail) });
    if (x.code === "REMOVED") return t(x.label, { date: x.detail.split("-").reverse().join(".") });
    return t(x.label);
  };

  return (
    <div>
      {open.length === 0 && indicators.length === 0 && <p className="px-3 py-3 text-sm text-ink-soft">{t("Nicio neregulă raportată sau detectată.")}</p>}
      {open.length > 0 && (
        <ul className="divide-y divide-[var(--color-line)]">
          {open.map((i) => (
            <li key={i.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className={`font-semibold ${SERIOUS_ISSUES.includes(i.kind) ? "text-st-cancelled" : "text-st-progress"}`}>⚑ {t(ISSUE_LABELS[i.kind])}</span>
              <span className="text-xs text-ink-soft">{dt(i.reportedAt)} · {i.userName}</span>
              {i.note && <p className="w-full text-[13px]">{i.note}</p>}
              {canManage && (
                <button type="button" disabled={busy === i.id} onClick={() => void resolve(i)} className="tap ml-auto h-7 cursor-pointer rounded-lg border border-[var(--color-line)] px-2 text-xs hover:bg-[var(--color-surface-2)] disabled:opacity-50">
                  {t("Marchează rezolvată")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {indicators.length > 0 && (
        <div className="border-t border-[var(--color-line)] px-3 py-2">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{t("Indicatori din datele 1C")}</p>
          <ul className="space-y-1 text-[13px]">
            {indicators.map((x) => (
              <li key={x.code} className="flex flex-wrap gap-x-2">
                <span className={x.serious ? "font-semibold text-st-cancelled" : "text-st-progress"}>{x.serious ? "⚠" : "ℹ"} {label(x)}</span>
                {x.detail && x.code !== "ZERO" && x.code !== "REMOVED" && <span className="text-xs text-ink-soft">{x.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {done.length > 0 && (
        <details className="border-t border-[var(--color-line)] px-3 py-2">
          <summary className="cursor-pointer text-xs font-semibold text-brand">{t("Rezolvate")} ({done.length})</summary>
          <ul className="mt-1 space-y-1 text-[13px]">
            {done.map((i) => (
              <li key={i.id} className="text-ink-soft">
                <span className="font-medium text-ink">{t(ISSUE_LABELS[i.kind])}</span> · {dt(i.reportedAt)} · {i.userName}
                {i.note ? ` — ${i.note}` : ""}
                <span className="block text-xs">✓ {i.resolvedAt ? dt(i.resolvedAt) : ""}{i.resolvedName && i.resolvedName !== "—" ? ` · ${i.resolvedName}` : ""}{i.resolvedNote ? ` — ${i.resolvedNote}` : ""}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
