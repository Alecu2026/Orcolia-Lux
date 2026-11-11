"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { IconX } from "./icons";

/**
 * Câmp de text cu sugestii (nu listă derulantă): scrii, apar potrivirile, alegi una. Merge și cu sute de mii de înregistrări, pentru că sugestiile vin dintr-o căutare (`search`),
 * nu dintr-o listă încărcată în pagină. Valoarea aleasă (id-ul) se trimite cu formularul într-un câmp ascuns `name`; textul tastat nu se trimite.
 */

export type SuggestItem = { id: string; name: string; /** text mic în dreapta (telefon, cont…) */ hint?: string | null };

const field =
  "h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand disabled:opacity-60";

export default function SuggestInput({
  name,
  value,
  onChange,
  search,
  placeholder,
  ariaLabel,
  action,
  minChars = 1,
  noResults,
}: {
  /** numele câmpului ascuns trimis cu formularul (id-ul ales); lipsă = nu se trimite nimic */
  name?: string;
  value: SuggestItem | null;
  onChange: (v: SuggestItem | null) => void;
  /** întoarce sugestiile pentru textul tastat (cu întârziere de ~200 ms între taste) */
  search: (q: string) => Promise<SuggestItem[]>;
  placeholder?: string;
  ariaLabel?: string;
  /** buton în dreapta câmpului (ex. „+” pentru un client nou) */
  action?: ReactNode;
  minChars?: number;
  noResults?: string;
}) {
  const [text, setText] = useState(value?.name ?? "");
  const [items, setItems] = useState<SuggestItem[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const listId = useId();

  // valoare nouă din afară (client nou creat, alegere inițială încărcată târziu): textul urmează. Golirea din afară se face remontând câmpul (`key`).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (value) setText(value.name);
  }, [value]);

  // sugestiile: doar cât timp se tastează (câmpul e deschis și nu e o valoare aleasă)
  useEffect(() => {
    if (!open || value) return;
    const q = text.trim();
    if (q.length < minChars) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItems([]);
      return;
    }
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await search(q);
        if (mine === seq.current) {
          setItems(r);
          setActive(0);
        }
      } catch {
        if (mine === seq.current) setItems([]);
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, open, value]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pick(it: SuggestItem) {
    onChange(it);
    setText(it.name);
    setOpen(false);
  }

  function clear() {
    onChange(null);
    setText("");
    setItems([]);
  }

  return (
    <div ref={boxRef} className="relative">
      {name && <input type="hidden" name={name} value={value?.id ?? ""} />}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            value={text}
            role="combobox"
            aria-expanded={open && items.length > 0}
            aria-controls={listId}
            aria-label={ariaLabel ?? placeholder}
            autoComplete="off"
            placeholder={placeholder}
            onChange={(e) => {
              setText(e.target.value);
              if (value) onChange(null); // textul schimbat = alegerea veche nu mai e valabilă
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (!open || items.length === 0) {
                if (e.key === "Escape") setOpen(false);
                return;
              }
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(items.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter") {
                e.preventDefault(); // nu trimite formularul când alegi o sugestie
                pick(items[active] ?? items[0]);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            className={`${field} ${value ? "pr-9 font-medium" : ""}`}
          />
          {(value || text) && (
            <button type="button" onClick={clear} aria-label="×" className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface)]">
              <IconX className="size-3.5" />
            </button>
          )}
        </div>
        {action}
      </div>
      {open && !value && text.trim().length >= minChars && (items.length > 0 || (!busy && noResults)) && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-lg">
          {items.length === 0 ? (
            <li className="px-3 py-2 text-xs text-ink-soft">{noResults}</li>
          ) : (
            items.map((it, i) => (
              <li key={it.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(it)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-2)] ${i === active ? "bg-[var(--color-surface-2)]" : ""}`}
                >
                  <span className="min-w-0 truncate font-medium">{it.name}</span>
                  {it.hint && <span className="shrink-0 text-xs text-ink-soft">{it.hint}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
