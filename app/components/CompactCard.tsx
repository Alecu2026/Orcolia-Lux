"use client";

import { useState, type ReactNode } from "react";

/**
 * Rând compact pentru „Mod telefon": o linie mică (cerc cu inițială, titlu, o linie scurtă de rezumat, săgeată). La atingere se desface
 * și arată restul informației; la a doua atingere se închide. Atingerea pe un buton, link sau câmp din rând nu îl desface/închide.
 */
export default function CompactCard({
  avatar,
  title,
  subtitle,
  leading,
  trailing,
  children,
  className = "",
  defaultOpen = false,
  selected = false,
}: {
  /** Litera din cerc (prima literă a titlului). */
  avatar?: string;
  title: ReactNode;
  /** Rezumat sub titlu (valori scurte, separate prin „·"). */
  subtitle?: ReactNode;
  /** Înainte de cerc (ex. căsuța de selectare). */
  leading?: ReactNode;
  /** În dreapta titlului, înainte de săgeată (ex. suma). */
  trailing?: ReactNode;
  /** Informația care apare la desfacere. */
  children?: ReactNode;
  className?: string;
  defaultOpen?: boolean;
  selected?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  function onClick(e: React.MouseEvent) {
    const el = e.target as HTMLElement;
    if (el.closest("a,button,input,select,textarea,label,[data-no-toggle]")) return;
    setOpen((o) => !o);
  }

  return (
    <div className={`overflow-hidden rounded-xl border bg-[var(--color-surface)] ${selected ? "border-brand bg-brand-soft/40" : "border-[var(--color-line)]"} ${className}`}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onClick}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 active:bg-brand-soft/30"
      >
        {leading}
        {avatar !== undefined && (
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand/15 text-[12px] font-bold text-brand" aria-hidden>
            {avatar || "•"}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold leading-tight">{title}</div>
          {subtitle != null && subtitle !== false && (
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0 text-[11px] leading-tight text-ink-soft">{subtitle}</div>
          )}
        </div>
        {trailing != null && <div className="shrink-0 text-[12px]">{trailing}</div>}
        <span className={`shrink-0 text-[11px] text-ink-soft transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>▾</span>
      </div>
      {open && children != null && (
        // Partea desfăcută: lista de câmpuri devine un mini-tabel cu chenar (etichetă | valoare), iar butoanele stau separat dedesubt.
        <div className="space-y-2 border-t border-[var(--color-line)] bg-[var(--color-surface-2)]/40 p-2 [&>dl]:overflow-hidden [&>dl]:rounded-lg [&>dl]:border [&>dl]:border-[var(--color-line)] [&>dl]:bg-[var(--color-surface)] [&>div]:border-0! [&>div]:px-0! [&>div]:py-0!">
          {children}
        </div>
      )}
    </div>
  );
}

/** Un câmp din partea desfăcută: etichetă (pe fundal diferit, în coloana ei) | valoare, cu linii între rânduri — ușor de parcurs cu ochii. */
export function CompactField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(5.25rem,36%)_1fr] border-b border-[var(--color-line)] text-[12px] leading-snug last:border-b-0">
      <dt className="flex items-center border-r border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-soft">{label}</dt>
      <dd className="min-w-0 break-words px-2.5 py-1.5">{children}</dd>
    </div>
  );
}
