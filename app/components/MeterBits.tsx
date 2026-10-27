import type { ReactNode } from "react";

/** Casetă cu titlu pe fundal ușor și linie despărțitoare (aceeași înfățișare pe pagina contorului și în pop-up-uri). */
export function Section({ title, children, className = "" }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] ${className}`}>
      <h2 className="border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{title}</h2>
      <div className="divide-y divide-[var(--color-line)]">{children}</div>
    </section>
  );
}

/** Un rând „etichetă — valoare”. */
export function Item({ label, value, loading }: { label: string; value: ReactNode; loading?: boolean }) {
  const empty = value == null || value === "";
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2">
      <span className="shrink-0 text-[11px] text-ink-soft">{label}</span>
      <span className="min-w-0 break-words text-right text-[13px]">{loading && empty ? <span className="text-ink-soft">…</span> : empty ? <span className="text-ink-soft/60">—</span> : value}</span>
    </div>
  );
}

/** Dreptunghi gri care pulsează — în locul secțiunilor care încă se încarcă. */
export function Skeleton({ className = "h-40" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] ${className}`} />;
}
