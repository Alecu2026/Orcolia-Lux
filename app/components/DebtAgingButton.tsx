"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n/context";
import { AGING_BUCKETS, type AgingKey, type AgingReport } from "@/lib/debt-aging";
import { IconX } from "./icons";

/**
 * „Datorii pe vechime” (Facturi): plătitorii cu datorie, pe intervale — 1–3 luni, 3 luni–1 an, 1–3 ani, peste 3 ani. Se alege un interval (sau toate), se caută după nume / cont / adresă /
 * telefon, se filtrează după datoria minimă, iar lista (cu legătură spre fișa plătitorului) se poate descărca în CSV.
 */

const money = (n: number) => n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

export default function DebtAgingButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<AgingReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bucket, setBucket] = useState<AgingKey | "">("");
  const [q, setQ] = useState("");
  const [minDebt, setMinDebt] = useState("");

  useEffect(() => {
    if (!open || data) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch("/api/invoices/debt-aging")
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as (AgingReport & { error?: string }) | null;
        if (!r.ok || !j || j.error) throw new Error(j?.error ?? String(r.status));
        if (alive) setData(j);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, data]);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    const min = minDebt === "" ? NaN : Number(minDebt);
    return data.rows.filter(
      (r) =>
        (!bucket || r.bucket === bucket) &&
        (Number.isNaN(min) || r.debt >= min) &&
        (!needle || `${r.name} ${r.account ?? ""} ${r.address ?? ""} ${r.phone ?? ""}`.toLowerCase().includes(needle)),
    );
  }, [data, bucket, q, minDebt]);

  function exportCsv() {
    const label = (k: AgingKey) => t(AGING_BUCKETS.find((b) => b.key === k)?.label ?? k);
    const head = [t("Plătitor"), t("Cont / contract"), t("Adresă"), t("Telefon"), t("Datorie (MDL)"), t("Din luna"), t("Luni de datorie"), t("Interval")].map(csvCell).join(";");
    const body = rows.map((r) => [r.name, r.account ?? "", r.address ?? "", r.phone ?? "", r.debt.toFixed(2), r.since, r.months, label(r.bucket)].map(csvCell).join(";"));
    const blob = new Blob(["﻿" + [head, ...body].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `datorii-pe-vechime${bucket ? `-${bucket}` : ""}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const total = rows.reduce((s, r) => s + r.debt, 0);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("Plătitorii cu datorie, pe intervale de vechime: 1–3 luni, 3 luni–1 an, 1–3 ani")}
        className="tap h-7 cursor-pointer rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[11px] text-ink-soft hover:bg-[var(--color-surface-2)]"
      >
        {t("Datorii pe vechime")}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
          <div className="flex h-[94vh] w-full max-w-[min(97vw,1800px)] flex-col rounded-t-2xl bg-[var(--color-surface)] p-5 shadow-2xl sm:h-[92vh] sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">{t("Datorii pe vechime")}</h2>
                <p className="mt-1 text-xs text-ink-soft">
                  {t("Plătitorii cu datorie pe ultima factură. Vechimea e numărul de luni de la prima factură rămasă neachitată până azi. Alege un interval ca să vezi persoanele.")}
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="tap grid size-9 shrink-0 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={t("Închide")}>
                <IconX className="size-4" />
              </button>
            </div>

            {loading && <p className="py-6 text-center text-sm text-ink-soft">{t("Se calculează raportul…")}</p>}
            {error && <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</p>}

            {data && (
              <>
                <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {AGING_BUCKETS.map((b) => {
                    const s = data.buckets.find((x) => x.key === b.key);
                    const on = bucket === b.key;
                    return (
                      <button
                        key={b.key}
                        type="button"
                        onClick={() => setBucket(on ? "" : b.key)}
                        aria-pressed={on}
                        className={`rounded-xl border p-2.5 text-left ${on ? "border-brand bg-brand/10" : "border-[var(--color-line)] hover:bg-[var(--color-surface-2)]"}`}
                      >
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{t(b.label)}</div>
                        <div className="mt-0.5 text-lg font-bold tabular-nums">{(s?.count ?? 0).toLocaleString("ro-RO")}</div>
                        <div className="break-words text-xs text-ink-soft tabular-nums">{money(s?.sum ?? 0)} MDL</div>
                      </button>
                    );
                  })}
                </div>

                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Caută nume, cont, adresă, telefon…")} className="h-8 min-w-40 flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-sm" />
                  <input value={minDebt} onChange={(e) => setMinDebt(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder={t("Datorie minimă (MDL)")} className="h-8 w-40 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-sm" />
                  {bucket && (
                    <>
                      <Link href={`/platitori?aging=${bucket}`} className="tap inline-flex h-8 items-center rounded-lg border border-brand/50 px-2 text-[12px] font-medium text-brand hover:bg-brand/10">{t("Vezi în Plătitori →")}</Link>
                      <Link href={`/notificari-platitori?aging=${bucket}`} className="tap inline-flex h-8 items-center rounded-lg border border-brand/50 px-2 text-[12px] font-medium text-brand hover:bg-brand/10">{t("Trimite notificare →")}</Link>
                    </>
                  )}
                  <button type="button" onClick={exportCsv} disabled={rows.length === 0} className="tap h-8 rounded-lg border border-[var(--color-line)] px-2 text-[12px] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40">
                    ⬇ {t("Export CSV")}
                  </button>
                </div>
                <p className="mb-1 text-xs text-ink-soft">
                  {t("{n} plătitori · datorie totală {sum} MDL", { n: rows.length.toLocaleString("ro-RO"), sum: money(total) })}
                </p>

                <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--color-line)]">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-[var(--color-surface-2)] text-[11px] text-ink-soft">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">{t("Plătitor")}</th>
                        <th className="px-2 py-1.5 font-medium">{t("Cont / contract")}</th>
                        <th className="px-2 py-1.5 font-medium">{t("Adresă")}</th>
                        <th className="px-2 py-1.5 font-medium">{t("Telefon")}</th>
                        <th className="px-2 py-1.5 text-right font-medium">{t("Datorie (MDL)")}</th>
                        <th className="px-2 py-1.5 font-medium">{t("Din luna")}</th>
                        <th className="px-2 py-1.5 text-right font-medium">{t("Luni")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className="border-t border-[var(--color-line)]">
                          <td className="px-2 py-1"><Link href={`/platitori/${r.id}`} className="text-brand hover:underline">{r.name}</Link></td>
                          <td className="whitespace-nowrap px-2 py-1 font-mono">{r.account ?? "—"}</td>
                          <td className="px-2 py-1 text-ink-soft">{r.address ?? "—"}</td>
                          <td className="whitespace-nowrap px-2 py-1 text-ink-soft">{r.phone ?? "—"}</td>
                          <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{money(r.debt)}</td>
                          <td className="whitespace-nowrap px-2 py-1" title={r.approx ? t("Estimat: nu s-a găsit o factură neachitată (datoria vine din 1C); se folosește scadența ultimei facturi") : undefined}>{r.approx ? "≈ " : ""}{r.since}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{r.months}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rows.length === 0 && <p className="px-2 py-3 text-center text-ink-soft">{t("Niciun plătitor pentru filtrele alese.")}</p>}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
