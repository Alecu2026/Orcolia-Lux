"use client";

import { useState } from "react";

type Format = "csv" | "xlsx";

export default function ExportButton({
  entity,
  params = {},
  className,
}: {
  entity: string;
  params?: Record<string, string | undefined>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  function buildUrl(format: Format) {
    const sp = new URLSearchParams({ entity, format });
    for (const [k, v] of Object.entries(params)) {
      if (v) sp.set(k, v);
    }
    return `/api/export?${sp.toString()}`;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={
          className ??
          "tap inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--color-line)] px-3 text-sm font-medium text-ink-soft hover:bg-[var(--color-surface-2)]"
        }
        aria-label="Export"
      >
        <svg className="size-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 3v10m0 0-3-3m3 3 3-3M4 15h12" />
        </svg>
        Export
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 min-w-[140px] rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-xl">
            <a
              href={buildUrl("xlsx")}
              download
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-[var(--color-surface-2)]"
            >
              <span className="text-base">📊</span>
              Excel (.xlsx)
            </a>
            <a
              href={buildUrl("csv")}
              download
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-[var(--color-surface-2)]"
            >
              <span className="text-base">📄</span>
              CSV (.csv)
            </a>
          </div>
        </>
      )}
    </div>
  );
}
