"use client";

import { useEffect, useRef, useState } from "react";

type Match = { id: string; name: string; phone: string | null };

export default function ClientCombobox({
  value,
  onPick,
}: {
  value: { id: string; name: string };
  onPick: (v: { id: string; name: string }) => void;
}) {
  const [query, setQuery] = useState(value.name);
  const [open, setOpen] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value.name);
  }, [value.name]);

  // Debounce 220ms pe search
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!open) return;
    const q = query.trim();
    if (q.length < 1) {
      setMatches([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clients/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setMatches(data.items ?? []);
      } catch {
        setMatches([]);
      }
    }, 220);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, open]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={boxRef} className="relative">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          // tastare = client nou (fără id) până la selecție
          onPick({ id: "", name: e.target.value });
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Nume client (nou sau existent)"
        autoComplete="off"
        className="h-12 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-4 text-[15px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-lg">
          {matches.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => {
                  onPick({ id: m.id, name: m.name });
                  setQuery(m.name);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-2)]"
              >
                <span className="font-medium">{m.name}</span>
                {m.phone && (
                  <span className="text-xs text-ink-soft">{m.phone}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
