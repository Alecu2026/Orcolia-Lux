"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useT } from "@/lib/i18n/context";

/** Memoria sugestiilor pe sesiune: aceeași căutare nu mai cere nimic (cheie = textul tastat, litere mici). */
const cache = new Map<string, string[]>();

/**
 * Câmp „Adresă" cu sugestii din adresele plătitorilor. Se poate scrie liber (sugestiile ajută, nu obligă).
 * Optimizat: pauză de 120 ms după ultima literă, cererea veche se anulează, rezultatele se țin în memorie, iar pe server căutarea
 * rulează în memorie (fără interogări în baza de date). Săgeți ↑↓ + Enter aleg o sugestie, Escape o închide.
 * Valoarea se trimite în formular prin `name` (câmp necontrolat de părinte) și se poate citi prin `onChange`.
 */
export default function AddressInput({
  name = "address",
  defaultValue = "",
  placeholder = "Adresă (începe să scrii pentru sugestii)",
  className = "",
  disabled,
  onChange,
  autoFocus,
}: {
  name?: string;
  defaultValue?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  onChange?: (v: string) => void;
  autoFocus?: boolean;
}) {
  const t = useT();
  const [value, setValue] = useState(defaultValue);
  const [items, setItems] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ctl = useRef<AbortController | null>(null);
  const id = useId();

  useEffect(() => () => {
    clearTimeout(timer.current);
    ctl.current?.abort();
  }, []);

  function search(text: string) {
    clearTimeout(timer.current);
    ctl.current?.abort();
    const q = text.trim().toLowerCase();
    if (q.length < 2) {
      setItems([]);
      setOpen(false);
      return;
    }
    const hit = cache.get(q);
    if (hit) {
      setItems(hit);
      setActive(-1);
      setOpen(hit.length > 0);
      return;
    }
    timer.current = setTimeout(() => {
      const c = new AbortController();
      ctl.current = c;
      fetch(`/api/addresses?q=${encodeURIComponent(text.trim())}`, { signal: c.signal })
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((j: { items?: string[] }) => {
          const list = Array.isArray(j.items) ? j.items : [];
          if (cache.size > 300) cache.delete(cache.keys().next().value as string);
          cache.set(q, list);
          setItems(list);
          setActive(-1);
          setOpen(list.length > 0);
        })
        .catch(() => {});
    }, 120);
  }

  function pick(v: string) {
    setValue(v);
    onChange?.(v);
    setOpen(false);
    setItems([]);
  }

  return (
    <div className="relative">
      <input
        name={name}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        maxLength={300}
        placeholder={t(placeholder)}
        role="combobox"
        aria-expanded={open}
        aria-controls={id}
        aria-autocomplete="list"
        onChange={(e) => {
          setValue(e.target.value);
          onChange?.(e.target.value);
          search(e.target.value);
        }}
        onKeyDown={(e) => {
          if (!open || items.length === 0) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % items.length); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a <= 0 ? items.length - 1 : a - 1)); }
          else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(items[active]); }
          else if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
        }}
        onFocus={() => items.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        className={className || "h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand"}
      />
      {open && items.length > 0 && (
        <ul id={id} role="listbox" className="absolute left-0 right-0 top-full z-[60] mt-1 max-h-56 overflow-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-1 text-sm shadow-xl">
          {items.map((a, i) => (
            <li key={a} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pick(a); }}
                className={`w-full cursor-pointer truncate rounded-lg px-3 py-1.5 text-left hover:bg-[var(--color-surface-2)] ${i === active ? "bg-[var(--color-surface-2)]" : ""}`}
              >
                {a}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
