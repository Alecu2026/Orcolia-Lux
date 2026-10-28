"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PALETTE, asHex } from "@/lib/table-look";
import { useT } from "@/lib/i18n/context";

/**
 * Culoarea unui rând: un cerc mic în rând (gol = fără culoare). Click → paleta (culori rapide + selectorul complet + „Fără culoare”). Fereastra se desenează în afara tabelului
 * (portal, poziție fixă), ca să nu fie tăiată de celula tabelului.
 */
export default function RowColorPicker({ value, onChange, disabled = false }: { value: string | null; onChange: (c: string | null) => void; disabled?: boolean }) {
  const t = useT();
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const cur = asHex(value ?? undefined);
  // selectorul complet trimite o valoare la fiecare mișcare: salvăm abia după o pauză, nu la fiecare nuanță
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => {
    if (!pos) return;
    const openedAt = Date.now();
    const close = () => setPos(null);
    // o derulare chiar la deschidere (ex. rândul adus în ecran) nu trebuie să închidă fereastra
    const closeOnScroll = () => { if (Date.now() - openedAt > 500) close(); };
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest("[data-row-color-pop]") && !btn.current?.contains(el)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [pos]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        disabled={disabled}
        aria-label={t("Culoarea rândului")}
        title={disabled ? undefined : t("Culoarea rândului")}
        onClick={(e) => {
          e.stopPropagation();
          const r = btn.current?.getBoundingClientRect();
          if (!r) return;
          setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 248)), top: Math.min(r.bottom + 4, window.innerHeight - 250) });
        }}
        className="grid size-4 shrink-0 cursor-pointer place-items-center rounded-full border border-[var(--color-line)] hover:ring-2 hover:ring-brand/40 disabled:cursor-default"
        style={cur ? { backgroundColor: cur, borderColor: cur } : undefined}
      >
        {!cur && <span className="text-[9px] leading-none text-ink-soft/60">＋</span>}
      </button>
      {pos &&
        createPortal(
          <div data-row-color-pop className="fixed z-[70] w-60 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-2.5 shadow-xl" style={{ left: pos.left, top: pos.top }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 grid grid-cols-8 gap-1">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  title={c}
                  onClick={() => { onChange(c); setPos(null); }}
                  className={`h-5 cursor-pointer rounded border ${cur === c ? "ring-2 ring-brand ring-offset-1" : "border-[var(--color-line)]"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input type="color" value={draft ?? cur ?? "#ffffff"} onChange={(e) => { const v = e.target.value; setDraft(v); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => { onChange(v); setDraft(null); }, 450); }} aria-label={t("Altă culoare")} title={t("Altă culoare (paleta completă)")} className="size-8 cursor-pointer rounded-lg border border-[var(--color-line)] bg-transparent p-0.5" />
              <span className="flex-1 text-[11px] text-ink-soft">{t("Altă culoare (paleta completă)")}</span>
              <button type="button" disabled={!cur} onClick={() => { onChange(null); setPos(null); }} className="cursor-pointer text-[11px] font-semibold text-brand hover:underline disabled:cursor-default disabled:text-ink-soft/50 disabled:no-underline">
                {t("Fără culoare")}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
