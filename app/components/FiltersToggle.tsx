"use client";

import { useT } from "@/lib/i18n/context";

/** Butonul „Filtre” care ascunde / arată filtrele paginii; cu numărul de filtre active (ca să se știe că lista e filtrată și când filtrele sunt ascunse). */
export default function FiltersToggle({ open, onToggle, activeCount = 0 }: { open: boolean; onToggle: () => void; activeCount?: number }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      title={open ? t("Ascunde filtrele") : t("Afișează filtrele")}
      className={`tap inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border px-2 text-[11px] font-medium ${
        open || activeCount > 0 ? "border-brand bg-brand/10 text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink-soft hover:bg-[var(--color-surface-2)]"
      }`}
    >
      <span aria-hidden>{open ? "▾" : "▸"}</span>
      {t("Filtre")}
      {activeCount > 0 && <span className="rounded-full bg-brand px-1.5 text-[10px] font-semibold leading-4 text-white">{activeCount}</span>}
    </button>
  );
}
