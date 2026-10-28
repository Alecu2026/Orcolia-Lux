"use client";

import DateFilterInput from "./DateFilterInput";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DEFAULT_PER_PAGE,
  NOTIFY_PER_PAGE,
  normalizePerPageClient,
  perPageLabel,
} from "@/lib/payer-notify";
import { IconChevronLeft, IconChevronRight } from "./icons";
import CompactCard, { CompactField } from "./CompactCard";
import VirtualList from "./VirtualList";
import { useT } from "@/lib/i18n/context";

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

/** Peste atâtea rânduri pe pagină, în DOM stau doar rândurile din zona vizibilă (restul = un spațiu gol de înălțime potrivită). */
const VIRT_MIN = 80;
/** Rânduri randate în plus, deasupra și dedesubt, ca derularea rapidă să nu arate goluri. */
const VIRT_OVER = 14;
/** Înălțimea estimată a unui rând până se măsoară (compact / normal / spațios). */
const ROW_EST = { compact: 20, normal: 32, roomy: 56 } as const;

/**
 * Selector de filtru memoizat: la o listă de mii de opțiuni (clienți, proiecte) React nu mai recompară toate `<option>` la fiecare
 * randare a tabelului (derulare, scriere în alt câmp, editare inline) — doar când se schimbă efectiv opțiunile sau valoarea.
 */
const FilterSelect = memo(function FilterSelect({
  fkey,
  label,
  options,
  value,
  onPick,
}: {
  fkey: string;
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onPick: (key: string, value: string) => void;
}) {
  const t = useT();
  return (
    <select value={value} onChange={(e) => onPick(fkey, e.target.value)} className={fld(value)} aria-label={t(label)}>
      <option value="">{t(label)}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
    </select>
  );
});

export default function DataTable<T extends { id: string }>({
  storageKey,
  rows,
  columns,
  filters,
  defaultSort,
  onRowClick,
  rowClickSkipsControls = false,
  toolbar,
  summaryExtra,
  noun,
  cardKeys,
  cardAvatar,
  emptyText,
  rowClassName,
  presetValues,
  pending,
}: {
  storageKey: string;
  rows: T[];
  columns: Col<T>[];
  filters: Filter<T>[];
  defaultSort?: { key: string; dir: "asc" | "desc" };
  onRowClick?: (r: T) => void;
  /** Click pe un buton / link / câmp din interiorul rândului (status, progres, selectoare) nu declanșează și `onRowClick`. */
  rowClickSkipsControls?: boolean;
  /** Butoane în dreapta barei de filtre (ex. „+ Nou", Export). */
  toolbar?: ReactNode;
  /** Text în plus lângă numărătoare (primește lista filtrată). */
  summaryExtra?: (filtered: T[]) => ReactNode;
  /** Substantiv pentru numărătoare: „task-uri", „clienți"… */
  noun?: string;
  emptyText?: string;
  rowClassName?: (r: T) => string;
  /** Chei de coloane care alcătuiesc rezumatul cardului de pe telefon (titlu + două valori), în ordine; restul se vede la desfacere. */
  cardKeys?: string[];
  /** Litera din cercul cardului (implicit: prima literă a primei coloane). */
  cardAvatar?: (r: T) => string;
  /** Filtre din URL (ex. ?proj=…) — dacă există, înlocuiesc filtrele salvate la deschidere. */
  presetValues?: Record<string, string | undefined>;
  /**
   * Lista completă încă se încarcă și `rows` conține doar primele rânduri: cât timp sunt filtre active nu arătăm rezultate parțiale
   * (ar părea greșite), ci un mesaj; numărătoarea afișează totalul real.
   */
  pending?: { total: number };
}) {
  const t = useT();
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
  const scrollBox = useRef<HTMLDivElement>(null);
  const scrollRaf = useRef(0);
  // Fereastra de randare a tabelului: poziția de derulare (rotunjită la câteva rânduri, ca să nu randăm la fiecare pixel), înălțimea vizibilă și înălțimea măsurată a unui rând.
  const [vwin, setVwin] = useState({ top: 0, h: 720 });
  const [rowH, setRowH] = useState<number>(ROW_EST.compact);
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

  // Înălțimea zonei vizibile a tabelului (pentru fereastra de randare).
  useEffect(() => {
    const el = scrollBox.current;
    if (!el) return;
    const upd = () => setVwin((v) => (v.h === el.clientHeight || el.clientHeight === 0 ? v : { ...v, h: el.clientHeight }));
    upd();
    const obs = new ResizeObserver(upd);
    obs.observe(el);
    return () => obs.disconnect();
  }, [cards]);

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
  const cardFields = (() => {
    const vis = orderedLabeled.filter(isVisible);
    if (!cardKeys?.length) return vis;
    const first = cardKeys.map((k) => vis.find((c) => c.key === k)).filter((c): c is Col<T> => !!c);
    return [...first, ...vis.filter((c) => !first.includes(c))];
  })();
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
  // Variantă stabilă pentru selectoarele memoizate (folosește doar setteri, deci nu are dependențe).
  const pickFilter = useCallback((key: string, value: string) => {
    setValues((v) => {
      const next = { ...v };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
    setDraft((d) => ({ ...d, [key]: value }));
    setPage(1);
  }, []);

  function onText(key: string, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => setValue(key, value.trim()), 120);
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

  // ── Sortare (o singură dată) + filtrare, în memorie ──
  // Sortarea depinde doar de rânduri și de cheia/direcția aleasă (nu de identitatea `columns`, recreată la fiecare randare): cheile se calculează
  // o dată per rând, apoi se sortează indicii. Filtrarea rulează apoi pe lista deja sortată, deci scrisul în căutare nu mai sortează nimic.
  // `useDeferredValue`: câmpurile (selectoare, text) răspund imediat, iar lista se recalculează imediat după, fără să blocheze scrierea.
  const sortSpec = useDeferredValue(`${sortKey}|${sortDir}`);
  const sortedRows = useMemo(() => {
    const sepAt = sortSpec.lastIndexOf("|");
    const key = sortSpec.slice(0, sepAt);
    const col = columns.find((c) => c.key === key && c.sort);
    if (!col?.sort) return rows;
    const dir = sortSpec.slice(sepAt + 1) === "asc" ? 1 : -1;
    const n = rows.length;
    const keys: (string | number | null | undefined)[] = new Array(n);
    for (let i = 0; i < n; i++) keys[i] = col.sort(rows[i]);
    const idx = new Array<number>(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    idx.sort((a, b) => {
      const x = keys[a];
      const y = keys[b];
      const xe = x == null || x === "";
      const ye = y == null || y === "";
      if (xe && ye) return 0;
      if (xe) return 1; // fără valoare → la final, indiferent de direcție
      if (ye) return -1;
      if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
      return collator.compare(String(x), String(y)) * dir;
    });
    return idx.map((i) => rows[i]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortSpec]);
  const dvalues = useDeferredValue(values);
  const filtered = useMemo(() => {
    const active = filters
      .map((f) => ({ f, v: f.kind === "text" ? (dvalues[f.key] ?? "").toLowerCase() : (dvalues[f.key] ?? "") }))
      .filter((x) => x.v);
    return active.length ? sortedRows.filter((r) => active.every(({ f, v }) => f.test(r, v))) : sortedRows;
  }, [sortedRows, filters, dvalues]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const curPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((curPage - 1) * perPage, curPage * perPage);
  const virt = !cards && pageRows.length > VIRT_MIN;
  const winStart = virt ? Math.min(Math.max(0, Math.floor(vwin.top / rowH) - VIRT_OVER), Math.max(0, pageRows.length - 1)) : 0;
  const winEnd = virt ? Math.min(pageRows.length, Math.ceil((vwin.top + vwin.h) / rowH) + VIRT_OVER) : pageRows.length;
  const shownRows = virt ? pageRows.slice(winStart, winEnd) : pageRows;
  const from = total === 0 ? 0 : (curPage - 1) * perPage + 1;
  const to = Math.min(curPage * perPage, total);
  const activeCount = Object.keys(draft).filter((k) => draft[k]).length;
  const hideRows = !!pending && activeCount > 0;
  const sortedByUser = sortKey !== (defaultSort?.key ?? "") || sortDir !== (defaultSort?.dir ?? "asc");

  // Înălțimea reală a unui rând = media celor randate (aspectul — densitate, font — o schimbă); se măsoară după fiecare mutare a ferestrei.
  useEffect(() => {
    if (!virt) return;
    const id = requestAnimationFrame(() => {
      const trs = scrollBox.current?.querySelectorAll<HTMLElement>("tbody tr[data-vr]");
      if (!trs || trs.length === 0) return;
      let sum = 0;
      const n = Math.min(trs.length, 12);
      for (let i = 0; i < n; i++) sum += trs[i].getBoundingClientRect().height;
      const avg = sum / n;
      if (avg > 4) setRowH((cur) => (Math.abs(cur - avg) > 0.4 ? avg : cur));
    });
    return () => cancelAnimationFrame(id);
  }, [virt, winStart, look.density, look.font, look.width]);

  // Filtru/sortare/pagină noi → înapoi sus (altfel poziția veche ar cădea într-o listă mai scurtă).
  const resetKey = `${curPage}|${perPage}|${sortSpec}|${JSON.stringify(dvalues)}`;
  useEffect(() => {
    if (scrollBox.current) scrollBox.current.scrollTop = 0; // declanșează onScroll → fereastra revine sus
  }, [resetKey]);


  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        {filters.map((f) =>
          f.kind === "select" ? (
            <FilterSelect key={f.key} fkey={f.key} label={f.label} options={f.options} value={values[f.key] ?? ""} onPick={pickFilter} />
          ) : f.kind === "date" ? (
            <DateFilterInput key={f.key} label={t(f.label)} value={values[f.key] ?? ""} onChange={(e) => { setValue(f.key, e.target.value); setDraft((d) => ({ ...d, [f.key]: e.target.value })); }} title={t(f.label)} aria-label={t(f.label)} className={txtFld(values[f.key] ?? "")} />
          ) : (
            <input
              key={f.key}
              value={draft[f.key] ?? ""}
              onChange={(e) => onText(f.key, e.target.value)}
              placeholder={t(f.placeholder ?? f.label)}
              aria-label={t(f.label)}
              style={f.w ? { width: f.w } : undefined}
              className={`${txtFld(draft[f.key] ?? "")} ${f.grow ? "min-w-48 flex-1" : f.w ? "" : "w-40"}`}
            />
          ),
        )}
        {(activeCount > 0 || sortedByUser) && (
          <button type="button" onClick={clearAll} className="tap h-7 cursor-pointer rounded-lg border border-[var(--color-line)] px-2 text-[11px] text-ink-soft hover:bg-[var(--color-surface-2)]">
            {t("Resetează filtrele")}{activeCount > 0 ? ` (${activeCount})` : ""}
          </button>
        )}
        {toolbar && <div className="ml-auto flex flex-wrap items-center gap-1.5">{toolbar}</div>}
      </div>

      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
        <span><b>{nf(pending && activeCount === 0 ? pending.total : total)}</b> {noun ?? t("elemente")}{activeCount > 0 ? ` ${t("(filtrat)")}` : ""}</span>
        {pending && <span className="animate-pulse text-ink-soft">{t("se încarcă lista completă…")}</span>}
        {total > 0 && !hideRows && <span className="text-ink-soft">{t("afișați {from}–{to} din {total}", { from: nf(from), to: nf(to), total: nf(total) })}{totalPages > 1 ? ` · ${t("pagina {cur}/{pages}", { cur: curPage, pages: totalPages })}` : ""}</span>}
        {summaryExtra?.(filtered)}
        {cards && sortableCols.length > 0 && (
          <label className="flex items-center gap-1 text-xs text-ink-soft">
            {t("Sortare")}
            <select
              value={sortKey}
              onChange={(e) => { setSortKey(e.target.value); setSortDir("asc"); setPage(1); }}
              className={fld(sortedByUser ? "x" : "")}
              aria-label={t("Sortare")}
            >
              {!sortableCols.some((c) => c.key === sortKey) && <option value="">—</option>}
              {sortableCols.map((c) => <option key={c.key} value={c.key}>{t(c.label)}</option>)}
            </select>
            <button type="button" onClick={() => { setSortDir((d) => (d === "asc" ? "desc" : "asc")); setPage(1); }} className="tap h-7 w-7 cursor-pointer rounded-lg border border-[var(--color-line)] text-[11px] hover:bg-[var(--color-surface-2)]" aria-label={t("Direcția sortării")} title={sortDir === "asc" ? t("Crescător") : t("Descrescător")}>
              {sortDir === "asc" ? "▲" : "▼"}
            </button>
          </label>
        )}
        <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setCardsPref(!cards)}
          className={`tap h-7 cursor-pointer rounded-lg border px-2 text-[11px] ${cards ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink-soft hover:bg-[var(--color-surface-2)]"}`}
          title={cards ? t("Înapoi la tabel") : t("Afișează rândurile într-o coloană mică; apeși pe un rând ca să vezi detaliile (potrivit pentru telefon)")}
          aria-pressed={cards}
        >
          {cards ? `▦ ${t("Tabel")}` : `📱 ${t("Mod telefon")}`}
        </button>
        <div ref={colsBox} className="relative">
          <button
            type="button"
            onClick={() => setColsOpen((o) => !o)}
            className={`tap h-7 cursor-pointer rounded-lg border px-2 text-[11px] ${order.length || Object.keys(vis).length || JSON.stringify(look) !== JSON.stringify(DEFAULT_LOOK) ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink-soft hover:bg-[var(--color-surface-2)]"}`}
            title={t("Alege și ordonează coloanele")}
          >
            ⚙ {t("Coloane")}
          </button>
          {colsOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-2 shadow-xl">
              <p className="mb-1 px-1 text-[10px] text-ink-soft">{t("Bifează ce vrei să vezi; mută cu ▲▼ sau trage antetele din tabel.")}</p>
              <ul className="max-h-56 overflow-auto">
                {orderedLabeled.map((c, i) => (
                  <li key={c.key} className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[12px] hover:bg-[var(--color-surface-2)]">
                    <input type="checkbox" checked={isVisible(c)} onChange={(e) => setVis((v) => ({ ...v, [c.key]: e.target.checked }))} className="size-3.5 cursor-pointer accent-[var(--color-brand)]" />
                    <span className="min-w-0 flex-1 truncate">{t(c.label)}{c.defaultHidden ? <span className="ml-1 text-[10px] text-ink-soft">{t("(în plus)")}</span> : null}</span>
                    <button type="button" disabled={i === 0} onClick={() => stepCol(c.key, -1)} className="grid size-5 cursor-pointer place-items-center rounded text-[10px] hover:bg-brand-soft disabled:opacity-30" aria-label={t("Mai sus")}>▲</button>
                    <button type="button" disabled={i === orderedLabeled.length - 1} onClick={() => stepCol(c.key, 1)} className="grid size-5 cursor-pointer place-items-center rounded text-[10px] hover:bg-brand-soft disabled:opacity-30" aria-label={t("Mai jos")}>▼</button>
                  </li>
                ))}
              </ul>
              <div className="mt-2 border-t border-[var(--color-line)] pt-2">
                <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-ink-soft">{t("Aspect")}</p>
                <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 px-1 text-[11px]">
                  <LookSelect label={t("Rânduri")} value={look.density} onChange={(v) => setLook({ ...look, density: v })} options={[["compact", t("Compacte")], ["normal", t("Normale")], ["roomy", t("Spațioase")]]} />
                  <LookSelect label={t("Text")} value={String(look.font)} onChange={(v) => setLook({ ...look, font: Number(v) as Look["font"] })} options={[["10", t("Mic")], ["11", t("Normal")], ["13", t("Mare")], ["15", t("Foarte mare")]]} />
                  <LookSelect label={t("Lățime coloane")} value={String(look.width)} onChange={(v) => setLook({ ...look, width: Number(v) as Look["width"] })} options={[["85", t("Înguste")], ["100", t("Normale")], ["125", t("Late")], ["150", t("Foarte late")]]} />
                  <LookSelect label={t("Culoare antet")} value={look.header} onChange={(v) => setLook({ ...look, header: v })} options={[["default", t("Neutru")], ["brand", t("Turcoaz")], ["sky", t("Albastru")], ["emerald", t("Verde")], ["orange", t("Portocaliu")], ["violet", t("Violet")], ["slate", t("Gri închis")]]} />
                  <LookSelect label={t("Culoare text")} value={look.text} onChange={(v) => setLook({ ...look, text: v })} options={[["default", t("Implicită")], ["brand", t("Turcoaz")], ["sky", t("Albastru")], ["emerald", t("Verde")], ["violet", t("Violet")], ["rose", t("Roz")]]} />
                  <label className="flex cursor-pointer items-end gap-1.5 pb-1">
                    <input type="checkbox" checked={look.zebra} onChange={(e) => setLook({ ...look, zebra: e.target.checked })} className="size-3.5 cursor-pointer accent-[var(--color-brand)]" />
                    {t("Rânduri alternate")}
                  </label>
                </div>
                <p className="mt-1.5 px-1 text-[10px] leading-snug text-ink-soft">
                  {t("Lățimea se aplică tuturor coloanelor; textul care nu încape se taie cu „…”. La „Rânduri spațioase” textul se rupe pe până la 3 rânduri.")}
                </p>
              </div>
              <button type="button" onClick={() => { setOrder([]); setVis({}); setLook(DEFAULT_LOOK); }} className="tap mt-2 h-7 w-full cursor-pointer rounded-lg border border-[var(--color-line)] text-[11px] hover:bg-[var(--color-surface-2)]">
                {t("Resetează coloanele și aspectul")}
              </button>
            </div>
          )}
        </div>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-ink-soft">
          {t("Afișează")}
          <select
            value={perPage}
            onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}
            className={fld(perPage === DEFAULT_PER_PAGE ? "" : "x")}
            aria-label={t("Rânduri pe pagină")}
          >
            {NOTIFY_PER_PAGE.map((n) => <option key={n} value={n}>{perPageLabel(n, t)}</option>)}
          </select>
        </label>
      </div>

      {hideRows ? (
        <div className="card animate-pulse p-8 text-center text-ink-soft">{t("Se încarcă lista completă… filtrele se aplică imediat ce e gata.")}</div>
      ) : cards ? (
        <div className={`flex flex-col gap-1.5 ${TEXT_CLS[look.text]}`}>
          {(() => {
            const renderCard = (r: T) => {
            // Rezumat: primele trei coloane vizibile (titlu + două valori scurte); restul se vede la desfacere.
            const [c0, c1, c2, ...rest] = cardFields;
            const initial = cardAvatar ? cardAvatar(r) : String(c0?.sort?.(r) ?? "").trim().charAt(0).toUpperCase();
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
                    {rest.map((c) => <CompactField key={c.key} label={t(c.label)}>{c.render(r)}</CompactField>)}
                  </dl>
                )}
                {(cardActions.length > 0 || onRowClick) && (
                  <div className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-[12px]">
                    {onRowClick && (
                      <button type="button" onClick={() => onRowClick(r)} className="tap h-7 cursor-pointer rounded-lg bg-brand px-3 text-[11px] font-semibold text-white hover:bg-brand-strong">
                        {t("Deschide")}
                      </button>
                    )}
                    {cardActions.map((c) => <span key={c.key}>{c.render(r)}</span>)}
                  </div>
                )}
              </CompactCard>
            );
            };
            // Multe carduri (de ex. „Toate”): doar cele din zona vizibilă există în DOM.
            return pageRows.length > 60
              ? <VirtualList count={pageRows.length} itemKey={(i) => pageRows[i].id} render={(i) => renderCard(pageRows[i])} estimate={52} />
              : pageRows.map(renderCard);
          })()}
          {pageRows.length === 0 && (
            <div className="card p-8 text-center text-ink-soft">
              {activeCount > 0 ? t("Nimic cu filtrele acestea.") : (emptyText ?? t("Nimic de afișat."))}{" "}
              {activeCount > 0 && <button type="button" onClick={clearAll} className="cursor-pointer font-semibold text-brand underline">{t("Resetează filtrele")}</button>}
            </div>
          )}
        </div>
      ) : (
      <div
        ref={scrollBox}
        className="card overflow-auto"
        style={{ maxHeight: perPage > 50 ? "max(78vh, 890px)" : undefined }}
        onScroll={virt ? (e) => {
          const top = e.currentTarget.scrollTop;
          if (scrollRaf.current) return;
          scrollRaf.current = requestAnimationFrame(() => {
            scrollRaf.current = 0;
            // rotunjit la 6 rânduri: nu randăm din nou la fiecare pixel derulat
            const q = Math.floor(top / (rowH * 6)) * rowH * 6;
            setVwin((v) => (v.top === q ? v : { ...v, top: q }));
          });
        } : undefined}
      >
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
                  title={c.label !== "" ? t("Trage ca să muți coloana") : undefined}
                  className={`${fixed ? "overflow-hidden" : ""} border-b border-[var(--color-line)] ${HEADER_CLS[look.header]} ${DENSITY[look.density].px} ${DENSITY[look.density].head} font-semibold leading-tight ${c.right ? "text-right" : "text-left"} ${c.sticky && ci <= 1 ? "sticky left-0 z-30" : ""} ${c.label !== "" ? "cursor-grab" : ""} ${overKey === c.key && dragKey !== c.key ? "shadow-[inset_3px_0_0_var(--color-brand)]" : ""} ${dragKey === c.key ? "opacity-50" : ""}`}
                >
                  {c.sort ? (
                    <button type="button" onClick={() => toggleSort(c.key)} className="inline-flex cursor-pointer items-center gap-1 font-semibold hover:text-brand">
                      {t(c.label)}
                      <span className="text-[10px] opacity-60">{sortKey === c.key ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
                    </button>
                  ) : t(c.label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {virt && winStart > 0 && (
              <tr aria-hidden="true"><td colSpan={visibleCols.length} style={{ height: winStart * rowH, padding: 0, border: 0 }} /></tr>
            )}
            {shownRows.map((r, rj) => {
              const ri = winStart + rj;
              return (
              <tr
                key={r.id}
                data-vr=""
                onClick={onRowClick ? (e) => { if (rowClickSkipsControls && (e.target as HTMLElement).closest("button, a, select, input, textarea, label, [role=button], [role=combobox], [data-no-row]")) return; onRowClick(r); } : undefined}
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
              );
            })}
            {virt && winEnd < pageRows.length && (
              <tr aria-hidden="true"><td colSpan={visibleCols.length} style={{ height: (pageRows.length - winEnd) * rowH, padding: 0, border: 0 }} /></tr>
            )}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={visibleCols.length} className="p-8 text-center text-ink-soft">
                  {activeCount > 0 ? t("Nimic cu filtrele acestea.") : (emptyText ?? t("Nimic de afișat."))}{" "}
                  {activeCount > 0 && <button type="button" onClick={clearAll} className="cursor-pointer font-semibold text-brand underline">{t("Resetează filtrele")}</button>}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      {total > 0 && totalPages > 1 && !hideRows && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-1">
          <button disabled={curPage <= 1} onClick={() => setPage(curPage - 1)} className="tap grid size-7 cursor-pointer place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:cursor-default disabled:opacity-40" aria-label={t("Pagina anterioară")}>
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
          <button disabled={curPage >= totalPages} onClick={() => setPage(curPage + 1)} className="tap grid size-7 cursor-pointer place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:cursor-default disabled:opacity-40" aria-label={t("Pagina următoare")}>
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
