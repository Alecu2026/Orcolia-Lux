"use client";

import { PALETTE, asHex } from "@/lib/table-look";
import { useT } from "@/lib/i18n/context";

/**
 * Alegerea unei culori din paleta COMPLETĂ: selectorul nativ (orice culoare), codul hex, o grilă de culori rapide și „Resetează”. `value` gol = culoarea implicită a temei.
 */
export default function ColorField({
  label,
  hint,
  value,
  onChange,
  fallback = "#ffffff",
}: {
  label: string;
  hint?: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  /** Ce arată selectorul nativ când nu e aleasă nicio culoare. */
  fallback?: string;
}) {
  const t = useT();
  const cur = asHex(value);
  return (
    <div className="rounded-xl border border-[var(--color-line)] p-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">{t(label)}</p>
        <button type="button" disabled={!cur} onClick={() => onChange(undefined)} className="cursor-pointer text-[11px] font-medium text-brand hover:underline disabled:cursor-default disabled:text-ink-soft/50 disabled:no-underline">
          ↺ {t("Resetează")}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="color"
          value={cur ?? fallback}
          onChange={(e) => onChange(e.target.value)}
          aria-label={t(label)}
          className="size-9 shrink-0 cursor-pointer rounded-lg border border-[var(--color-line)] bg-transparent p-0.5"
        />
        <input
          value={value ?? ""}
          onChange={(e) => {
            const v = e.target.value.trim();
            if (v === "") onChange(undefined);
            else if (asHex(v)) onChange(asHex(v));
          }}
          placeholder="#rrggbb"
          maxLength={7}
          spellCheck={false}
          aria-label={`${t(label)} (hex)`}
          className="h-8 w-24 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 font-mono text-xs outline-none focus:border-brand"
        />
        <span className="text-[11px] text-ink-soft">{cur ? "" : t("implicită")}</span>
      </div>
      <div className="mt-2 grid grid-cols-8 gap-1">
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            aria-label={c}
            title={c}
            className={`h-5 cursor-pointer rounded border ${cur === c ? "ring-2 ring-brand ring-offset-1" : "border-[var(--color-line)]"}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      {hint && <p className="mt-1.5 text-[10px] text-ink-soft">{t(hint)}</p>}
    </div>
  );
}
