"use client";

import { createPortal } from "react-dom";
import { useState, useEffect, useRef } from "react";
import { STATUS_META } from "./status";
import type { ApptStatus } from "./types";
import { useMessages } from "@/lib/i18n/context";
import type { Messages } from "@/lib/i18n/messages/ro";

export const APPT_STATUSES: ApptStatus[] = [
  "NEW", "CONFIRMED", "IN_PROGRESS", "DONE", "CANCELLED", "NO_SHOW",
];

export function apptLabel(s: ApptStatus, m: Messages): string {
  switch (s) {
    case "NEW": return m.appts.statusNew;
    case "CONFIRMED": return m.appts.statusConfirmed;
    case "IN_PROGRESS": return m.status.IN_PROGRESS;
    case "DONE": return m.status.DONE;
    case "CANCELLED": return m.status.CANCELLED;
    case "NO_SHOW": return m.appts.statusNoShow;
  }
}

/** Chip de status care deschide lista de statusuri; lista se deschide în sus când sub chip nu încape (rând la finalul paginii) și rămâne în ecran. */
export function ApptStatusDropdown({
  status,
  pending,
  onChange,
}: {
  status: ApptStatus;
  pending: boolean;
  onChange: (s: ApptStatus) => void;
}) {
  const m = useMessages();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; minWidth: number; maxH: number }>({ top: 0, left: 0, minWidth: 0, maxH: 320 });
  const [mounted, setMounted] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const meta = STATUS_META[status];

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    function close() { setOpen(false); }
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  function handleOpen(e: React.MouseEvent) {
    e.stopPropagation();
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      const minWidth = Math.max(rect.width, 144);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - minWidth - 8));
      const menuH = APPT_STATUSES.length * 36 + 8;
      const below = window.innerHeight - rect.bottom - 8;
      const above = rect.top - 8;
      if (below >= menuH || below >= above) setPos({ top: rect.bottom + 4, left, minWidth, maxH: Math.max(120, below - 4) });
      else setPos({ bottom: window.innerHeight - rect.top + 4, left, minWidth, maxH: Math.max(120, above - 4) });
    }
    setOpen((o) => !o);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={pending}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={handleOpen}
        className={`dt-chip cursor-pointer h-7 shrink-0 rounded-full px-2.5 text-[11px] font-semibold transition-opacity disabled:opacity-50 ${meta.badge}`}
      >
        {apptLabel(status, m)}
      </button>
      {open && mounted && createPortal(
        <div
          style={{ position: "fixed", top: pos.top, bottom: pos.bottom, left: pos.left, minWidth: pos.minWidth, zIndex: 9999, maxHeight: pos.maxH, overflowY: "auto" }}
          onMouseDown={(e) => e.stopPropagation()}
          className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-xl"
        >
          {APPT_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(s); setOpen(false); }}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12px] font-medium hover:bg-[var(--color-surface-2)] ${s === status ? "font-bold" : ""}`}
            >
              <span className={`size-2 shrink-0 rounded-full ${STATUS_META[s].dot}`} />
              <span className={s === status ? "text-ink" : "text-ink-soft"}>{apptLabel(s, m)}</span>
              {s === status && <span className="ml-auto text-[10px] text-brand">✓</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
