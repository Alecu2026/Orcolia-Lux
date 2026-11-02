"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { lorawanDiagAction } from "@/app/actions/lorawan";
import type { DiagKind, LorawanDiag } from "@/lib/lorawan";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";

const PER_PAGE = 100;
const KIND_CLS: Record<DiagKind, string> = {
  ok: "bg-st-done/12 text-st-done",
  stale: "bg-st-progress/12 text-st-progress",
  placeholder: "bg-st-new/12 text-st-new",
  unmatched: "bg-st-cancelled/12 text-st-cancelled",
  removed: "bg-st-confirmed/12 text-st-confirmed",
};
const KIND_ORDER: DiagKind[] = ["ok", "stale", "unmatched", "placeholder", "removed"];

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Diagnostic: toate numerele din feedul LoRaWAN, cu rezultatul potrivirii cu CRM-ul (găsit / ignorat / negăsit …). Se încarcă la cerere (descarcă feedul acum; doar citire). */
export default function LorawanDiagTable() {
  const t = useT();
  const tag = dateTag(useLocale());
  const [diag, setDiag] = useState<LorawanDiag | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [kind, setKind] = useState<"" | DiagKind>("");
  const [noPayer, setNoPayer] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const label = (k: DiagKind) =>
    k === "ok" ? t("Găsit în CRM") : k === "stale" ? t("Ignorat (altă lună)") : k === "unmatched" ? t("Negăsit în CRM") : k === "placeholder" ? t("Fără nicio transmisie") : t("Scos din uz în CRM");

  const load = async () => {
    setBusy(true);
    setErr(null);
    const r = await lorawanDiagAction().catch(() => ({ ok: false as const, error: "Nu am putut citi feedul LoRaWAN." }));
    if (r.ok) {
      setDiag(r.diag);
      setPage(1);
    } else setErr(t(r.error));
    setBusy(false);
  };

  const counts = useMemo(() => {
    const per = new Map<DiagKind, Set<string>>();
    const noPay = new Set<string>();
    for (const r of diag?.rows ?? []) {
      (per.get(r[3]) ?? per.set(r[3], new Set()).get(r[3])!).add(r[0]);
      if ((r[3] === "ok" || r[3] === "stale") && !r[6]) noPay.add(r[0]);
    }
    return { per, noPay: noPay.size, total: new Set((diag?.rows ?? []).map((r) => r[0])).size };
  }, [diag]);

  const nq = norm(q.trim());
  const rows = useMemo(
    () =>
      (diag?.rows ?? []).filter((r) => {
        if (kind && r[3] !== kind) return false;
        if (noPayer && !((r[3] === "ok" || r[3] === "stale") && !r[6])) return false;
        if (nq && !norm(`${r[0]} ${r[4]} ${r[7]} ${r[8]}`).includes(nq)) return false;
        return true;
      }),
    [diag, kind, noPayer, nq],
  );
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const cur = Math.min(page, pages);
  const shown = rows.slice((cur - 1) * PER_PAGE, cur * PER_PAGE);
  const when = (ms: number) => new Date(ms).toLocaleString(tag, { dateStyle: "short", timeStyle: "short" });
  const nf = (n: number) => n.toLocaleString(tag);

  const exportCsv = () => {
    const esc = (v: string | number) => {
      const s = String(v);
      return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = [t("Număr LoRaWAN"), t("Volum (m³)"), t("Ultima transmisie"), t("Rezultat"), t("Contor în CRM"), t("Potrivire"), t("Plătitor"), t("Adresă"), t("Citirea lunii")];
    const lines = [head.map(esc).join(";"), ...rows.map((r) => [r[0], String(r[1]).replace(".", ","), when(r[2]), label(r[3]), r[4], r[10], r[7], r[8], r[9]].map(esc).join(";"))];
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lorawan-${diag?.period ?? "feed"}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const chip = (on: boolean) => `tap h-8 cursor-pointer rounded-full border px-3 text-xs font-medium ${on ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)]"}`;

  return (
    <section className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4" data-lorawan-diag="">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{t("Toate contoarele din feed (depanare)")}</h2>
          <p className="text-xs text-ink-soft">{t("Descarcă feedul acum și arată fiecare număr: găsit în CRM (cu contorul și plătitorul), ignorat, fără transmisii, negăsit sau scos din uz. Nu scrie nimic.")}</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={busy} data-lorawan-diag-load="" className="tap h-10 cursor-pointer rounded-xl border border-brand/50 px-4 text-sm font-semibold text-brand hover:bg-brand-soft disabled:opacity-50">
          {busy ? t("Se încarcă…") : diag ? t("Reîncarcă lista") : t("Încarcă lista")}
        </button>
      </div>
      {err && <p className="mt-2 text-sm text-st-cancelled">{err}</p>}

      {diag && (
        <div className="mt-3 space-y-3">
          <p className="text-[11px] text-ink-soft">
            {t("{n} numere în feed · citit la {when}", { n: nf(counts.total), when: when(diag.at) })}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" className={chip(kind === "" && !noPayer)} onClick={() => { setKind(""); setNoPayer(false); setPage(1); }}>
              {t("Toate")} <span className="tabular-nums opacity-80">{nf(counts.total)}</span>
            </button>
            {KIND_ORDER.map((k) => (
              <button key={k} type="button" data-diag-kind={k} className={chip(kind === k)} onClick={() => { setKind(kind === k ? "" : k); setPage(1); }}>
                {label(k)} <span className="tabular-nums opacity-80">{nf(counts.per.get(k)?.size ?? 0)}</span>
              </button>
            ))}
            <button type="button" data-diag-nopayer="" className={chip(noPayer)} onClick={() => { setNoPayer((v) => !v); setPage(1); }}>
              {t("Fără plătitor")} <span className="tabular-nums opacity-80">{nf(counts.noPay)}</span>
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
              placeholder={t("Caută număr, contor CRM, plătitor sau adresă…")}
              aria-label={t("Caută număr, contor CRM, plătitor sau adresă…")}
              className="h-9 min-w-52 flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 text-sm"
            />
            <span className="text-[11px] text-ink-soft">{t("{n} rânduri", { n: nf(rows.length) })}</span>
            <button type="button" onClick={exportCsv} disabled={rows.length === 0} className="tap h-9 cursor-pointer rounded-lg border border-[var(--color-line)] px-3 text-xs font-semibold hover:bg-[var(--color-surface-2)] disabled:opacity-50">
              {t("Export CSV")}
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-[var(--color-line)]">
            <table className="w-full min-w-[860px] text-left text-xs">
              <thead className="bg-[var(--color-surface-2)] text-[11px] uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="px-2 py-1.5">{t("Număr LoRaWAN")}</th>
                  <th className="px-2 py-1.5 text-right">{t("Volum (m³)")}</th>
                  <th className="px-2 py-1.5">{t("Ultima transmisie")}</th>
                  <th className="px-2 py-1.5">{t("Rezultat")}</th>
                  <th className="px-2 py-1.5">{t("Contor în CRM")}</th>
                  <th className="px-2 py-1.5">{t("Plătitor")}</th>
                  <th className="px-2 py-1.5">{t("Citirea lunii")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={`${r[0]}-${r[5]}-${i}`} className="border-t border-[var(--color-line)]" data-diag-row={r[3]}>
                    <td className="px-2 py-1.5 font-mono">{r[0]}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{nf(r[1])}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-ink-soft">{when(r[2])}</td>
                    <td className="px-2 py-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${KIND_CLS[r[3]]}`}>{label(r[3])}</span>
                    </td>
                    <td className="px-2 py-1.5">
                      {r[5] ? (
                        <Link href={`/contoare/${encodeURIComponent(r[5])}`} className="font-mono text-brand hover:underline">{r[4]}</Link>
                      ) : (
                        <span className="text-ink-soft">—</span>
                      )}
                      {r[10] === "cu text" && <span className="ml-1 text-[10px] text-ink-soft" title={t("Numărul din CRM are text lângă el (-wc, -bc, zerouri…)")}>≈</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      {r[6] ? <Link href={`/platitori/${r[6]}`} className="text-brand hover:underline">{r[7] || r[6]}</Link> : r[5] ? <span className="text-st-cancelled">{t("fără plătitor")}</span> : <span className="text-ink-soft">—</span>}
                      {r[8] && <span className="block max-w-72 truncate text-[10px] text-ink-soft">{r[8]}</span>}
                    </td>
                    <td className="px-2 py-1.5 text-ink-soft">{r[9] || "—"}</td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-4 text-center text-ink-soft">{t("Niciun rând pentru aceste filtre.")}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-between gap-2 text-xs">
              <button type="button" disabled={cur <= 1} onClick={() => setPage(cur - 1)} className="tap h-8 cursor-pointer rounded-lg border border-[var(--color-line)] px-3 disabled:opacity-40">{t("Înapoi")}</button>
              <span className="tabular-nums text-ink-soft">{cur} / {pages}</span>
              <button type="button" disabled={cur >= pages} onClick={() => setPage(cur + 1)} className="tap h-8 cursor-pointer rounded-lg border border-[var(--color-line)] px-3 disabled:opacity-40">{t("Înainte")}</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
