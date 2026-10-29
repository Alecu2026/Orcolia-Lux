"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n/context";

/**
 * Celule editabile direct în tabel (Task-uri, Proiecte, Clienți, Programări): click pe celulă → câmpul devine
 * editabil; salvarea e optimistă în părinte (`onSave`/`onChange` doar anunță valoarea nouă). Pe celule se vede
 * cursorul „pointer", iar celulele needitabile (`disabled`) rămân text simplu.
 */

const cellBtn =
  "dt-ctl block w-full max-w-full cursor-pointer truncate rounded px-0.5 text-left";
const inputCls =
  "h-5 w-full min-w-0 rounded border border-brand bg-[var(--color-surface)] px-1 text-[11px] text-ink outline-none";

export function EditableText({
  value,
  onSave,
  disabled,
  display,
  allowEmpty = false,
  type = "text",
  placeholder,
}: {
  value: string;
  onSave: (v: string) => void;
  disabled?: boolean;
  display?: ReactNode;
  allowEmpty?: boolean;
  type?: "text" | "email" | "tel";
  placeholder?: string;
}) {
  const tr = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const done = useRef(false);

  if (disabled) return <>{display ?? (value || <span className="text-ink-soft/60">—</span>)}</>;
  if (!editing) {
    return (
      <button
        type="button"
        className={cellBtn}
        title={tr("Click ca să modifici")}
        onClick={(e) => { e.stopPropagation(); done.current = false; setDraft(value); setEditing(true); }}
      >
        {display ?? (value || <span className="text-ink-soft/60">—</span>)}
      </button>
    );
  }
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    const v = draft.trim();
    if (save && v !== value.trim() && (allowEmpty || v)) onSave(v);
  };
  return (
    <input
      autoFocus
      type={type}
      value={draft}
      placeholder={placeholder}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); finish(true); }
        if (e.key === "Escape") { e.preventDefault(); finish(false); }
      }}
      className={inputCls}
    />
  );
}

export function EditableSelect({
  value,
  options,
  onChange,
  disabled,
  display,
  emptyLabel = "—",
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
  display?: ReactNode;
  /** Opțiunea pentru „nimic" (valoare ""); null = nu există. */
  emptyLabel?: string | null;
}) {
  const tr = useT();
  const [editing, setEditing] = useState(false);
  const label = options.find((o) => o.value === value)?.label;

  if (disabled) return <>{display ?? label ?? <span className="text-ink-soft/60">—</span>}</>;
  if (!editing) {
    return (
      <button type="button" className={cellBtn} title={tr("Click ca să modifici")} onClick={(e) => { e.stopPropagation(); setEditing(true); }}>
        {display ?? label ?? <span className="text-ink-soft/60">—</span>}
      </button>
    );
  }
  return (
    <select
      autoFocus
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => { setEditing(false); if (e.target.value !== value) onChange(e.target.value); }}
      onBlur={() => setEditing(false)}
      className={`${inputCls} cursor-pointer`}
    >
      {emptyLabel !== null && <option value="">{emptyLabel}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{tr(o.label)}</option>)}
    </select>
  );
}

/** Fereastră mică ancorată de celulă (portal, ca să nu fie tăiată de derularea tabelului). */
export function PopEditor({
  display,
  disabled,
  width = 260,
  title,
  children,
}: {
  display: ReactNode;
  disabled?: boolean;
  width?: number;
  /** Sugestia de la hover (implicit „Click ca să modifici”). */
  title?: string;
  children: (close: () => void) => ReactNode;
}) {
  const tr = useT();
  // Poziția se calculează la click (nu într-un efect): sub celulă, sau deasupra dacă nu încape pe ecran.
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const rect = anchor;
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const close = () => setAnchor(null);

  useEffect(() => {
    if (!rect) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || btn.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onScroll = (e: Event) => { if (!box.current?.contains(e.target as Node)) close(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [rect]);

  if (disabled) return <>{display}</>;
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={cellBtn}
        title={title ?? tr("Click ca să modifici")}
        onClick={(e) => {
          e.stopPropagation();
          if (anchor) { setAnchor(null); return; }
          const r = e.currentTarget.getBoundingClientRect();
          const h = 260; // înălțime estimată a ferestrei
          const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
          const below = r.bottom + 4;
          setAnchor({ left, top: below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 4) : below });
        }}
      >
        {display}
      </button>
      {rect && createPortal(
        <div
          ref={box}
          onClick={(e) => e.stopPropagation()}
          style={{ position: "fixed", top: rect.top, left: rect.left, width, zIndex: 9999 }}
          className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-2 text-[12px] shadow-xl"
        >
          {children(close)}
        </div>,
        document.body,
      )}
    </>
  );
}

/** Listă cu bife (ex. responsabili: utilizatori + echipe) cu căutare și „Salvează". */
export function MultiPick({
  groups,
  selected,
  onSave,
  onCancel,
}: {
  groups: { label: string; items: { id: string; name: string }[] }[];
  selected: string[];
  onSave: (picked: Record<string, string[]>) => void;
  onCancel: () => void;
}) {
  const tr = useT();
  const [sel, setSel] = useState<Set<string>>(new Set(selected));
  const [q, setQ] = useState("");
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const needle = q.trim().toLowerCase();
  return (
    <div className="flex flex-col gap-1.5">
      {total > 8 && (
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Caută…")} className="h-7 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-[12px] outline-none focus:border-brand" />
      )}
      <div className="max-h-56 overflow-auto">
        {groups.map((g) => {
          const items = g.items.filter((i) => !needle || i.name.toLowerCase().includes(needle));
          if (!items.length) return null;
          return (
            <div key={g.label} className="mb-1">
              <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-ink-soft">{tr(g.label)}</p>
              {items.map((i) => (
                <label key={i.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-[var(--color-surface-2)]">
                  <input type="checkbox" checked={sel.has(i.id)} onChange={() => toggle(i.id)} className="size-3.5 cursor-pointer accent-[var(--color-brand)]" />
                  <span className="truncate">{i.name}</span>
                </label>
              ))}
            </div>
          );
        })}
      </div>
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={onCancel} className="tap h-7 cursor-pointer rounded-lg border border-[var(--color-line)] px-2.5 text-[11px] hover:bg-[var(--color-surface-2)]">{tr("Anulează")}</button>
        <button
          type="button"
          onClick={() => {
            const out: Record<string, string[]> = {};
            for (const g of groups) out[g.label] = g.items.filter((i) => sel.has(i.id)).map((i) => i.id);
            onSave(out);
          }}
          className="tap h-7 cursor-pointer rounded-lg bg-brand px-3 text-[11px] font-semibold text-white hover:bg-brand-strong"
        >
          {tr("Salvează")}
        </button>
      </div>
    </div>
  );
}

/** Dată + oră opțională, cu „Șterge" și „Salvează" (pentru termene și programări). */
export function DateTimePick({
  date,
  time,
  allowClear = true,
  withTime = true,
  onSave,
  onCancel,
}: {
  date: string;
  time: string;
  allowClear?: boolean;
  withTime?: boolean;
  onSave: (date: string, time: string) => void;
  onCancel: () => void;
}) {
  const tr = useT();
  const [d, setD] = useState(date);
  const [t, setT] = useState(time);
  const field = "h-7 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-[12px] outline-none focus:border-brand";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        <input type="date" autoFocus value={d} onChange={(e) => setD(e.target.value)} className={`${field} flex-1`} />
        {withTime && <input type="time" value={t} onChange={(e) => setT(e.target.value)} className={`${field} w-24`} />}
      </div>
      <div className="flex justify-between gap-1.5">
        {allowClear ? (
          <button type="button" onClick={() => onSave("", "")} className="tap h-7 cursor-pointer rounded-lg border border-[var(--color-line)] px-2.5 text-[11px] text-st-cancelled hover:bg-[var(--color-surface-2)]">{tr("Șterge")}</button>
        ) : <span />}
        <span className="flex gap-1.5">
          <button type="button" onClick={onCancel} className="tap h-7 cursor-pointer rounded-lg border border-[var(--color-line)] px-2.5 text-[11px] hover:bg-[var(--color-surface-2)]">{tr("Anulează")}</button>
          <button type="button" disabled={!d} onClick={() => onSave(d, t)} className="tap h-7 cursor-pointer rounded-lg bg-brand px-3 text-[11px] font-semibold text-white hover:bg-brand-strong disabled:cursor-default disabled:opacity-40">{tr("Salvează")}</button>
        </span>
      </div>
    </div>
  );
}
