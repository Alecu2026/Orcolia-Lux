"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { type MeterRowBase } from "@/lib/meters";
import MeterDetailDialog from "./MeterDetailDialog";
import { peekMeterRows } from "./useMeterDataset";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";

/**
 * „Contoarele plătitorului", pe fișa plătitorului: toate contoarele lui (active și scoase), cu pop-up la click pe rând și pagina proprie a fiecărui contor.
 * Rândurile vin din lista de contoare deja încărcată în browser, dacă a fost deschisă în această sesiune (instant, fără cerere); altfel din cele trimise
 * de server odată cu pagina (`initial`, filtrate pe plătitor — nu se descarcă lista întreagă).
 */
export default function PayerMeters({
  clientId,
  initial,
  canTask,
  canEditInvoices,
  canRead = false,
}: {
  clientId: string;
  initial: MeterRowBase[];
  canTask: boolean;
  canEditInvoices: boolean;
  canRead?: boolean;
}) {
  const t = useT();
  const tag = dateTag(useLocale());
  const [mem] = useState(() => peekMeterRows());
  const rows = useMemo(() => {
    const list = mem ? mem.filter((r) => r.clientId === clientId) : initial;
    // active primele, apoi după număr
    return [...list].sort((a, b) => Number(!!a.removedAt) - Number(!!b.removedAt) || a.contor.localeCompare(b.contor, "ro", { numeric: true }));
  }, [mem, clientId, initial]);
  const [open, setOpen] = useState<MeterRowBase | null>(null);

  const nf = (n: number) => n.toLocaleString(tag, { maximumFractionDigits: 3 });
  const dmy = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join(".") : "—");
  const taskHref = (r: MeterRowBase) =>
    `/tasks?${new URLSearchParams({ create: "task", client: r.clientId ?? "", desc: [`${t("Contor")} ${r.contor}`, r.name, r.account ?? r.contract, r.phone].filter(Boolean).join(" · ") }).toString()}`;

  return (
    <div>
      <h2 className="mb-2 text-base font-bold">{t("Contoarele plătitorului ({n})", { n: rows.length })}</h2>
      {rows.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-soft">{t("Niciun contor pentru acest plătitor.")}</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead className="bg-[var(--color-surface-2)] text-left text-[11px] text-ink-soft">
              <tr>
                <th className="px-3 py-1.5 font-semibold">{t("Nr. contor")}</th>
                <th className="px-3 py-1.5 font-semibold">{t("Status")}</th>
                <th className="px-3 py-1.5 font-semibold">{t("Consumator")}</th>
                <th className="px-3 py-1.5 font-semibold">{t("Instalat")}</th>
                <th className="px-3 py-1.5 text-right font-semibold">{t("Citire curentă")}</th>
                <th className="px-3 py-1.5 font-semibold">{t("Data citirii")}</th>
                <th className="px-3 py-1.5 text-right font-semibold">{t("Consum (m³)")}</th>
                <th className="px-3 py-1.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {rows.map((r) => {
                return (
                  <tr key={r.id} onClick={() => setOpen(r)} className={`cursor-pointer hover:bg-brand-soft/30 ${r.removedAt ? "text-ink-soft" : ""}`}>
                    <td className="whitespace-nowrap px-3 py-2 font-mono font-semibold">{r.contor}</td>
                    <td className="px-3 py-2">
                      {r.removedAt ? (
                        <span className="rounded-full bg-st-cancelled/12 px-1.5 text-[10px] font-medium text-st-cancelled" title={`${t("Scos la")} ${dmy(r.removedAt)}`}>{t("Scos")}</span>
                      ) : (
                        <span className="rounded-full bg-st-done/12 px-1.5 text-[10px] font-medium text-st-done">{t("Activ")}</span>
                      )}
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-2" title={r.consumator ?? ""}>{r.consumator ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2">{dmy(r.installedAt)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.curr != null ? `${nf(r.curr)} m³` : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2">{dmy(r.currDate)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${r.consum != null && r.consum > 0 ? "font-semibold" : ""}`}>{r.consum != null ? `${nf(r.consum)} m³` : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      <button type="button" onClick={() => setOpen(r)} className="tap mr-1.5 h-7 cursor-pointer rounded-lg border border-[var(--color-line)] px-2.5 text-xs font-medium hover:bg-brand-soft">
                        {t("Fișa")}
                      </button>
                      <Link href={`/contoare/${encodeURIComponent(r.id)}`} className="tap inline-flex h-7 items-center rounded-lg bg-brand px-2.5 text-xs font-semibold text-white hover:bg-brand-strong">
                        {t("Pagina contorului →")}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <MeterDetailDialog
          row={open}
          rows={mem}
          canTask={canTask}
          canEditInvoices={canEditInvoices}
          canRead={canRead}
          taskHref={taskHref}
          onSelect={(r) => setOpen(r)}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
