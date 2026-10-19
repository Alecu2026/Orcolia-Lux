"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DEFAULT_PER_PAGE,
  NOTIFY_PER_PAGE,
  normalizePerPageClient,
  perPageLabel,
} from "@/lib/payer-notify";
import { IconChevronLeft, IconChevronRight } from "./icons";

/**
 * Tabel generic, în stilul paginii Plătitori: toate rândurile vin o dată de pe server, iar filtrele, sortarea
 * și paginarea rulează în browser (instant). Filtrele active sunt colorate și, împreună cu sortarea și numărul de
 * rânduri pe pagină, se salvează în localStorage. Click pe rând = `onRowClick` (de obicei un popup cu detalii).
 */

export type Col<T> = {
  key: string;
  label: string;
  minW: number;
  right?: boolean;
  /** Valoarea după care se sortează la click pe antet (fără ea, coloana nu e sortabilă). */
  sort?: (r: T) => string | number | null | undefined;
  render: (r: T) => ReactNode;
  /** Lățime maximă a celulei (textul lung se taie cu „…"). */
  maxW?: number;
  /** Coloană lipită la stânga la derulare orizontală (prima, de obicei). */
  sticky?: boolean;
};

type Base = { key: string; label: string };
export type SelectFilter<T> = Base & {
  kind: "select";
  options: { value: string; label: string }[];
  test: (r: T, value: string) => boolean;
};
export type TextFilter<T> = Base & {
  kind: "text";
  placeholder?: string;
  /** `value` e deja trim + lowercase. */
  test: (r: T, value: string) => boolean;
  /** Câmp mare (ocupă loc de căutare principală). */
  grow?: boolean;
  w?: number;
};
export type DateFilter<T> = Base & {
  kind: "date";
  test: (r: T, value: string) => boolean; // value = "YYYY-MM-DD"
};
export type Filter<T> = SelectFilter<T> | TextFilter<T> | DateFilter<T>;

type Persisted = { v: Record<string, string>; pp: number; sk: string; sd: "asc" | "desc" };

const collator = new Intl.Collator("ro", { numeric: true });

const fld = (val: string) =>
  `h-7 min-w-0 max-w-full appearance-none sel-arrow rounded-lg border pl-1.5 pr-6 text-[11px] outline-none focus:border-brand ${
    val ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink"
  }`;
const txtFld = (val: string) =>
  `h-7 min-w-0 rounded-lg border px-2 text-[11px] outline-none focus:border-brand ${
    val ? "border-brand bg-brand/10 font-semibold text-brand placeholder:font-normal" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink"
  }`;

const nf = (n: number) => n.toLocaleString("ro-RO");

export default function DataTable<T extends { id: string }>({
  storageKey,
  rows,
  columns,
  filters,
  defaultSort,
  onRowClick,
  toolbar,
  summaryExtra,
  noun = "elemente",
  emptyText = "Nimic de afișat.",
  rowClassName,
  presetValues,
}: {
  storageKey: string;
  rows: T[];
  columns: Col<T>[];
  filters: Filter<T>[];
  defaultSort?: { key: string; dir: "asc" | "desc" };
  onRowClick?: (r: T) => void;
  /** Butoane în dreapta barei de filtre (ex. „+ Nou", Export). */
  toolbar?: ReactNode;
  /** Text în plus lângă numărătoare (primește lista filtrată). */
  summaryExtra?: (filtered: T[]) => ReactNode;
  /** Substantiv pentru numărătoare: „task-uri", „clienți"… */
  noun?: string;
  emptyText?: string;
  rowClassName?: (r: T) => string;
  /** Filtre din URL (ex. ?proj=…) — dacă există, înlocuiesc filtrele salvate la deschidere. */
  presetValues?: Record<string, string | undefined>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [perPage, setPerPage] = useState(DEFAULT_PER_PAGE);
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState(defaultSort?.key ?? "");
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSort?.dir ?? "asc");
  const [ready, setReady] = useState(false);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const STORAGE = `dt:${storageKey}`;

  // Restaurează filtrele/sortarea/numărul de rânduri salvate (după hidratare — serverul nu are localStorage).
  useEffect(() => {
    const known = new Set(filters.map((f) => f.key));
    const preset = Object.fromEntries(Object.entries(presetValues ?? {}).filter(([k, x]) => known.has(k) && typeof x === "string" && x)) as Record<string, string>;
    if (Object.keys(preset).length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setValues(preset);
      setDraft(preset);
      setReady(true);
      return;
    }
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) ?? "null") as Persisted | null;
      if (saved) {
        const known = new Set(filters.map((f) => f.key));
        const v = Object.fromEntries(Object.entries(saved.v ?? {}).filter(([k, x]) => known.has(k) && typeof x === "string" && x));
        setValues(v);
        setDraft(v);
        setPerPage(normalizePerPageClient(saved.pp));
        if (saved.sk && columns.some((c) => c.key === saved.sk && c.sort)) {
          setSortKey(saved.sk);
          setSortDir(saved.sd === "desc" ? "desc" : "asc");
        }
      }
    } catch {}
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      const empty = Object.keys(values).length === 0 && perPage === DEFAULT_PER_PAGE && sortKey === (defaultSort?.key ?? "") && sortDir === (defaultSort?.dir ?? "asc");
      if (empty) localStorage.removeItem(STORAGE);
      else localStorage.setItem(STORAGE, JSON.stringify({ v: values, pp: perPage, sk: sortKey, sd: sortDir } satisfies Persisted));
    } catch {}
  }, [values, perPage, sortKey, sortDir, ready, STORAGE, defaultSort]);

  function setValue(key: string, value: string) {
    setValues((v) => {
      const next = { ...v };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
    setPage(1);
  }

  function onText(key: string, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => setValue(key, value.trim()), 200);
  }

  function clearAll() {
    Object.values(timers.current).forEach((t) => clearTimeout(t));
    setValues({});
    setDraft({});
    setSortKey(defaultSort?.key ?? "");
    setSortDir(defaultSort?.dir ?? "asc");
    setPage(1);
  }

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
    setPage(1);
  }

  // ── Filtrare + sortare, în memorie ──
  const filtered = useMemo(() => {
    const active = filters
      .map((f) => ({ f, v: f.kind === "text" ? (values[f.key] ?? "").toLowerCase() : (values[f.key] ?? "") }))
      .filter((x) => x.v);
    let out = active.length ? rows.filter((r) => active.every(({ f, v }) => f.test(r, v))) : rows;
    const col = columns.find((c) => c.key === sortKey && c.sort);
    if (col?.sort) {
      const dir = sortDir === "asc" ? 1 : -1;
      out = [...out].sort((a, b) => {
        const x = col.sort!(a);
        const y = col.sort!(b);
        const xe = x == null || x === "";
        const ye = y == null || y === "";
        if (xe && ye) return 0;
        if (xe) return 1; // fără valoare → la final, indiferent de direcție
        if (ye) return -1;
        if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
        return collator.compare(String(x), String(y)) * dir;
      });
    }
    return out;
  }, [rows, filters, values, columns, sortKey, sortDir]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const curPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((curPage - 1) * perPage, curPage * perPage);
  const from = total === 0 ? 0 : (curPage - 1) * perPage + 1;
  const to = Math.min(curPage * perPage, total);
  const activeCount = Object.keys(draft).filter((k) => draft[k]).length;
  const sortedByUser = sortKey !== (defaultSort?.key ?? "") || sortDir !== (defaultSort?.dir ?? "asc");

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        {filters.map((f) =>
          f.kind === "select" ? (
            <select key={f.key} value={values[f.key] ?? ""} onChange={(e) => { setValue(f.key, e.target.value); setDraft((d) => ({ ...d, [f.key]: e.target.value })); }} className={fld(values[f.key] ?? "")} aria-label={f.label}>
              <option value="">{f.label}</option>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : f.kind === "date" ? (
            <input key={f.key} type="date" value={values[f.key] ?? ""} onChange={(e) => { setValue(f.key, e.target.value); setDraft((d) => ({ ...d, [f.key]: e.target.value })); }} title={f.label} aria-label={f.label} className={txtFld(values[f.key] ?? "")} />
          ) : (
            <input
              key={f.key}
              value={draft[f.key] ?? ""}
              onChange={(e) => onText(f.key, e.target.value)}
              placeholder={f.placeholder ?? f.label}
              aria-label={f.label}
              style={f.w ? { width: f.w } : undefined}
              className={`${txtFld(draft[f.key] ?? "")} ${f.grow ? "min-w-48 flex-1" : f.w ? "" : "w-40"}`}
            />
          ),
        )}
        {(activeCount > 0 || sortedByUser) && (
          <button type="button" onClick={clearAll} className="tap h-7 cursor-pointer rounded-lg border border-[var(--color-line)] px-2 text-[11px] text-ink-soft hover:bg-[var(--color-surface-2)]">
            Resetează filtrele{activeCount > 0 ? ` (${activeCount})` : ""}
          </button>
        )}
        {toolbar && <div className="ml-auto flex flex-wrap items-center gap-1.5">{toolbar}</div>}
      </div>

      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
        <span><b>{nf(total)}</b> {noun}{activeCount > 0 ? " (filtrat)" : ""}</span>
        {total > 0 && <span className="text-ink-soft">afișați {nf(from)}–{nf(to)} din {nf(total)}{totalPages > 1 ? ` · pagina ${curPage}/${totalPages}` : ""}</span>}
        {summaryExtra?.(filtered)}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-ink-soft">
          Afișează
          <select
            value={perPage}
            onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}
            className={fld(perPage === DEFAULT_PER_PAGE ? "" : "x")}
            aria-label="Rânduri pe pagină"
          >
            {NOTIFY_PER_PAGE.map((n) => <option key={n} value={n}>{perPageLabel(n)}</option>)}
          </select>
        </label>
      </div>

      <div className="card overflow-auto" style={{ maxHeight: perPage > 50 ? "max(78vh, 890px)" : undefined }}>
        <table className="w-max min-w-full border-separate border-spacing-0 text-[11px] leading-[14px]">
          <thead className="sticky top-0 z-20 bg-[var(--color-surface-2)]">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={{ minWidth: c.minW }}
                  className={`border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-1.5 py-1 font-semibold ${c.right ? "text-right" : "text-left"} ${c.sticky ? "sticky left-0 z-30" : ""}`}
                >
                  {c.sort ? (
                    <button type="button" onClick={() => toggleSort(c.key)} className="inline-flex cursor-pointer items-center gap-1 font-semibold hover:text-brand">
                      {c.label}
                      <span className="text-[10px] text-ink-soft">{sortKey === c.key ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
                    </button>
                  ) : c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr
                key={r.id}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={`${onRowClick ? "cursor-pointer" : ""} hover:bg-brand-soft/30 ${rowClassName?.(r) ?? ""}`}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    style={c.maxW ? { maxWidth: c.maxW } : undefined}
                    className={`border-b border-[var(--color-line)] bg-[var(--color-surface)] px-1.5 py-px ${c.right ? "text-right tabular-nums" : ""} ${c.sticky ? "sticky left-0 z-10 font-medium" : ""}`}
                  >
                    {c.maxW ? <div className="truncate">{c.render(r)}</div> : c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="p-8 text-center text-ink-soft">
                  {activeCount > 0 ? "Nimic cu filtrele acestea." : emptyText}{" "}
                  {activeCount > 0 && <button type="button" onClick={clearAll} className="cursor-pointer font-semibold text-brand underline">Resetează filtrele</button>}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {total > 0 && totalPages > 1 && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-1">
          <button disabled={curPage <= 1} onClick={() => setPage(curPage - 1)} className="tap grid size-7 cursor-pointer place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:cursor-default disabled:opacity-40" aria-label="Pagina anterioară">
            <IconChevronLeft className="size-4" />
          </button>
          {buildPageButtons(curPage, totalPages).map((b, i) =>
            b === "…" ? (
              <span key={`e${i}`} className="flex h-7 w-6 items-center justify-center text-sm text-ink-soft">…</span>
            ) : (
              <button key={b} onClick={() => setPage(b)} className={`tap h-7 min-w-[28px] cursor-pointer rounded-lg px-2 text-xs font-medium ${b === curPage ? "bg-brand text-white" : "border border-[var(--color-line)] text-ink hover:bg-[var(--color-surface-2)]"}`}>
                {b}
              </button>
            ),
          )}
          <button disabled={curPage >= totalPages} onClick={() => setPage(curPage + 1)} className="tap grid size-7 cursor-pointer place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:cursor-default disabled:opacity-40" aria-label="Pagina următoare">
            <IconChevronRight className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function buildPageButtons(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, total]);
  for (let i = Math.max(2, current - 2); i <= Math.min(total - 1, current + 2); i++) pages.add(i);
  const sorted = [...pages].sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push("…");
    out.push(sorted[i]);
  }
  return out;
}
