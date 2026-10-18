"use client";

import { useEffect } from "react";
import { IconX } from "./icons";

/**
 * Factura reală (aceeași pagină publică pe care o vede clientul / din PDF) într-un pop-up.
 * Randăm pagina într-un iframe, nu o reimplementare separată, ca să fie mereu identică.
 */
export default function InvoicePreviewDialog({
  token,
  title = "Factură",
  onClose,
}: {
  token: string;
  title?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl bg-[var(--color-surface)] shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-line)] px-3 py-2">
          <h2 className="min-w-0 truncate text-sm font-semibold">{title}</h2>
          <div className="flex items-center gap-1.5">
            <a
              href={`/invoice/public/${token}`}
              target="_blank"
              rel="noreferrer"
              className="tap inline-flex h-8 cursor-pointer items-center rounded-lg border border-[var(--color-line)] px-3 text-xs hover:bg-[var(--color-surface-2)]"
            >
              Filă nouă ↗
            </a>
            <button type="button" onClick={onClose} className="tap grid size-8 cursor-pointer place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label="Închide">
              <IconX className="size-4" />
            </button>
          </div>
        </div>
        <div className="relative flex-1 overflow-hidden bg-zinc-100">
          <iframe src={`/invoice/public/${token}`} title={title} className="size-full border-0 bg-white" />
        </div>
      </div>
    </div>
  );
}
