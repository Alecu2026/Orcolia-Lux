"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n/context";

type Opt = { id: string; name: string };

/** Peste atâtea opțiuni un `<select>` devine greu (mii de elemente în DOM, derulare imposibilă): se trece la căutare cu lista scurtă de potriviri. */
export const PICKER_SELECT_MAX = 150;
const SHOWN = 12;

/**
 * Filtru „Client” pentru liste mari de clienți (calendar, kanban): până la `PICKER_SELECT_MAX` rămâne un select obișnuit; peste, un câmp de căutare care arată cel mult 12 potriviri
 * (litere mici, orice parte din nume). Alegerea se face cu click; „✕” o șterge.
 */
export default function ClientFilterPicker({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: Opt[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  className?: string;
}) {
  const t = useT();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.id === value);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return options.slice(0, SHOWN);
    const out: Opt[] = [];
    for (const o of options) {
      if (o.name.toLowerCase().includes(term)) {
        out.push(o);
        if (out.length >= SHOWN) break;
      }
    }
    return out;
  }, [options, q]);

  if (options.length <= PICKER_SELECT_MAX) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={className} aria-label={label}>
        <option value="">{label}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    );
  }

  return (
    <div ref={box} className="relative" data-client-picker="">
      {selected ? (
        <button type="button" onClick={() => onChange("")} className={`${className} flex items-center gap-1.5 !pr-2 text-left`} title={t("Șterge filtrul")}>
          <span className="max-w-40 truncate">{selected.name}</span>
          <span aria-hidden>✕</span>
        </button>
      ) : (
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={label}
          aria-label={label}
          className={`${className} !pr-2`}
        />
      )}
      {open && !selected && (
        <ul className="absolute left-0 z-40 mt-1 max-h-72 w-64 overflow-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-1 text-xs shadow-xl">
          {matches.length === 0 ? (
            <li className="px-2 py-1.5 text-ink-soft">{t("Niciun client găsit")}</li>
          ) : (
            matches.map((o) => (
              <li key={o.id}>
                <button type="button" onClick={() => { onChange(o.id); setQ(""); setOpen(false); }} className="block w-full truncate rounded-lg px-2 py-1.5 text-left hover:bg-[var(--color-surface-2)]">
                  {o.name}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
