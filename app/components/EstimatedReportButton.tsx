"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n/context";
import type { EstimatedReport } from "@/lib/services/estimated-meters";
import { IconX } from "./icons";

/**
 * „Raport estimate” (Citiri teren): contoarele care au avut valoare ESTIMATĂ (calculată) în fiecare dintre ultimele N luni la rând, adică pe care nu le-a citit niciun cititor
 * în perioada aleasă. N se alege (2–12). Lista se poate descărca (CSV, se deschide în Excel).
 */

const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;

export default function EstimatedReportButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [months, setMonths] = useState(3);
  const [data, setData] = useState<EstimatedReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    fetch(`/api/contoare/estimated?months=${months}`)
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as (EstimatedReport & { error?: string }) | null;
        if (!r.ok || !j || j.error) throw new Error(j?.error ?? String(r.status));
        if (alive) setData(j);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, months]);

  const needle = q.trim().toLowerCase();
  const rows = (data?.rows ?? []).filter((r) => !needle || `${r.contor} ${r.name} ${r.address ?? ""}`.toLowerCase().includes(needle));

  function exportCsv() {
    if (!data) return;
    const head = [t("Nr. contor"), t("Abonat"), t("Adresă"), t("Sector 1C")].map(csvCell).join(";");
    const body = rows.map((r) => [r.contor, r.name, r.address ?? "", r.sector ?? ""].map(csvCell).join(";"));
    const blob = new Blob(["﻿" + [head, ...body].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `contoare-estimate-${months}-luni.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("Contoarele cu valoare estimată (necitită de cititor) în fiecare dintre ultimele luni alese")}
        className="tap inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[12px] text-ink-soft hover:bg-[var(--color-surface-2)]"
      >
        📊 {t("Raport estimate")}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-t-2xl bg-[var(--color-surface)] p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">{t("Contoare cu citire estimată")}</h2>
                <p className="mt-1 text-xs text-ink-soft">
                  {t("Contoarele a căror valoare a fost calculată (estimată), nu citită, în fiecare dintre lunile alese la rând: nu le-a citit niciun cititor în perioada asta. O lună cu citire reală (cititor, portal, LoRaWAN) întrerupe șirul.")}
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="tap grid size-9 shrink-0 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={t("Închide")}>
                <IconX className="size-4" />
              </button>
            </div>

            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-1.5">
                {t("Luni la rând")}
                <select value={months} onChange={(e) => setMonths(Number(e.target.value))} className="h-8 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-sm">
                  {[2, 3, 4, 5, 6, 9, 12].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Caută contor, abonat, adresă…")} className="h-8 min-w-40 flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-sm" />
              <button type="button" onClick={exportCsv} disabled={!data || rows.length === 0} className="tap h-8 rounded-lg border border-[var(--color-line)] px-2 text-[12px] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40">
                ⬇ {t("Export CSV")}
              </button>
            </div>

            {loading && <p className="py-6 text-center text-sm text-ink-soft">{t("Se calculează raportul…")}</p>}
            {error && <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</p>}
            {data && !loading && (
              <>
                <p className="mb-1 text-xs text-ink-soft">
                  {data.months.length > 0
                    ? t("{n} contoare estimate în toate lunile: {from} … {to}", { n: rows.length.toLocaleString("ro-RO"), from: data.months[0], to: data.months[data.months.length - 1] })
                    : t("Nu sunt date 1C pentru perioada aleasă.")}
                </p>
                <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--color-line)]">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-[var(--color-surface-2)] text-[11px] text-ink-soft">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">{t("Nr. contor")}</th>
                        <th className="px-2 py-1.5 font-medium">{t("Abonat")}</th>
                        <th className="px-2 py-1.5 font-medium">{t("Adresă")}</th>
                        <th className="px-2 py-1.5 font-medium">{t("Sector 1C")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 500).map((r) => (
                        <tr key={r.id} className="border-t border-[var(--color-line)]">
                          <td className="whitespace-nowrap px-2 py-1 font-mono">
                            <Link href={`/contoare/${encodeURIComponent(r.id)}`} className="text-brand hover:underline">{r.contor}</Link>
                          </td>
                          <td className="px-2 py-1">{r.name}</td>
                          <td className="px-2 py-1 text-ink-soft">{r.address ?? "—"}</td>
                          <td className="px-2 py-1 text-ink-soft">{r.sector ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rows.length > 500 && <p className="px-2 py-1.5 text-[11px] text-ink-soft">{t("Se afișează primele 500; restul în exportul CSV.")}</p>}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
