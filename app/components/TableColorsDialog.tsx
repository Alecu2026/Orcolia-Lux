"use client";

import { useEffect } from "react";
import { COLOR_FIELDS, colorVars, hasColors, headStyle, type TableColors } from "@/lib/table-look";
import { useT } from "@/lib/i18n/context";
import ColorField from "./ColorField";
import { IconX } from "./icons";

/** Fereastra „Culori tabel”: fiecare culoare (antet, text, fundal, rânduri alternate, hover, linii) din paleta completă, cu previzualizare în direct și „Resetează”. Se salvează în localStorage. */
export default function TableColorsDialog({
  value,
  onChange,
  onClose,
}: {
  value: TableColors;
  onChange: (v: TableColors) => void;
  onClose: () => void;
}) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const set = (k: keyof TableColors) => (v: string | undefined) => {
    const next = { ...value };
    if (v) next[k] = v;
    else delete next[k];
    onChange(next);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label={t("Culori tabel")} className="card max-h-[94dvh] w-full max-w-2xl overflow-auto rounded-b-none rounded-t-2xl p-4 sm:rounded-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">🎨 {t("Culori tabel")}</h2>
            <p className="text-xs text-ink-soft">{t("Alege orice culoare din paletă. Rămân salvate în acest browser, pentru acest tabel.")}</p>
          </div>
          <button type="button" onClick={onClose} className="tap grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={t("Închide")}>
            <IconX className="size-4" />
          </button>
        </div>

        {/* previzualizare */}
        <div className="dt-root mb-3 overflow-hidden rounded-xl border border-[var(--color-line)]" style={colorVars(value)}>
          <table className="w-full border-separate border-spacing-0 text-[12px]">
            <thead>
              <tr>
                {["#", t("Titlu"), t("Status")].map((h) => (
                  <th key={h} className="border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-1.5 text-left font-semibold" style={headStyle(value)}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3].map((n) => (
                <tr key={n} className={n === 3 ? "dt-hover-sample" : ""}>
                  {[`#${n}`, n === 3 ? t("Rând sub cursor (hover)") : n === 2 ? t("Rând alternat") : t("Rând obișnuit"), t("În lucru")].map((c, i) => (
                    <td key={i} className={`border-b border-[var(--color-line)] px-2 py-1.5 ${n === 2 ? "bg-[var(--dt-zebra,color-mix(in_srgb,var(--color-surface-2)_70%,var(--color-surface)))]" : "bg-[var(--dt-row,var(--color-surface))]"}`}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          {COLOR_FIELDS.map((f) => (
            <ColorField key={f.key} label={f.label} hint={f.hint} value={value[f.key]} onChange={set(f.key)} fallback={f.key === "text" || f.key === "headText" ? "#0f172a" : f.key === "border" ? "#e2e8f0" : "#ffffff"} />
          ))}
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" disabled={!hasColors(value)} onClick={() => onChange({})} className="tap h-9 cursor-pointer rounded-lg border border-[var(--color-line)] px-4 text-sm hover:bg-[var(--color-surface-2)] disabled:cursor-default disabled:opacity-50">
            ↺ {t("Resetează toate culorile")}
          </button>
          <button type="button" onClick={onClose} className="tap h-9 cursor-pointer rounded-lg bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-strong">{t("Gata")}</button>
        </div>
      </div>
    </div>
  );
}
