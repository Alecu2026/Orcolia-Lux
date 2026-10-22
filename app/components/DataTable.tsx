"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DEFAULT_PER_PAGE,
  NOTIFY_PER_PAGE,
  normalizePerPageClient,
  perPageLabel,
} from "@/lib/payer-notify";
import { IconChevronLeft, IconChevronRight } from "./icons";
import CompactCard, { CompactField } from "./CompactCard";

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
  /** Coloană lipită la stânga la derulare orizontală (doar cât e în primele 2 coloane vizibile). */
  sticky?: boolean;
  /** Coloană disponibilă în „Coloane", dar ascunsă implicit (câmpuri în plus: descriere, tip…). */
  defaultHidden?: boolean;
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

/** Aspectul tabelului (celule, text, culori) — personalizabil din „⚙ Coloane", salvat pe tabel. */
export type Look = {
  density: "compact" | "normal" | "roomy";
  font: 10 | 11 | 13 | 15;
  width: 85 | 100 | 125 | 150;
  zebra: boolean;
  header: "default" | "brand" | "sky" | "emerald" | "orange" | "violet" | "slate";
  text: "default" | "brand" | "sky" | "emerald" | "violet" | "rose";
};
const DEFAULT_LOOK: Look = { density: "compact", font: 11, width: 100, zebra: false, header: "default", text: "default" };
const DENSITY = {
  compact: { cell: "py-px", head: "py-1", px: "px-1.5", lh: 14 },
  normal: { cell: "py-1.5", head: "py-1.5", px: "px-2", lh: 16 },
  roomy: { cell: "py-3", head: "py-2.5", px: "px-3", lh: 18 },
} as const;
const HEADER_CLS: Record<Look["header"], string> = {
  default: "bg-[var(--color-surface-2)]",
  brand: "bg-brand text-white",
  sky: "bg-sky-600 text-white",
  emerald: "bg-emerald-600 text-white",
  orange: "bg-orange-500 text-white",
  violet: "bg-violet-600 text-white",
  slate: "bg-slate-700 text-white",
};
const TEXT_CLS: Record<Look["text"], string> = {
  default: "",
  brand: "text-brand-strong",
  sky: "text-sky-700 dark:text-sky-300",
  emerald: "text-emerald-700 dark:text-emerald-300",
  violet: "text-violet-700 dark:text-violet-300",
  rose: "text-rose-700 dark:text-rose-300",
};
const ZEBRA_BG = "bg-[color-mix(in_srgb,var(--color-surface-2)_70%,var(--color-surface))]";

type Persisted = {
  /** Mod telefon (carduri): true/false = ales de utilizator; lipsă = automat (carduri pe ecran îngust). */
  cm?: boolean;
  v: Record<string, string>;
  pp: number;
  sk: string;
  sd: "asc" | "desc";
  /** Ordinea coloanelor (chei) aleasă de utilizator. */
  co?: string[];
  /** Coloane afișate/ascunse explicit de utilizator (cheie → vizibil). */
  cv?: Record<string, boolean>;
  /** Aspect (densitate, text, culori). */
  lk?: Partial<Look>;
};

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
  // ── Coloane personalizabile: ordine (drag & drop sau ▲▼) și vizibilitate, salvate în localStorage ──
  const [order, setOrder] = useState<string[]>([]);
  const [vis, setVis] = useState<Record<string, boolean>>({});
  const [look, setLook] = useState<Look>(DEFAULT_LOOK);
  const [colsOpen, setColsOpen] = useState(false);
  // Mod telefon: fiecare rând devine un card cu câmpurile unul sub altul. `cardsPref` = alegerea utilizatorului (null = automat:
  // carduri pe ecrane înguste, tabel pe restul).
  const [cardsPref, setCardsPref] = useState<boolean | null>(null);
  const [narrow, setNarrow] = useState(false);
  const cards = cardsPref ?? narrow;
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const colsBox = useRef<HTMLDivElement>(null);
  const STORAGE = `dt:${storageKey}`;

  // Restaurează filtrele/sortarea/numărul de rânduri salvate (după hidratare — serverul nu are localStorage).
  useEffect(() => {
    let savedCols: Persisted | null = null;
    try { savedCols = JSON.parse(localStorage.getItem(STORAGE) ?? "null") as Persisted | null; } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNarrow(window.matchMedia("(max-width: 639px)").matches);
    if (savedCols && typeof savedCols.cm === "boolean") setCardsPref(savedCols.cm);
    if (savedCols) {
      const ck = new Set(columns.map((c) => c.key));
      if (Array.isArray(savedCols.co)) setOrder(savedCols.co.filter((k) => ck.has(k)));
      if (savedCols.lk) setLook({ ...DEFAULT_LOOK, ...savedCols.lk });
      if (savedCols.cv) setVis(Object.fromEntries(Object.entries(savedCols.cv).filter(([k, b]) => ck.has(k) && typeof b === "boolean")));
    }
    const known = new Set(filters.map((f) => f.key));
    const preset = Object.fromEntries(Object.entries(presetValues ?? {}).filter(([k, x]) => known.has(k) && typeof x === "string" && x)) as Record<string, string>;
    if (Object.keys(preset).length > 0) {
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
      const empty = Object.keys(values).length === 0 && perPage === DEFAULT_PER_PAGE && sortKey === (defaultSort?.key ?? "") && sortDir === (defaultSort?.dir ?? "asc") && order.length === 0 && Object.keys(vis).length === 0 && JSON.stringify(look) === JSON.stringify(DEFAULT_LOOK) && cardsPref === null;
      if (empty) localStorage.removeItem(STORAGE);
      else localStorage.setItem(STORAGE, JSON.stringify({ v: values, pp: perPage, sk: sortKey, sd: sortDir, co: order, cv: vis, lk: look, ...(cardsPref === null ? {} : { cm: cardsPref }) } satisfies Persisted));
    } catch {}
  }, [values, perPage, sortKey, sortDir, order, vis, look, cardsPref, ready, STORAGE, defaultSort]);

  // Închide fereastra „Coloane" la click în afara ei sau la Escape.
  useEffect(() => {
    if (!colsOpen) return;
    const onDown = (e: MouseEvent) => { if (!colsBox.current?.contains(e.target as Node)) setColsOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setColsOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [colsOpen]);

  // Coloanele cu etichetă (reordonabile/ascunse) + cele fixe (fără etichetă: butoane/acțiuni) rămase la început/sfârșit.
  const firstLabeled = columns.findIndex((c) => c.label !== "");
  const fixedStart = columns.filter((c, i) => c.label === "" && i < firstLabeled);
  const fixedEnd = columns.filter((c, i) => c.label === "" && i > firstLabeled);
  const labeled = columns.filter((c) => c.label !== "");
  const orderedLabeled = useMemo(() => {
    const idx = new Map(order.map((k, i) => [k, i]));
    return [...labeled].sort((a, b) => (idx.get(a.key) ?? 1e6 + labeled.indexOf(a)) - (idx.get(b.key) ?? 1e6 + labeled.indexOf(b)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, order]);
  const isVisible = (c: Col<T>) => vis[c.key] ?? !c.defaultHidden;
  const visibleCols = [...fixedStart, ...orderedLabeled.filter(isVisible), ...fixedEnd];
  const cardFields = orderedLabeled.filter(isVisible);
  const cardActions = [...fixedStart, ...fixedEnd];
  const sortableCols = labeled.filter((c) => c.sort);
  // Lățimi explicite pentru FIECARE coloană (colgroup + table-layout: fixed), scalate cu „Lățime celule": așa setarea chiar schimbă tabelul,
  // indiferent de conținut. Baza = minW, iar la coloanele cu maxW (text lung, tăiat cu „…") media dintre minW și maxW.
  const colWidths = visibleCols.map((c) => Math.round((c.maxW ? (c.minW + c.maxW) / 2 : c.minW) * look.width / 100));
  const tableMinWidth = colWidths.reduce((a, b) => a + b, 0);
  const roomy = look.density === "roomy";
  // Setările implicite păstrează comportamentul clasic (coloanele își iau lățimea din conținut). Lățimile explicite se aplică doar când
  // alegi altă lățime sau rânduri spațioase — exact cazurile în care setarea trebuie să se vadă.
  const fixed = look.width !== 100 || roomy;

  /** Mută coloana `from` înaintea coloanei `to` (drag & drop) sau cu un pas (▲▼). */
  function moveCol(from: string, to: string) {
    if (from === to) return;
    const keys = orderedLabeled.map((c) => c.key);
    keys.splice(keys.indexOf(from), 1);
    keys.splice(keys.indexOf(to), 0, from);
    setOrder(keys);
  }
  function stepCol(key: string, dir: -1 | 1) {
    const keys = orderedLabeled.map((c) => c.key);
    const i = keys.indexOf(key);
    const j = i + dir;
    if (j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    setOrder(keys);
  }

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
        {cards && sortableCols.length > 0 && (
          <label className="flex items-center gap-1 text-xs text-ink-soft">
            Sortare
            <select
              value={sortKey}
              onChange={(e) => { setSortKey(e.target.value); setSortDir("asc"); setPage(1); }}
              className={fld(sortedByUser ? "x" : "")}
              aria-label="Sortare"
            >
              {!sortableCols.some((c) => c.key === sortKey) && <option value="">—</option>}
              {sortableCols.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <button type="button" onClick={() => { setSortDir((d) => (d === "asc" ? "desc" : "asc")); setPage(1); }} className="tap h-7 w-7 cursor-pointer rounded-lg border border-[var(--color-line)] text-[11px] hover:bg-[var(--color-surface-2)]" aria-label="Direcția sortării" title={sortDir === "asc" ? "Crescător" : "Descrescător"}>
              {sortDir === "asc" ? "▲" : "▼"}
            </button>
          </label>
        )}
        <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setCardsPref(!cards)}
          className={`tap h-7 cursor-pointer rounded-lg border px-2 text-[11px] ${cards ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink-soft hover:bg-[var(--color-surface-2)]"}`}
          title={cards ? "Înapoi la tabel" : "Afișează rândurile într-o coloană mică; apeși pe un rând ca să vezi detaliile (potrivit pentru telefon)"}
          aria-pressed={cards}
        >
          {cards ? "▦ Tabel" : "📱 Mod telefon"}
        </button>
        <div ref={colsBox} className="relative">
          <button
            type="button"
            onClick={() => setColsOpen((o) => !o)}
            className={`tap h-7 cursor-pointer rounded-lg border px-2 text-[11px] ${order.length || Object.keys(vis).length || JSON.stringify(look) !== JSON.stringify(DEFAULT_LOOK) ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink-soft hover:bg-[var(--color-surface-2)]"}`}
            title="Alege și ordonează coloanele"
          >
            ⚙ Coloane
          </button>
          {colsOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-2 shadow-xl">
              <p className="mb-1 px-1 text-[10px] text-ink-soft">Bifează ce vrei să vezi; mută cu ▲▼ sau trage antetele din tabel.</p>
              <ul className="max-h-56 overflow-auto">
                {orderedLabeled.map((c, i) => (
                  <li key={c.key} className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[12px] hover:bg-[var(--color-surface-2)]">
                    <input type="checkbox" checked={isVisible(c)} onChange={(e) => setVis((v) => ({ ...v, [c.key]: e.target.checked }))} className="size-3.5 cursor-pointer accent-[var(--color-brand)]" />
                    <span className="min-w-0 flex-1 truncate">{c.label}{c.defaultHidden ? <span className="ml-1 text-[10px] text-ink-soft">(în plus)</span> : null}</span>
                    <button type="button" disabled={i === 0} onClick={() => stepCol(c.key, -1)} className="grid size-5 cursor-pointer place-items-center rounded text-[10px] hover:bg-brand-soft disabled:opacity-30" aria-label="Mai sus">▲</button>
                    <button type="button" disabled={i === orderedLabeled.length - 1} onClick={() => stepCol(c.key, 1)} className="grid size-5 cursor-pointer place-items-center rounded text-[10px] hover:bg-brand-soft disabled:opacity-30" aria-label="Mai jos">▼</button>
                  </li>
                ))}
              </ul>
              <div className="mt-2 border-t border-[var(--color-line)] pt-2">
                <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-ink-soft">Aspect</p>
                <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 px-1 text-[11px]">
                  <LookSelect label="Rânduri" value={look.density} onChange={(v) => setLook({ ...look, density: v })} options={[["compact", "Compacte"], ["normal", "Normale"], ["roomy", "Spațioase"]]} />
                  <LookSelect label="Text" value={String(look.font)} onChange={(v) => setLook({ ...look, font: Number(v) as Look["font"] })} options={[["10", "Mic"], ["11", "Normal"], ["13", "Mare"], ["15", "Foarte mare"]]} />
                  <LookSelect label="Lățime coloane" value={String(look.width)} onChange={(v) => setLook({ ...look, width: Number(v) as Look["width"] })} options={[["85", "Înguste"], ["100", "Normale"], ["125", "Late"], ["150", "Foarte late"]]} />
                  <LookSelect label="Culoare antet" value={look.header} onChange={(v) => setLook({ ...look, header: v })} options={[["default", "Neutru"], ["brand", "Turcoaz"], ["sky", "Albastru"], ["emerald", "Verde"], ["orange", "Portocaliu"], ["violet", "Violet"], ["slate", "Gri închis"]]} />
                  <LookSelect label="Culoare text" value={look.text} onChange={(v) => setLook({ ...look, text: v })} options={[["default", "Implicită"], ["brand", "Turcoaz"], ["sky", "Albastru"], ["emerald", "Verde"], ["violet", "Violet"], ["rose", "Roz"]]} />
                  <label className="flex cursor-pointer items-end gap-1.5 pb-1">
                    <input type="checkbox" checked={look.zebra} onChange={(e) => setLook({ ...look, zebra: e.target.checked })} className="size-3.5 cursor-pointer accent-[var(--color-brand)]" />
                    Rânduri alternate
                  </label>
                </div>
                <p className="mt-1.5 px-1 text-[10px] leading-snug text-ink-soft">
                  Lățimea se aplică tuturor coloanelor; textul care nu încape se taie cu „…”. La „Rânduri spațioase” textul se rupe pe până la 3 rânduri.
                </p>
              </div>
              <button type="button" onClick={() => { setOrder([]); setVis({}); setLook(DEFAULT_LOOK); }} className="tap mt-2 h-7 w-full cursor-pointer rounded-lg border border-[var(--color-line)] text-[11px] hover:bg-[var(--color-surface-2)]">
                Resetează coloanele și aspectul
              </button>
            </div>
          )}
        </div>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-ink-soft">
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

      {cards ? (
        <div className={`flex flex-col gap-1.5 ${TEXT_CLS[look.text]}`}>
          {pageRows.map((r) => {
            // Rezumat: primele trei coloane vizibile (titlu + două valori scurte); restul se vede la desfacere.
            const [c0, c1, c2, ...rest] = cardFields;
            const initial = String(c0?.sort?.(r) ?? "").trim().charAt(0).toUpperCase();
            return (
              <CompactCard
                key={r.id}
                avatar={initial}
                title={c0 ? c0.render(r) : r.id}
                subtitle={[c1, c2].filter((c): c is Col<T> => !!c).map((c, i) => (
                  <span key={c.key} className="inline-flex min-w-0 items-center gap-1">
                    {i > 0 && <span className="text-ink-soft/50">·</span>}
                    {c.render(r)}
                  </span>
                ))}
                className={rowClassName?.(r) ?? ""}
              >
                {rest.length > 0 && (
                  <dl>
                    {rest.map((c) => <CompactField key={c.key} label={c.label}>{c.render(r)}</CompactField>)}
                  </dl>
                )}
                {(cardActions.length > 0 || onRowClick) && (
                  <div className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-[12px]">
                    {onRowClick && (
                      <button type="button" onClick={() => onRowClick(r)} className="tap h-7 cursor-pointer rounded-lg bg-brand px-3 text-[11px] font-semibold text-white hover:bg-brand-strong">
                        Deschide
                      </button>
                    )}
                    {cardActions.map((c) => <span key={c.key}>{c.render(r)}</span>)}
                  </div>
                )}
              </CompactCard>
            );
          })}
          {pageRows.length === 0 && (
            <div className="card p-8 text-center text-ink-soft">
              {activeCount > 0 ? "Nimic cu filtrele acestea." : emptyText}{" "}
              {activeCount > 0 && <button type="button" onClick={clearAll} className="cursor-pointer font-semibold text-brand underline">Resetează filtrele</button>}
            </div>
          )}
        </div>
      ) : (
      <div className="card overflow-auto" style={{ maxHeight: perPage > 50 ? "max(78vh, 890px)" : undefined }}>
        <table
          className={`${fixed ? "" : "w-max min-w-full"} border-separate border-spacing-0 ${TEXT_CLS[look.text]}`}
          style={{
            ...(fixed ? { tableLayout: "fixed" as const, width: "100%", minWidth: tableMinWidth } : {}),
            fontSize: look.font,
            lineHeight: `${Math.round(look.font * 1.3) + (roomy ? 4 : look.density === "normal" ? 2 : 0)}px`,
          }}
        >
          {fixed && (
            <colgroup>
              {visibleCols.map((c, i) => <col key={c.key} style={{ width: colWidths[i] }} />)}
            </colgroup>
          )}
          <thead className={`sticky top-0 z-20 ${HEADER_CLS[look.header]}`}>
            <tr>
              {visibleCols.map((c, ci) => (
                <th
                  key={c.key}
                  style={fixed ? undefined : { minWidth: Math.round(c.minW * look.width / 100) }}
                  draggable={c.label !== ""}
                  onDragStart={(e) => { setDragKey(c.key); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.key); }}
                  onDragOver={(e) => { if (dragKey && c.label !== "") { e.preventDefault(); setOverKey(c.key); } }}
                  onDragLeave={() => setOverKey((k) => (k === c.key ? null : k))}
                  onDrop={(e) => { e.preventDefault(); if (dragKey) moveCol(dragKey, c.key); setDragKey(null); setOverKey(null); }}
                  onDragEnd={() => { setDragKey(null); setOverKey(null); }}
                  title={c.label !== "" ? "Trage ca să muți coloana" : undefined}
                  className={`${fixed ? "overflow-hidden" : ""} border-b border-[var(--color-line)] ${HEADER_CLS[look.header]} ${DENSITY[look.density].px} ${DENSITY[look.density].head} font-semibold leading-tight ${c.right ? "text-right" : "text-left"} ${c.sticky && ci <= 1 ? "sticky left-0 z-30" : ""} ${c.label !== "" ? "cursor-grab" : ""} ${overKey === c.key && dragKey !== c.key ? "shadow-[inset_3px_0_0_var(--color-brand)]" : ""} ${dragKey === c.key ? "opacity-50" : ""}`}
                >
                  {c.sort ? (
                    <button type="button" onClick={() => toggleSort(c.key)} className="inline-flex cursor-pointer items-center gap-1 font-semibold hover:text-brand">
                      {c.label}
                      <span className="text-[10px] opacity-60">{sortKey === c.key ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
                    </button>
                  ) : c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, ri) => (
              <tr
                key={r.id}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={`${onRowClick ? "cursor-pointer" : ""} hover:bg-brand-soft/30 ${rowClassName?.(r) ?? ""}`}
              >
                {visibleCols.map((c, ci) => (
                  <td
                    key={c.key}
                    style={!fixed && c.maxW ? { maxWidth: Math.round(c.maxW * look.width / 100) } : undefined}
                    className={`${fixed ? "overflow-hidden" : ""} border-b border-[var(--color-line)] ${look.zebra && ri % 2 === 1 ? ZEBRA_BG : "bg-[var(--color-surface)]"} ${DENSITY[look.density].px} ${DENSITY[look.density].cell} ${fixed && !roomy ? "whitespace-nowrap" : ""} ${c.right ? "text-right tabular-nums" : ""} ${c.sticky && ci <= 1 ? "sticky left-0 z-10 font-medium" : ""}`}
                  >
                    {/* Rânduri compacte/normale: o singură linie, textul lung se taie cu „…". Spațioase: textul se rupe pe până la 3 rânduri. */}
                    {c.maxW || roomy ? <div className={roomy ? "line-clamp-3 break-words" : "truncate"}>{c.render(r)}</div> : c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={visibleCols.length} className="p-8 text-center text-ink-soft">
                  {activeCount > 0 ? "Nimic cu filtrele acestea." : emptyText}{" "}
                  {activeCount > 0 && <button type="button" onClick={clearAll} className="cursor-pointer font-semibold text-brand underline">Resetează filtrele</button>}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}

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

function LookSelect<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V | string;
  options: [string, string][];
  onChange: (v: V) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5 text-ink-soft">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as V)}
        className="h-7 cursor-pointer rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-1 text-[11px] text-ink outline-none focus:border-brand"
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
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
