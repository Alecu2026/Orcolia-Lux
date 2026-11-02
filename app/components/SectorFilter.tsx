"use client";

import { useEffect, useRef, useState } from "react";
import { SECTOR_SEP, cleanSectorList } from "@/lib/sector-filter";
import { useT } from "@/lib/i18n/context";

const PANEL_W = 256;
const MARGIN = 8;
const LIST_MAX = 256;
/** Antetul listei (titlu + „Șterge alegerea”) + padding: înălțimea ocupată în afara listei cu bife. */
const PANEL_CHROME = 44;

type Pos = { left: number; top: number; maxH: number };

/**
 * Locul listei față de butonul din pagină: rămâne ÎNTOTDEAUNA în ecran — se aliniază la marginea butonului, dar se mută spre stânga dacă ar ieși pe dreapta (filtrul stă adesea la capătul rândului),
 * și se deschide în sus dacă dedesubt nu e loc. Poziție fixă: nu o taie nici containerele cu derulare.
 */
function placePanel(btn: HTMLElement): Pos {
  const r = btn.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(PANEL_W, vw - 2 * MARGIN);
  const left = Math.max(MARGIN, Math.min(r.left, vw - w - MARGIN));
  const below = vh - r.bottom - MARGIN - 4;
  const above = r.top - MARGIN - 4;
  const wantH = LIST_MAX + PANEL_CHROME;
  if (below >= wantH || below >= above) return { left, top: r.bottom + 4, maxH: Math.max(96, Math.min(LIST_MAX, below - PANEL_CHROME)) };
  const maxH = Math.max(96, Math.min(LIST_MAX, above - PANEL_CHROME));
  return { left, top: r.top - 4 - (maxH + PANEL_CHROME), maxH };
}

/**
 * Filtru „Sector” (sectorul din 1C, „Участок”) cu alegere MULTIPLĂ: butonul arată sectorul ales (sau „N sectoare”), iar lista cu bife se deschide dedesubt.
 * Valoarea e textul filtrului („Sector 1|Sector 3”, vezi lib/sector-filter.ts); gol = toate sectoarele.
 */
export default function SectorFilter({
  options,
  value,
  onChange,
  className,
  kind = "sector",
}: {
  options: { value: string; count: number }[];
  value: string;
  onChange: (v: string) => void;
  /** Clasa butonului (aceeași ca la celelalte filtre din pagină, în funcție de „activ / inactiv”). */
  className: (active: boolean) => string;
  /** „sector” (sectoarele din 1C / din factură) sau „locality” (localitatea din adresă: or.Cahul, r-n.Cahul). */
  kind?: "sector" | "locality";
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const toggleOpen = () => {
    if (!open && btn.current) setPos(placePanel(btn.current));
    setOpen((o) => !o);
  };
  const chosen = value ? value.split(SECTOR_SEP) : [];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    // pagina se derulează / fereastra se redimensionează cât e deschisă lista: se repoziționează lângă buton
    const onMove = () => btn.current && setPos(placePanel(btn.current));
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open]);

  // fără sectoare completate în 1C și fără filtru activ, controlul nu are ce arăta
  if (options.length === 0 && chosen.length === 0) return null;
  // o valoare aleasă (din adresă / salvată) care nu mai există în date rămâne vizibilă, ca să poată fi scoasă
  const known = new Set(options.map((o) => o.value));
  const all = [...options, ...chosen.filter((c) => !known.has(c)).map((c) => ({ value: c, count: 0 }))];

  const toggle = (v: string) => onChange(cleanSectorList((chosen.includes(v) ? chosen.filter((x) => x !== v) : [...chosen, v]).join(SECTOR_SEP)));
  const loc = kind === "locality";
  const title = loc ? t("Localități") : t("Sectoare");
  const label = chosen.length === 0 ? (loc ? t("Localitate: toate") : t("Sector: toate")) : chosen.length === 1 ? chosen[0] : loc ? t("{n} localități", { n: chosen.length }) : t("{n} sectoare", { n: chosen.length });

  return (
    <div ref={box} className="relative">
      <button ref={btn} type="button" onClick={toggleOpen} aria-haspopup="listbox" aria-expanded={open} aria-label={title} title={loc ? t("Filtrează după localitate (poți alege mai multe)") : t("Filtrează după sectoare (poți alege mai multe)")} className={`${className(chosen.length > 0)} sel-arrow max-w-44 cursor-pointer truncate text-left`}>
        {label}
      </button>
      {open && pos && (
        <div role="listbox" aria-multiselectable style={{ position: "fixed", left: pos.left, top: pos.top, width: Math.min(PANEL_W, (typeof window === "undefined" ? PANEL_W : window.innerWidth) - 2 * MARGIN) }} className="z-50 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 shadow-lg">
          <div className="mb-1 flex items-center justify-between px-1.5 text-[11px] text-ink-soft">
            <span>{title}</span>
            {chosen.length > 0 && (
              <button type="button" onClick={() => onChange("")} className="cursor-pointer font-semibold text-brand hover:underline">
                {t("Șterge alegerea")}
              </button>
            )}
          </div>
          <div className="overflow-auto" style={{ maxHeight: pos.maxH }}>
            {all.map((o) => (
              <label key={o.value} role="option" aria-selected={chosen.includes(o.value)} className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-[12px] hover:bg-[var(--color-surface-2)]">
                <input type="checkbox" checked={chosen.includes(o.value)} onChange={() => toggle(o.value)} className="size-3.5 accent-[var(--color-brand)]" />
                <span className="min-w-0 flex-1 truncate">{o.value}</span>
                <span className="tabular-nums text-ink-soft">{o.count}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
