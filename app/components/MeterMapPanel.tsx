"use client";

import { useMemo, useState } from "react";
import { PIN_COLOR, countMeterFilters, type MeterMapFilters, type MeterPin, type MeterPinsResponse } from "@/lib/map-meters";
import { useT } from "@/lib/i18n/context";
import { EMPTY_METER_FILTERS } from "@/lib/map-meters";

const sel = (on: boolean) => `h-8 w-full rounded-lg border px-2 text-xs outline-none focus:border-brand ${on ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)]"}`;

/**
 * Panoul „Straturi și filtre” al hărții: pornește / oprește proiectele și contoarele și filtrează contoarele cu locație (citit / necitit, neregulă, sector, localitate, rută, cine a citit,
 * sursa citirii, precizia locației, avertismente, căutare). Filtrele se aplică instant pe punctele din browser.
 */
export default function MeterMapPanel({
  data,
  pins,
  shown,
  filters,
  setFilters,
  projectsCount,
  showProjects,
  setShowProjects,
  showMeters,
  setShowMeters,
  loading,
  error,
  onFit,
}: {
  data: MeterPinsResponse | null;
  pins: MeterPin[];
  shown: MeterPin[];
  filters: MeterMapFilters;
  setFilters: (f: MeterMapFilters) => void;
  projectsCount: number;
  showProjects: boolean;
  setShowProjects: (v: boolean) => void;
  showMeters: boolean;
  setShowMeters: (v: boolean) => void;
  loading: boolean;
  error: string | null;
  onFit: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const n = countMeterFilters(filters);
  const sectors = useMemo(() => [...new Set(pins.map((p) => p.sector).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, "ro", { numeric: true })), [pins]);
  const localities = useMemo(() => [...new Set(pins.map((p) => p.locality).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ro")), [pins]);
  const readers = useMemo(() => [...new Set(pins.map((p) => p.by).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, "ro")), [pins]);
  const set = (patch: Partial<MeterMapFilters>) => setFilters({ ...filters, ...patch });
  const withoutLoc = data ? Math.max(0, data.total - data.pins.length) : 0;
  const stats = useMemo(() => {
    let read = 0, issue = 0;
    for (const p of shown) { if (p.value != null) read++; if (p.issue) issue++; }
    return { read, unread: shown.length - read, issue };
  }, [shown]);

  return (
    <div className="absolute left-3 top-3 z-10 w-[min(20rem,calc(100%-1.5rem))] rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-lg" data-map-panel="">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left">
        <span className="text-sm font-bold">🗺 {t("Straturi și filtre")}{n > 0 ? ` (${n})` : ""}</span>
        <span className="text-xs text-ink-soft">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="max-h-[calc(100dvh-14rem)] space-y-2 overflow-y-auto border-t border-[var(--color-line)] p-3">
          <div className="flex flex-col gap-1.5">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={showProjects} onChange={(e) => setShowProjects(e.target.checked)} className="size-4 accent-[var(--color-brand)]" />
              <span className="size-2.5 rounded-full bg-[#2563eb]" /> {t("Proiecte")} <span className="text-xs text-ink-soft">({projectsCount})</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={showMeters} onChange={(e) => setShowMeters(e.target.checked)} className="size-4 accent-[var(--color-brand)]" />
              <span className="size-2.5 rounded-full bg-[#16a34a]" /> {t("Contoare")} <span className="text-xs text-ink-soft">({data ? data.pins.length : "…"})</span>
              {loading && <span className="text-[11px] text-ink-soft">{t("se încarcă…")}</span>}
            </label>
          </div>

          {showMeters && (
            <>
              {error && <p className="rounded-lg bg-st-cancelled/10 px-2 py-1 text-xs text-st-cancelled">{t(error)}</p>}
              <input
                value={filters.q}
                onChange={(e) => set({ q: e.target.value })}
                placeholder={t("Caută contor, abonat, adresă…")}
                aria-label={t("Caută contor, abonat, adresă…")}
                className={`px-2.5 ${sel(!!filters.q)}`}
              />
              <div className="grid grid-cols-2 gap-1.5">
                <select value={filters.read} onChange={(e) => set({ read: e.target.value as MeterMapFilters["read"] })} className={sel(!!filters.read)} aria-label={t("Citire luna aceasta")}>
                  <option value="">{t("Citire: toate")}</option>
                  <option value="read">{t("Citite luna aceasta")}</option>
                  <option value="unread">{t("Necitite")}</option>
                </select>
                <select value={filters.issue} onChange={(e) => set({ issue: e.target.value as MeterMapFilters["issue"] })} className={sel(!!filters.issue)} aria-label={t("Neregulă")}>
                  <option value="">{t("Nereguli: toate")}</option>
                  <option value="any">{t("Cu neregulă")}</option>
                  <option value="serious">{t("Cu neregulă gravă")}</option>
                  <option value="none">{t("Fără neregulă")}</option>
                </select>
                <select value={filters.route} onChange={(e) => set({ route: e.target.value })} className={sel(!!filters.route)} aria-label={t("Rută")}>
                  <option value="">{t("Rută: toate")}</option>
                  <option value="none">{t("Fără rută")}</option>
                  {(data?.routes ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <select value={filters.sector} onChange={(e) => set({ sector: e.target.value })} className={sel(!!filters.sector)} aria-label={t("Sector")}>
                  <option value="">{t("Sector: toate")}</option>
                  {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select value={filters.locality} onChange={(e) => set({ locality: e.target.value })} className={sel(!!filters.locality)} aria-label={t("Localitate")}>
                  <option value="">{t("Localitate: toate")}</option>
                  {localities.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select value={filters.by} onChange={(e) => set({ by: e.target.value })} className={sel(!!filters.by)} aria-label={t("Citit de")}>
                  <option value="">{t("Citit de: toți")}</option>
                  {readers.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select value={filters.source} onChange={(e) => set({ source: e.target.value as MeterMapFilters["source"] })} className={sel(!!filters.source)} aria-label={t("Sursa citirii")}>
                  <option value="">{t("Sursa: toate")}</option>
                  <option value="portal">{t("🌐 Din portal (plătitor)")}</option>
                  <option value="field">{t("Cititor (în teren)")}</option>
                </select>
                <select value={filters.accuracy} onChange={(e) => set({ accuracy: e.target.value as MeterMapFilters["accuracy"] })} className={sel(!!filters.accuracy)} aria-label={t("Precizia locației")}>
                  <option value="">{t("Precizie: toate")}</option>
                  <option value="precise">{t("Precisă (≤ 30 m)")}</option>
                  <option value="fuzzy">{t("Nesigură (> 100 m)")}</option>
                </select>
              </div>
              <select value={filters.suspect} onChange={(e) => set({ suspect: e.target.value as MeterMapFilters["suspect"] })} className={sel(!!filters.suspect)} aria-label={t("De verificat")}>
                <option value="">{t("De verificat: toate")}</option>
                <option value="any">{t("Orice avertisment")}</option>
                <option value="lower">{t("Index mai mic decât cel anterior")}</option>
                <option value="high">{t("Consum neobișnuit de mare")}</option>
                <option value="low">{t("Consum neobișnuit de mic față de medie")}</option>
                <option value="far">{t("Citit departe de locația anterioară")}</option>
              </select>

              <div className="rounded-lg bg-[var(--color-surface-2)] px-2.5 py-1.5 text-xs">
                <p><b data-map-meter-count="" className="tabular-nums">{shown.length}</b> {t("din {total} contoare cu locație", { total: pins.length })}</p>
                <p className="mt-0.5 text-ink-soft">
                  <span style={{ color: PIN_COLOR.read }}>●</span> {stats.read} {t("citite")} · <span style={{ color: PIN_COLOR.unread }}>●</span> {stats.unread} {t("necitite")} · <span style={{ color: PIN_COLOR.issue }}>●</span> {stats.issue} {t("cu neregulă")}
                </p>
                {withoutLoc > 0 && <p className="mt-0.5 text-ink-soft">{t("{n} contoare încă fără locație (se completează la citire)", { n: withoutLoc })}</p>}
              </div>
              <div className="flex gap-1.5">
                <button type="button" onClick={onFit} disabled={shown.length === 0} className="tap h-8 flex-1 cursor-pointer rounded-lg border border-[var(--color-line)] text-xs font-medium hover:bg-brand-soft disabled:opacity-50">⤢ {t("Încadrează")}</button>
                {n > 0 && <button type="button" onClick={() => setFilters(EMPTY_METER_FILTERS)} className="tap h-8 flex-1 cursor-pointer rounded-lg border border-[var(--color-line)] text-xs font-medium hover:bg-[var(--color-surface-2)]">{t("Resetează filtrele")} ({n})</button>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
