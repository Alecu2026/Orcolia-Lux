"use client";

import { useEffect, useState, type ReactNode } from "react";
import { IconChevronRight } from "./icons";

/**
 * Secțiune care se deschide / închide din antet (dropdown). Starea se ține minte în browser, per secțiune (`id`), ca fișa unui plătitor
 * să arate la următoarea deschidere exact cum ai lăsat-o. Prima randare (și serverul) folosește `defaultOpen`; alegerea salvată se aplică imediat după.
 */
export default function CollapsibleSection({
  id,
  title,
  count,
  summary,
  defaultOpen = true,
  children,
}: {
  id: string;
  title: ReactNode;
  /** Numărul de elemente, arătat în antet (chiar și închisă secțiunea). */
  count?: number;
  /** Câteva cuvinte în dreapta antetului (ex. totalul de plată), vizibile și când secțiunea e închisă. */
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    try {
      const v = localStorage.getItem(`sec:${id}`);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (v === "1" || v === "0") setOpen(v === "1");
    } catch {}
  }, [id]);

  function toggle() {
    setOpen((o) => {
      const next = !o;
      try { localStorage.setItem(`sec:${id}`, next ? "1" : "0"); } catch {}
      return next;
    });
  }

  return (
    <section className="card overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="tap flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left hover:bg-[var(--color-surface-2)]"
      >
        <IconChevronRight className={`size-4 shrink-0 text-ink-soft transition-transform ${open ? "rotate-90" : ""}`} />
        <h2 className="text-sm font-bold">{title}</h2>
        {count != null && <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-px text-[11px] font-semibold tabular-nums text-ink-soft">{count}</span>}
        {summary != null && <span className="ml-auto min-w-0 truncate text-xs text-ink-soft">{summary}</span>}
      </button>
      {open && <div className="border-t border-[var(--color-line)]">{children}</div>}
    </section>
  );
}
