"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconDots } from "./icons";

export type CardActionItem = {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
};

/**
 * Buton „⋮" care deschide un meniu popover cu acțiuni — folosit pentru a strânge
 * butoanele de acțiune (editare/ștergere/atașamente) pe ecrane înguste, unde nu
 * mai încap toate alături de titlu.
 */
export default function CardActionsMenu({
  items,
  className = "",
}: {
  items: CardActionItem[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [mounted, setMounted] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);

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
      setPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - 176) });
    }
    setOpen((o) => !o);
  }

  if (items.length === 0) return null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={handleOpen}
        className={`tap grid size-8 shrink-0 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] ${className}`}
        title="Mai multe"
      >
        <IconDots className="size-4" />
      </button>
      {open && mounted && createPortal(
        <div
          style={{ position: "fixed", top: pos.top, left: pos.left, width: 176, zIndex: 9999 }}
          onMouseDown={(e) => e.stopPropagation()}
          className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-xl"
        >
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                it.onClick();
              }}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium hover:bg-[var(--color-surface-2)] ${it.danger ? "text-st-cancelled" : "text-ink"}`}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
