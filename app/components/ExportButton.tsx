"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";

type Format = "csv" | "xlsx" | "json";

/**
 * Export (Excel / CSV / JSON). Fără `filtered`: se descarcă prin adresă (GET), cu `params` ca filtre pe server.
 * Cu `filtered` (tabelele cu filtre în browser): se trimit id-urile rândurilor rămase în tabel, în ordinea lui, iar serverul le exportă exact pe acelea
 * — altfel exportul ar fi întors toată lista, nu ce se vede pe ecran.
 */
export default function ExportButton({
  entity,
  params = {},
  className,
  label = "Export",
  filtered = false,
  getIds,
  count,
}: {
  entity: string;
  params?: Record<string, string | undefined>;
  className?: string;
  label?: string;
  /** Tabelul are filtre active: se exportă doar rândurile din `getIds()`. */
  filtered?: boolean;
  getIds?: () => string[];
  /** Câte rânduri rămân în tabel (afișat în meniu). */
  count?: number;
}) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const byIds = filtered && !!getIds;

  function buildUrl(format: Format) {
    const sp = new URLSearchParams({ entity, format });
    for (const [k, v] of Object.entries(params)) {
      if (v) sp.set(k, v);
    }
    return `/api/export?${sp.toString()}`;
  }

  async function downloadByIds(format: Format) {
    setBusy(true);
    setError(false);
    try {
      const body: Record<string, unknown> = { entity, format, ids: getIds!() };
      for (const [k, v] of Object.entries(params)) if (v) body[k] = v;
      const res = await fetch("/api/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `${entity}.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setOpen(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const item = "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-2)] disabled:opacity-50";
  const FORMATS: { f: Format; icon: string; text: string }[] = [
    { f: "xlsx", icon: "📊", text: "Excel (.xlsx)" },
    { f: "csv", icon: "📄", text: "CSV (.csv)" },
    { f: "json", icon: "🧩", text: "JSON (.json)" },
  ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        data-export-filtered={byIds ? "1" : "0"}
        title={byIds ? tr("Export (cu filtrele)") : undefined}
        className={
          className ??
          "tap inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--color-line)] px-3 text-sm font-medium text-ink-soft hover:bg-[var(--color-surface-2)]"
        }
        aria-label={tr(label)}
      >
        <svg className="size-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 3v10m0 0-3-3m3 3 3-3M4 15h12" />
        </svg>
        {tr(label)}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 min-w-[170px] rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-xl">
            {byIds && (
              <p className="px-3 pb-1 pt-1.5 text-[11px] text-ink-soft" data-export-note>
                {tr("Export (cu filtrele)")}{count != null ? ` · ${count}` : ""}
              </p>
            )}
            {FORMATS.map(({ f, icon, text }) =>
              byIds ? (
                <button key={f} type="button" disabled={busy} onClick={() => void downloadByIds(f)} className={item}>
                  <span className="text-base">{icon}</span>
                  {tr(text)}
                </button>
              ) : (
                <a key={f} href={buildUrl(f)} download onClick={() => setOpen(false)} className={item}>
                  <span className="text-base">{icon}</span>
                  {tr(text)}
                </a>
              ),
            )}
            {error && <p className="px-3 py-1.5 text-xs text-st-cancelled">{tr("Eroare")}</p>}
          </div>
        </>
      )}
    </div>
  );
}
