"use client";

import { useEffect, useRef, useState } from "react";
import { SECTOR_SEP, cleanSectorList } from "@/lib/sector-filter";
import { useT } from "@/lib/i18n/context";

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
  const box = useRef<HTMLDivElement>(null);
  const chosen = value ? value.split(SECTOR_SEP) : [];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
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
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} aria-label={title} title={loc ? t("Filtrează după localitate (poți alege mai multe)") : t("Filtrează după sectoare (poți alege mai multe)")} className={`${className(chosen.length > 0)} sel-arrow max-w-44 cursor-pointer truncate text-left`}>
        {label}
      </button>
      {open && (
        <div role="listbox" aria-multiselectable className="absolute left-0 top-full z-30 mt-1 w-64 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 shadow-lg">
          <div className="mb-1 flex items-center justify-between px-1.5 text-[11px] text-ink-soft">
            <span>{title}</span>
            {chosen.length > 0 && (
              <button type="button" onClick={() => onChange("")} className="cursor-pointer font-semibold text-brand hover:underline">
                {t("Șterge alegerea")}
              </button>
            )}
          </div>
          <div className="max-h-64 overflow-auto">
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
