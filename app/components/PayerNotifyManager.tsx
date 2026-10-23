"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { PayerRow } from "@/lib/queries/payers";
import {
  CONTACT_OPTIONS,
  DEFAULT_PER_PAGE,
  EMPTY_FILTERS,
  NOTIFIED_OPTIONS,
  NOTIFY_MAX_RECIPIENTS,
  NOTIFY_PER_PAGE,
  PER_PAGE_ALL,
  perPageLabel,
  agoLabel,
  buildVars,
  countActiveFilters,
  filterSnapshot,
  filtersToParams,
  isEmail,
  normalizePerPageClient,
  normalizePhone,
  notifiedRecently,
  sanitizeFilters,
  type NotifyFilters,
  type NotifyVars,
} from "@/lib/payer-notify";
import { resolveNotifyFilterAction, type RecipientResult } from "@/app/actions/payer-notifications";
import { INVOICE_STATUS, INVOICE_STATUS_LIST, type InvoiceStatusKey } from "./invoice-meta";
import { IconChevronLeft, IconChevronRight } from "./icons";
import { useToast } from "./toast";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";
import PayerNotifyDialog, { type Recipient } from "./PayerNotifyDialog";
import PayerTemplatesDialog from "./PayerTemplatesDialog";
import CompactCard, { CompactField } from "./CompactCard";
import PayerDetailDialog, { type PayerPatch } from "./PayerDetailDialog";
import PayerBulkDeleteDialog from "./PayerBulkDeleteDialog";
import VirtualList from "./VirtualList";
import { PAYERS_PP_COOKIE } from "@/lib/payer-prefs";
import { usePayerDataset } from "./usePayerDataset";
import ExportButton from "./ExportButton";
import {
  createPayerTemplateAction,
  deletePayerTemplateAction,
  updatePayerTemplateAction,
} from "@/app/actions/payer-templates";
import type { PayerTemplate, PayerTemplateDraft } from "@/lib/payer-notify";

type Page = { items: PayerRow[]; total: number };

// Aceleași clase ca filtrele din Task-uri: câmpul cu valoare aleasă capătă fundal/chenar colorat.
const fld = (val: string) =>
  `h-7 min-w-0 max-w-full appearance-none sel-arrow rounded-lg border pl-1.5 pr-6 text-[11px] outline-none focus:border-brand ${
    val ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink"
  }`;
const txtFld = (val: string) =>
  `h-7 min-w-0 rounded-lg border px-2 text-[11px] outline-none focus:border-brand ${
    val ? "border-brand bg-brand/10 font-semibold text-brand placeholder:font-normal" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink"
  }`;

const flagsOf = (r: PayerRow) => (isEmail(r.email) ? 1 : 0) | (normalizePhone(r.phone) ? 2 : 0);

function rowVars(r: PayerRow): NotifyVars {
  return buildVars({
    // în previzualizare: forma linkului, cu domeniul aplicației (cel real are în coadă un cod unic al facturii)
    invoiceLink: r.latestInvoice && typeof window !== "undefined" ? `${window.location.origin}/invoice/public/…` : null,
    name: r.name,
    account: r.meterSeries ?? r.contract,
    amount: r.latestInvoice?.grandTotal ?? null,
    currency: r.latestInvoice?.currency ?? null,
    invoiceNumber: r.latestInvoice?.number ?? null,
    dueDate: r.latestInvoice?.dueDate ?? null,
    address: r.consumAddress,
  });
}

const SAMPLE_VARS = buildVars({
  invoiceLink: "https://exemplu.md/invoice/public/…",
  name: "Ion Popescu", account: "123456", amount: 250, currency: "MDL", invoiceNumber: "AC-0001",
  dueDate: new Date(Date.now() + 10 * 86_400_000), address: "str. Exemplu 1",
});

function queryKey(f: NotifyFilters, page: number, perPage: number): string {
  return filtersToParams(sanitizeFilters(f), { page, perPage }).toString();
}

type TextKey = "q" | "street" | "minDebt" | "maxDebt";

/**
 * „Toate" înseamnă 19.000 de rânduri în memorie, dar în DOM stau doar cele vizibile (virtualizare): fără ea, desenarea tuturor era
 * sute de mii de noduri (măsurat: 343.000 de noduri și 220 MB pe telefon → fila pica, iar alegerea salvată se reaplica la fiecare deschidere).
 */
/** Lățimile coloanelor tabelului (px): plătitor, cont, adresă, email, telefon, factură, scadență, de achitat, status, portal, facturi, ultima notificare. */
const COL_W = [200, 100, 190, 190, 100, 85, 80, 90, 72, 58, 52, 110];
const SERVER_MAX_ROWS = 200; // doar cât timp lista completă nu e încă în browser (răspunsul vine de pe server)
const VIRTUAL_MIN = 80; // peste atâtea rânduri se desenează doar cele vizibile
const ROW_H = 24; // înălțimea fixă a unui rând de tabel (necesară virtualizării)
const BOOT_GUARD_MS = 120_000;

export default function PayerNotifyManager({
  initial,
  months,
  initialTemplates,
  canSend: canSendProp,
  emailEnabled,
  smsEnabled,
  callEnabled = false,
  userEmail,
  userId = "",
  isAdmin = false,
  canDelete = false,
  canEditInvoices = false,
  basePath = "/notificari-platitori",
  browseOnly = false,
  nameFixCount = 0,
}: {
  initial: { filters: NotifyFilters; page: number; perPage: number; items: PayerRow[]; total: number };
  months: { month: string; count: number }[];
  initialTemplates: PayerTemplate[];
  canSend: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
  /** Apeluri vocale automate configurate (Twilio + VOICE_FROM). */
  callEnabled?: boolean;
  userEmail: string;
  /** Utilizatorul curent — pentru notițe (cine le poate modifica). */
  userId?: string;
  isAdmin?: boolean;
  /** Poate șterge plătitori (clients.delete) — arată selecția și „Șterge selectați", chiar și în modul de răsfoire. */
  canDelete?: boolean;
  /** Poate edita facturi (invoices.edit) — „Editează" lângă „Vezi" în popup. */
  canEditInvoices?: boolean;
  /** Ruta paginii — pentru URL și cheia de salvare a filtrelor (fiecare pagină își ține filtrele separat). */
  basePath?: string;
  /** Mod „răsfoire" (/platitori): același tabel, fără bife/trimitere/șabloane, cu export. */
  browseOnly?: boolean;
  /** Câte nume au „?" — arată bannerul de corectare (doar în modul răsfoire). */
  nameFixCount?: number;
}) {
  const toast = useToast();
  const t = useT();
  const tag = dateTag(useLocale());
  const nf = (n: number) => n.toLocaleString(tag);
  const money = (n: number) => n.toLocaleString(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDay = (iso: string) =>
    new Date(iso).toLocaleDateString(tag, { timeZone: "Europe/Bucharest", day: "2-digit", month: "2-digit", year: "numeric" });
  const monthLabel = (m: string) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleDateString(tag, { month: "long", year: "numeric" });
  const canSend = canSendProp && !browseOnly;
  const canSelect = canSend || canDelete;
  const [deleting, setDeleting] = useState(false);
  const BASE_PATH = basePath;
  const STORAGE_KEY = `filters:${basePath}`;
  const BOOT_KEY = `boot:${basePath}`;

  // ── Stare: filtrele sunt locale (schimbarea lor e instantanee în UI), datele vin de pe server ──
  const [filters, setFilters] = useState<NotifyFilters>(initial.filters);
  const [draft, setDraft] = useState<Record<TextKey, string>>({
    q: initial.filters.q, street: initial.filters.street, minDebt: initial.filters.minDebt, maxDebt: initial.filters.maxDebt,
  });
  const [page, setPage] = useState(initial.page);
  const [wantPerPage, setPerPage] = useState(initial.perPage); // ce a ales utilizatorul (se salvează); `perPage` = cât desenăm de fapt
  const [data, setData] = useState<Page>({ items: initial.items, total: initial.total });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const initialKey = useMemo(() => queryKey(initial.filters, initial.page, initial.perPage), [initial]);
  const cache = useRef(new Map<string, Page>([[initialKey, { items: initial.items, total: initial.total }]]));
  const freshKey = useRef(initial.items.length < Math.min(initial.total, initial.perPage) ? "" : initialKey);
  const forceReload = useRef(false);
  const [reloadTick, setReloadTick] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const debounce = useRef<Partial<Record<TextKey, ReturnType<typeof setTimeout>>>>({});

  // ── Selecție (id → steaguri contact); persistă între pagini și filtre ──
  const [selected, setSelected] = useState<Map<string, number>>(new Map());
  const [resolving, setResolving] = useState(false);
  const resolveToken = useRef(0);
  const lastClicked = useRef<number | null>(null);
  // ── Șabloane (optimist: UI-ul se schimbă pe loc, serverul confirmă din urmă; la eșec revenim + mesaj) ──
  const [templates, setTemplates] = useState<PayerTemplate[]>(initialTemplates);
  const [tplOpen, setTplOpen] = useState(false);
  // Mod telefon: fiecare plătitor devine un card, cu câmpurile unul sub altul. `cardsPref` = alegerea utilizatorului; null = automat
  // (carduri pe ecrane înguste, tabel pe restul). Se păstrează în localStorage.
  const [cardsPref, setCardsPref] = useState<boolean | null>(null);
  const [narrow, setNarrow] = useState(false);
  const cards = cardsPref ?? narrow;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNarrow(window.matchMedia("(max-width: 639px)").matches);
    try {
      const v = localStorage.getItem("payer-notify-view");
      if (v === "cards" || v === "table") setCardsPref(v === "cards");
    } catch {}
  }, []);
  function toggleCards() {
    const next = !cards;
    setCardsPref(next);
    try { localStorage.setItem("payer-notify-view", next ? "cards" : "table"); } catch {}
  }
  const [detailRow, setDetailRow] = useState<PayerRow | null>(null);

  function createTemplate(d: PayerTemplateDraft) {
    const tmp = `tmp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    setTemplates((ts) => [{ id: tmp, ...d }, ...ts]);
    createPayerTemplateAction(d)
      .then((res) => {
        if (res.ok) setTemplates((ts) => ts.map((x) => (x.id === tmp ? res.template : x)));
        else { setTemplates((ts) => ts.filter((x) => x.id !== tmp)); toast.error(res.error); }
      })
      .catch(() => { setTemplates((ts) => ts.filter((x) => x.id !== tmp)); toast.error(t("Nu am putut salva șablonul.")); });
  }

  function updateTemplate(id: string, d: PayerTemplateDraft) {
    const prev = templates.find((x) => x.id === id);
    setTemplates((ts) => ts.map((x) => (x.id === id ? { id, ...d } : x)));
    const revert = (msg: string) => {
      if (prev) setTemplates((ts) => ts.map((x) => (x.id === id ? prev : x)));
      toast.error(msg);
    };
    updatePayerTemplateAction(id, d)
      .then((res) => { if (!res.ok) revert(res.error); })
      .catch(() => revert(t("Nu am putut salva modificarea.")));
  }

  function deleteTemplate(id: string) {
    const prevList = templates;
    setTemplates((ts) => ts.filter((x) => x.id !== id));
    const revert = (msg: string) => { setTemplates(prevList); toast.error(msg); };
    deletePayerTemplateAction(id)
      .then((res) => { if (!res.ok) revert(res.error); })
      .catch(() => revert(t("Nu am putut șterge șablonul.")));
  }

  const [compose, setCompose] = useState<{ recipients: Recipient[]; previewRow: PayerRow | null } | null>(null);
  const sentSomething = useRef(false);

  // ── Motor local: toți plătitorii în memorie, filtrați/sortați/paginați în JS (instant). Până se încarcă setul
  //    (sau cât timp se încarcă o lună nouă), se folosește interogarea clasică pe server de mai jos. ──
  const ds = usePayerDataset(ready, months.slice(0, 3).map((x) => x.month));
  // Controalele (liste, câmpuri) se actualizează imediat; lista de 19.000 de rânduri se recalculează în randarea următoare (amânată), deci
  // un select nu „se agață" cât timp se filtrează/sortează.
  const listFilters = useDeferredValue(filters);
  const monthMap = listFilters.month ? (ds.monthMaps.get(listFilters.month) ?? null) : null;
  const useLocal = !!ds.rows && (!listFilters.month || !!monthMap);
  // Cu lista completă în browser, orice dimensiune de pagină (inclusiv „Toate") e instant; până atunci serverul dă cel mult 200 de rânduri.
  const perPage = useLocal ? wantPerPage : Math.min(wantPerPage, SERVER_MAX_ROWS);
  const key = queryKey(filters, page, perPage);
  const localList = useMemo(
    () => (useLocal && ds.rows ? filterSnapshot(ds.rows, sanitizeFilters(listFilters), monthMap) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [useLocal, ds.rows, ds.version, listFilters, monthMap],
  );
  const view: Page = useMemo(
    () => (localList ? { items: localList.slice((page - 1) * perPage, page * perPage), total: localList.length } : data),
    [localList, page, perPage, data],
  );
  // „Toate" ales, dar lista completă încă n-a ajuns în browser: arătăm deja totalul și primele rânduri (restul sunt rânduri goale care se umplu
  // singure când sosește lista) — utilizatorul vede „toți cei 19.000" din prima, nu o pagină de 200.
  const showAll = !useLocal && wantPerPage >= PER_PAGE_ALL && page === 1 && view.total > view.items.length;
  const uiPerPage = showAll ? view.total : perPage;
  const totalPages = Math.max(1, Math.ceil(view.total / uiPerPage));
  const ensureMonth = ds.ensureMonth;
  useEffect(() => {
    if (filters.month && ds.rows) ensureMonth(filters.month);
  }, [filters.month, ds.rows, ensureMonth]);
  // Pagina cerută a dispărut (ex. filtrul a redus rezultatele) → ultima pagină validă.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (localList && page > totalPages) setPage(totalPages);
  }, [localList, page, totalPages]);

  // Restaurează filtrele salvate (doar dacă URL-ul nu are propriile filtre) — ca în Task-uri.
  useEffect(() => {
    const urlEmpty = countActiveFilters(initial.filters) === 0 && !initial.filters.sort && initial.page === 1;
    // Dacă încărcarea anterioară nu s-a terminat (fila a pierit / s-a blocat), NU mai reaplicăm filtrele salvate — altfel ar bloca la nesfârșit.
    let interrupted = false;
    try {
      const b = Number(localStorage.getItem(BOOT_KEY) ?? 0);
      interrupted = b > 0 && Date.now() - b < BOOT_GUARD_MS;
      localStorage.setItem(BOOT_KEY, String(Date.now()));
      if (interrupted) localStorage.removeItem(STORAGE_KEY);
      // Reîncărcare / navigare normală în timpul încărcării (ex. actualizarea aplicației) NU e o blocare: ridicăm semnalul. O fila care pică nu apucă să o facă.
      window.addEventListener("pagehide", () => { try { localStorage.removeItem(BOOT_KEY); } catch {} }, { once: true });
    } catch {}
    if (interrupted) toast.info(t("Încărcarea anterioară nu s-a terminat, deci filtrele salvate au fost resetate."));
    if (urlEmpty && !interrupted) {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as { f?: unknown; perPage?: unknown } | null;
        if (saved) {
          const f = sanitizeFilters((saved.f ?? {}) as Record<string, unknown>);
          const pp = normalizePerPageClient(saved.perPage);
          if (countActiveFilters(f) > 0 || f.sort) {
            // Citire din localStorage după hidratare (serverul nu o poate face) — același tipar ca în TasksManager.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setFilters(f);
            setDraft({ q: f.q, street: f.street, minDebt: f.minDebt, maxDebt: f.maxDebt });
          }
          if (pp !== initial.perPage) setPerPage(pp);
        }
      } catch {}
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prima afișare s-a terminat fără blocaj → ridicăm protecția (dacă fila se blochează, rAF nu mai rulează și semnalul rămâne).
  useEffect(() => {
    if (!ready) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => { try { localStorage.removeItem(BOOT_KEY); } catch {} }));
    return () => cancelAnimationFrame(id);
  }, [ready, BOOT_KEY]);

  // Salvează filtrele + sincronizează URL-ul (link de partajat), fără navigare.
  useEffect(() => {
    if (!ready) return;
    const f = sanitizeFilters(filters);
    const empty = countActiveFilters(f) === 0 && !f.sort;
    try {
      if (empty && wantPerPage === DEFAULT_PER_PAGE) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify({ f, perPage: wantPerPage }));
      document.cookie = `${PAYERS_PP_COOKIE}=${wantPerPage}; path=/; max-age=31536000; samesite=lax`; // pentru randarea pe server (vezi /platitori)
    } catch {}
    const usp = filtersToParams(f);
    if (page > 1) usp.set("page", String(page));
    if (wantPerPage !== DEFAULT_PER_PAGE) usp.set("perPage", String(wantPerPage));
    const qs = usp.toString();
    window.history.replaceState(null, "", `${BASE_PATH}${qs ? `?${qs}` : ""}`);
  }, [filters, page, wantPerPage, ready, BASE_PATH, STORAGE_KEY]);

  // Încărcarea datelor: răspuns instant din cache (dacă am mai văzut pagina), apoi reîmprospătare de pe server;
  // o cerere nouă anulează pe cea veche, deci filtrarea rapidă nu se „îneacă" în răspunsuri vechi.
  useEffect(() => {
    if (!ready) return;
    if (useLocal) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      setError(null);
      return;
    }
    const cached = cache.current.get(key);
    if (cached) setData(cached);
    if (!forceReload.current && key === freshKey.current) {
      // Am revenit la o vedere deja proaspătă (ex. filtru schimbat și anulat imediat) — nimic de cerut.
      setLoading(false);
      setError(null);
      return;
    }
    forceReload.current = false;

    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setError(null);
    // Cât timp lista completă încă se încarcă local, nu pornim imediat o cerere de pagină care oricum ar fi anulată peste câteva zeci de ms.
    const wait = !ds.rows && reloadTick === 0 ? 350 : 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
    setLoading(true);
    fetch(`/api/platitori/notificari?${key}`, { signal: ctl.signal })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? t("Eroare la încărcare."));
        return j as Page;
      })
      .then((j) => {
        const next = { items: j.items, total: j.total };
        cache.current.set(key, next);
        if (cache.current.size > 40) cache.current.delete(cache.current.keys().next().value!);
        freshKey.current = key;
        setData(next);
        setLoading(false);
        // Pagina ceruptă a dispărut (ex. după ce filtrul a redus rezultatele) → ultima pagină validă.
        const pages = Math.max(1, Math.ceil(j.total / perPage));
        if (page > pages) setPage(pages);
      })
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        setError(e.message);
        setLoading(false);
      });
    };
    if (wait) timer = setTimeout(run, wait);
    else run();
    return () => {
      if (timer) clearTimeout(timer);
      ctl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready, reloadTick, useLocal]);

  const refreshDataset = ds.refresh;
  const reload = useCallback(() => {
    void refreshDataset();
    cache.current.clear();
    forceReload.current = true;
    setReloadTick((n) => n + 1);
  }, [refreshDataset]);

  function setFilter(patch: Partial<NotifyFilters>) {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  }

  function onText(k: TextKey, value: string) {
    setDraft((d) => ({ ...d, [k]: value }));
    clearTimeout(debounce.current[k]);
    // Cu lista completă în browser filtrarea e ieftină: aplicăm aproape imediat; pe server (lista încă nu e adusă) păstrăm pauza mai lungă.
    debounce.current[k] = setTimeout(() => setFilter({ [k]: value.trim() } as Partial<NotifyFilters>), ds.rows ? 120 : 350);
  }

  function clearAll() {
    Object.values(debounce.current).forEach((h) => clearTimeout(h));
    setFilters(EMPTY_FILTERS);
    setDraft({ q: "", street: "", minDebt: "", maxDebt: "" });
    setPage(1);
  }

  // Filtrele „active" iau în calcul și ce e tastat dar încă neaplicat (debounce) — culoarea reacționează imediat.
  const active = countActiveFilters({ ...filters, q: draft.q, street: draft.street, minDebt: draft.minDebt, maxDebt: draft.maxDebt });

  // ── Selecție ──
  const pageRows = view.items;

  // ── Virtualizare: din cele (până la 19.000) de rânduri ale paginii se desenează doar cele din zona vizibilă ──
  const rowCount = showAll ? view.total : pageRows.length;
  const virtualTable = !cards && rowCount > VIRTUAL_MIN;
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollRaf = useRef(0);
  const [vScroll, setVScroll] = useState({ top: 0, h: 800 });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !virtualTable) return;
    const upd = () => setVScroll((s) => (s.h === el.clientHeight ? s : { ...s, h: el.clientHeight }));
    upd();
    const obs = new ResizeObserver(upd);
    obs.observe(el);
    return () => obs.disconnect();
  }, [virtualTable]);
  // Alt filtru / altă pagină / altă sortare → tabelul revine sus (evenimentul de scroll actualizează poziția).
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [filters, page, perPage, cards]);
  function onTableScroll(e: React.UIEvent<HTMLDivElement>) {
    const top = e.currentTarget.scrollTop;
    if (scrollRaf.current) return;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0;
      setVScroll((s) => (s.top === top ? s : { ...s, top }));
    });
  }
  const winStart = virtualTable ? Math.max(0, Math.floor(vScroll.top / ROW_H) - 12) : 0;
  const winEnd = virtualTable ? Math.min(rowCount, Math.ceil((vScroll.top + vScroll.h) / ROW_H) + 12) : pageRows.length;
  const winRows = virtualTable ? pageRows.slice(winStart, Math.min(winEnd, pageRows.length)) : pageRows;
  /** Carduri (mod telefon): listă virtualizată cu înălțimi variabile (cardurile se desfac la atingere). */
  function renderRows(rows: PayerRow[], fn: (r: PayerRow, i: number) => React.ReactNode) {
    const n = showAll ? view.total : rows.length;
    if (n <= VIRTUAL_MIN) return rows.map(fn);
    return (
      <VirtualList
        count={n}
        itemKey={(i) => (rows[i] ? rows[i].id : `sk-${i}`)}
        render={(i) => (rows[i] ? fn(rows[i], i) : <div className="h-11 animate-pulse rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)]" />)}
      />
    );
  }
  const allOnPage = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));
  const someOnPage = pageRows.some((r) => selected.has(r.id));
  const headerCheck = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerCheck.current) headerCheck.current.indeterminate = someOnPage && !allOnPage;
  }, [someOnPage, allOnPage]);

  function toggleRow(i: number, shift: boolean) {
    const row = pageRows[i];
    if (!row) return;
    // Ultimul rând bifat se citește ACUM: funcția de mai jos rulează mai târziu, când `lastClicked` a fost deja mutat pe rândul curent
    // (din cauza asta, Shift+click bifa doar rândul apăsat, nu și intervalul).
    const last = lastClicked.current;
    setSelected((prev) => {
      const next = new Map(prev);
      const on = !prev.has(row.id);
      const from = shift && last !== null ? Math.min(last, i) : i;
      const to = shift && last !== null ? Math.max(last, i) : i;
      for (let j = from; j <= to; j++) {
        const r = pageRows[j];
        if (on) next.set(r.id, flagsOf(r));
        else next.delete(r.id);
      }
      return next;
    });
    lastClicked.current = i;
  }

  function togglePage() {
    setSelected((prev) => {
      const next = new Map(prev);
      if (allOnPage) pageRows.forEach((r) => next.delete(r.id));
      else pageRows.forEach((r) => next.set(r.id, flagsOf(r)));
      return next;
    });
  }

  async function selectAllMatching() {
    if (localList) {
      const capped = localList.slice(0, NOTIFY_MAX_RECIPIENTS);
      setSelected(new Map(capped.map((r) => [r.id, flagsOf(r)] as [string, number])));
      toast.success(
        localList.length > capped.length
          ? t("Am selectat primii {n} din {total} (limita unei trimiteri).", { n: nf(capped.length), total: nf(localList.length) })
          : t("{n} plătitori selectați.", { n: nf(capped.length) }),
      );
      return;
    }
    const token = ++resolveToken.current;
    setResolving(true);
    try {
      const res = await resolveNotifyFilterAction(sanitizeFilters(filters));
      if (token !== resolveToken.current) return;
      if (!res.ok) { toast.error(res.error); return; }
      setSelected(new Map(res.contacts));
      toast.success(
        res.truncated
          ? t("Am selectat primii {n} din {total} (limita unei trimiteri).", { n: nf(res.contacts.length), total: nf(res.total) })
          : t("{n} plătitori selectați.", { n: nf(res.contacts.length) }),
      );
    } catch {
      if (token === resolveToken.current) toast.error(t("Nu am putut selecta lista. Încearcă din nou."));
    } finally {
      if (token === resolveToken.current) setResolving(false);
    }
  }

  const selCount = selected.size;
  const selEmail = useMemo(() => [...selected.values()].filter((f) => f & 1).length, [selected]);
  const selPhone = useMemo(() => [...selected.values()].filter((f) => f & 2).length, [selected]);

  function openCompose(recipients: Recipient[]) {
    if (recipients.length === 0) return;
    const first = pageRows.find((r) => r.id === recipients[0].id) ?? pageRows[0] ?? null;
    sentSomething.current = false;
    setCompose({ recipients, previewRow: first });
  }

  const openForSelection = () => openCompose([...selected].map(([id, flags]) => ({ id, flags })));
  const openForRow = (r: PayerRow) => openCompose([{ id: r.id, flags: flagsOf(r) }]);

  const patchNotified = ds.patchNotified;
  const patchRow = ds.patchRow;
  // „Editează" din popup: tabelul (și setul local) se schimbă imediat; popup-ul ține și el rândul curent.
  const onPayerUpdated = useCallback(
    (id: string, patch: PayerPatch) => {
      setDetailRow((r) => (r && r.id === id ? { ...r, ...patch } : r));
      setData((d) => ({ ...d, items: d.items.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
      patchRow(id, patch);
    },
    [patchRow, setDetailRow],
  );
  // Actualizare optimistă: imediat ce un lot a plecat, „Ultima notificare" se vede în tabel, fără reîncărcare.
  const onSent = useCallback((results: RecipientResult[]) => {
    const sent = new Set(results.filter((r) => r.email.status === "sent" || r.sms.status === "sent").map((r) => r.id)); // apelul nu intră aici: abia pus în coadă, „Ultima notificare" se marchează când se sună
    if (sent.size === 0) return;
    sentSomething.current = true;
    const now = new Date().toISOString();
    setData((d) => ({ ...d, items: d.items.map((r) => (sent.has(r.id) ? { ...r, lastNotifiedAt: now } : r)) }));
    patchNotified(sent, now);
  }, [patchNotified]);

  function closeCompose() {
    setCompose(null);
    if (sentSomething.current) {
      sentSomething.current = false;
      if (!useLocal) reload(); // cu motorul local, „Ultima notificare" e deja actualizată în memorie
    }
  }

  const sortToggle = (up: NotifyFilters["sort"], down: NotifyFilters["sort"]) =>
    setFilter({ sort: filters.sort === up ? down : filters.sort === down ? "" : up });
  const arrow = (up: NotifyFilters["sort"], down: NotifyFilters["sort"]) =>
    filters.sort === up ? "▲" : filters.sort === down ? "▼" : "↕";

  const pageButtons = buildPageButtons(page, totalPages);
  const from = view.total === 0 ? 0 : (page - 1) * uiPerPage + 1;
  const to = Math.min(page * uiPerPage, view.total);
  const colCount = 12 + (canSelect ? 1 : 0) + (canSend ? 1 : 0);

  return (
    <div>
      {!browseOnly && !emailEnabled && !smsEnabled && (
        <div className="mb-3 rounded-xl border border-st-progress/30 bg-st-progress/10 px-4 py-3 text-sm text-st-progress">
          {t("Niciun canal de trimitere nu este configurat. Setează SMTP_* pentru email și TWILIO_* sau SMS_HTTP_URL pentru SMS (vezi .env.example).")}
        </div>
      )}
      {!browseOnly && (emailEnabled !== smsEnabled) && (
        <p className="mb-3 text-xs text-ink-soft">
          {emailEnabled ? t("SMS-ul nu este configurat — poți trimite doar email.") : t("Emailul nu este configurat — poți trimite doar SMS.")}
        </p>
      )}

      {browseOnly && nameFixCount > 0 && (
        <button
          type="button"
          onClick={() => setFilter({ nameFix: filters.nameFix ? "" : "1" })}
          className={`tap mb-2 flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-1.5 text-left text-xs ${
            filters.nameFix ? "border-brand bg-brand-soft text-brand-strong" : "border-st-progress/30 bg-st-progress/10 text-st-progress"
          }`}
        >
          <span>{t("{n} nume conțin un caracter „?” — litere românești (Ș/Ț) pe care exportul original nu le putea reprezenta.", { n: nf(nameFixCount) })}</span>
          <span className="shrink-0 font-medium underline">{filters.nameFix ? t("Arată pe toți") : t("Arată-le")}</span>
        </button>
      )}

      {/* ── Filtre (stil Task-uri: colorate când sunt active) ─────────────────── */}
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <input
          value={draft.q}
          onChange={(e) => onText("q", e.target.value)}
          placeholder={t("Caută nume, cont, contract, email, telefon…")}
          className={`${txtFld(draft.q)} min-w-48 flex-1`}
          aria-label={t("Căutare")}
        />
        <input
          value={draft.street}
          onChange={(e) => onText("street", e.target.value)}
          placeholder={t("Stradă / adresă…")}
          className={`${txtFld(draft.street)} w-44`}
          aria-label={t("Adresă")}
        />
        <select value={filters.month} onChange={(e) => setFilter({ month: e.target.value })} className={fld(filters.month)} aria-label={t("Luna facturii")}>
          <option value="">{t("Luna facturii: ultima")}</option>
          {months.map((m) => (
            <option key={m.month} value={m.month}>{t("Factura pe {month}", { month: monthLabel(m.month) })} ({nf(m.count)})</option>
          ))}
        </select>
        <select value={filters.contact} onChange={(e) => setFilter({ contact: e.target.value as NotifyFilters["contact"] })} className={fld(filters.contact)} aria-label={t("Date de contact")}>
          <option value="">{t("Contact: toți")}</option>
          {CONTACT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
        </select>
        <select value={filters.debt} onChange={(e) => setFilter({ debt: e.target.value as NotifyFilters["debt"] })} className={fld(filters.debt)} aria-label={t("Datorie")}>
          <option value="">{t("Sold: toate")}</option>
          <option value="has">{t("Cu datorie")}</option>
          <option value="none">{t("Fără datorie")}</option>
        </select>
        <input
          value={draft.minDebt}
          onChange={(e) => onText("minDebt", e.target.value)}
          inputMode="decimal"
          placeholder={t("Sold de la")}
          className={`${txtFld(draft.minDebt)} w-24`}
          aria-label={t("Sold minim")}
        />
        <input
          value={draft.maxDebt}
          onChange={(e) => onText("maxDebt", e.target.value)}
          inputMode="decimal"
          placeholder={t("până la")}
          className={`${txtFld(draft.maxDebt)} w-24`}
          aria-label={t("Sold maxim")}
        />
        <select value={filters.invoiceStatus} onChange={(e) => setFilter({ invoiceStatus: e.target.value })} className={fld(filters.invoiceStatus)} aria-label={t("Status factură")}>
          <option value="">{t("Status factură")}</option>
          {INVOICE_STATUS_LIST.map((s) => <option key={s} value={s}>{t(INVOICE_STATUS[s].label)}</option>)}
        </select>
        <select value={filters.notified} onChange={(e) => setFilter({ notified: e.target.value as NotifyFilters["notified"] })} className={fld(filters.notified)} aria-label={t("Ultima notificare")}>
          <option value="">{t("Notificat: oricând")}</option>
          {NOTIFIED_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
        </select>
        <select value={filters.invoices} onChange={(e) => setFilter({ invoices: e.target.value as NotifyFilters["invoices"] })} className={fld(filters.invoices)} aria-label={t("Facturi")}>
          <option value="">{t("Facturi: toate")}</option>
          <option value="none">{t("Fără nicio factură")}</option>
        </select>
        <select value={filters.kind} onChange={(e) => setFilter({ kind: e.target.value as NotifyFilters["kind"] })} className={fld(filters.kind)} aria-label={t("Tip plătitor")}>
          <option value="">{t("Tip: toți")}</option>
          <option value="person">{t("Persoane fizice")}</option>
          <option value="company">{t("Firme / instituții")}</option>
        </select>
        <select value={filters.sector} onChange={(e) => setFilter({ sector: e.target.value as NotifyFilters["sector"] })} className={fld(filters.sector)} aria-label={t("Sector")}>
          <option value="">{t("Toate sectoarele")}</option>
          <option value="privat">{t("Sector privat")}</option>
          <option value="comunal">{t("Sector comunal")}</option>
        </select>
        <select value={filters.account} onChange={(e) => setFilter({ account: e.target.value as NotifyFilters["account"] })} className={fld(filters.account)} aria-label={t("Cont portal")}>
          <option value="">{t("Cont portal: toate")}</option>
          <option value="activated">{t("Activat")}</option>
          <option value="pending">{t("Neactivat")}</option>
        </select>
        <input
          type="date"
          value={filters.installedFrom}
          onChange={(e) => setFilter({ installedFrom: e.target.value })}
          title={t("Contor instalat după data")}
          aria-label={t("Contor instalat după data")}
          className={txtFld(filters.installedFrom)}
        />
        <select value={filters.sort} onChange={(e) => setFilter({ sort: e.target.value as NotifyFilters["sort"] })} className={fld(filters.sort)} aria-label={t("Sortare")}>
          <option value="">{t("Sortare: nume (A-Z)")}</option>
          <option value="debtDesc">{t("Sold: descrescător")}</option>
          <option value="debtAsc">{t("Sold: crescător")}</option>
          <option value="installDesc">{t("Instalare: recente")}</option>
          <option value="installAsc">{t("Instalare: vechi")}</option>
        </select>
        {(active > 0 || filters.sort) && (
          <button
            type="button"
            onClick={clearAll}
            className="tap h-7 rounded-lg border border-[var(--color-line)] px-2 text-[11px] text-ink-soft hover:bg-[var(--color-surface-2)]"
          >
            {t("Resetează filtrele")}{active > 0 ? ` (${active})` : ""}
          </button>
        )}
      </div>

      {/* Filtre rapide */}
      <div className={`flex flex-wrap items-center gap-1 text-[11px] ${browseOnly || canSend ? "mb-2" : ""}`}>
        {browseOnly && (
          <span className="ml-auto">
            <ExportButton
              entity="payers"
              params={{ ...Object.fromEntries(Object.entries(sanitizeFilters(filters)).filter(([, v]) => v)) }}
              label={t("Export (cu filtrele)")}
              className="tap inline-flex h-6 items-center gap-1 rounded-full border border-[var(--color-line)] px-2.5 text-[11px] hover:border-brand hover:bg-brand-soft"
            />
          </span>
        )}
        {canSend && (
          <button
            type="button"
            onClick={() => setTplOpen(true)}
            className="tap ml-auto h-6 rounded-full border border-[var(--color-line)] px-3 hover:border-brand hover:bg-brand-soft"
            title={t("Creează, editează sau șterge șabloanele de mesaje")}
          >
            📝 {t("Șabloane")}{templates.length ? ` (${templates.length})` : ""}
          </button>
        )}
      </div>

      {/* ── Bară de selecție / acțiuni ─────────────────────────────────────── */}
      {canSelect && (
        <div className={`mb-2 flex flex-wrap items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs ${selCount ? "border-brand bg-brand/10" : "border-[var(--color-line)] bg-[var(--color-surface-2)]"}`}>
          {selCount > 0 ? (
            <span className="font-semibold text-brand">
              {t("{n} selectați", { n: nf(selCount) })} {canSend && <span className="font-normal text-ink-soft">· {t("{n} cu email", { n: nf(selEmail) })} · {t("{n} cu telefon", { n: nf(selPhone) })}</span>}
            </span>
          ) : (
            <span className="text-ink-soft">{t("Bifează plătitorii (Shift = interval) sau selectează-i pe toți din filtru. Click pe un rând = datele lui.")}</span>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {view.total > 0 && (
              <button
                type="button"
                onClick={selectAllMatching}
                disabled={resolving}
                className="tap h-7 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[11px] font-medium hover:bg-brand-soft disabled:opacity-60"
              >
                {resolving ? t("Se selectează…") : (view.total > pageRows.length ? t("Selectează toți cei {n} din filtru (toate paginile)", { n: nf(view.total) }) : t("Selectează toți cei {n} din filtru", { n: nf(view.total) }))}
              </button>
            )}
            {selCount > 0 && (
              <button type="button" onClick={() => setSelected(new Map())} className="tap h-7 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[11px] hover:bg-[var(--color-surface-2)]">
                {t("Golește selecția")}
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={() => setDeleting(true)}
                disabled={selCount === 0}
                className="tap h-7 rounded-lg border border-st-cancelled/40 px-3 text-[11px] font-semibold text-st-cancelled hover:bg-st-cancelled/10 disabled:opacity-40"
                title={t("Șterge plătitorii selectați (doar cei fără facturi etc.)")}
              >
                🗑 {t("Șterge selectați")}{selCount ? ` (${nf(selCount)})` : ""}
              </button>
            )}
            {canSend && (
              <button
                type="button"
                onClick={openForSelection}
                disabled={selCount === 0}
                className="tap h-7 rounded-lg bg-brand px-3 text-[11px] font-semibold text-white hover:bg-brand-strong disabled:opacity-40"
              >
                ✉ {t("Trimite notificare")}{selCount ? ` (${nf(selCount)})` : ""}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Sumar + rânduri pe pagină ─────────────────────────────────────── */}
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
        <span><b>{nf(view.total)}</b> {t("plătitori")}{active > 0 ? ` ${t("(filtrat)")}` : ""}</span>
        {view.total > 0 && <span className="text-ink-soft">{t("afișați {from}–{to} din {total}", { from: nf(from), to: nf(to), total: nf(view.total) })}{totalPages > 1 ? ` · ${t("pagina {cur}/{pages}", { cur: page, pages: totalPages })}` : ""}</span>}
        {loading && <span className="text-ink-soft">{t("se încarcă…")}</span>}
        {ds.rows ? (
          <button
            type="button"
            onClick={() => void ds.refresh()}
            disabled={ds.loading}
            title={t("Lista e ținută în memorie și filtrată instant în browser. Apasă ca să o reîncarci de pe server.")}
            className="tap cursor-pointer text-ink-soft hover:text-brand disabled:cursor-default"
          >
            ⚡ {t("local")}{ds.loading ? ` · ${t("se reîmprospătează…")}` : ds.loadedAt ? ` · ${agoLabel(new Date(ds.loadedAt).toISOString(), t)}` : ""} ↻
          </button>
        ) : ds.loading ? (
          <span className="text-ink-soft">{t("se încarcă lista completă…")}</span>
        ) : null}
        <button
          type="button"
          onClick={toggleCards}
          aria-pressed={cards}
          title={cards ? t("Înapoi la tabel") : t("Afișează plătitorii într-o coloană mică; apeși pe unul ca să vezi detaliile (potrivit pentru telefon)")}
          className={`tap ml-auto h-7 cursor-pointer rounded-lg border px-2 text-[11px] ${cards ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink-soft hover:bg-[var(--color-surface-2)]"}`}
        >
          {cards ? `▦ ${t("Tabel")}` : `📱 ${t("Mod telefon")}`}
        </button>
        <label className="flex items-center gap-1.5 text-xs text-ink-soft">
          {t("Afișează")}
          <select
            value={wantPerPage}
            onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}
            className={fld(wantPerPage === DEFAULT_PER_PAGE ? "" : "x")}
            aria-label={t("Rânduri pe pagină")}
          >
            {NOTIFY_PER_PAGE.map((n) => <option key={n} value={n}>{perPageLabel(n, t)}</option>)}
          </select>
        </label>
      </div>
      {loading && <div className="mb-2 h-0.5 animate-pulse rounded-full bg-brand opacity-60" />}
      {error && (
        <p className="mb-2 flex items-center justify-between gap-3 rounded-lg bg-st-cancelled/10 px-3 py-2 text-sm text-st-cancelled">
          {error}
          <button type="button" onClick={reload} className="tap shrink-0 font-semibold underline">{t("Reîncearcă")}</button>
        </p>
      )}

      {/* ── Tabel (stil 1C) ───────────────────────────────────────────────── */}
      {cards ? (
        <div className={`flex flex-col gap-1.5 transition-opacity duration-150 ${loading ? "opacity-60" : ""}`}>
          {renderRows(pageRows, (r, i) => {
            const sel = selected.has(r.id);
            const st = r.latestInvoice ? INVOICE_STATUS[r.latestInvoice.status as InvoiceStatusKey] : null;
            const flags = flagsOf(r);
            const recent = notifiedRecently(r.lastNotifiedAt);
            return (
              <CompactCard
                key={r.id}
                selected={sel}
                avatar={r.name.trim().charAt(0).toUpperCase()}
                leading={
                  canSelect ? (
                    <input
                      type="checkbox"
                      checked={sel}
                      onChange={() => toggleRow(i, false)}
                      className="size-4 shrink-0 cursor-pointer accent-[var(--color-brand)]"
                      aria-label={`${t("Selectează")} ${r.name}`}
                    />
                  ) : undefined
                }
                title={r.name}
                subtitle={
                  <>
                    <span>{r.meterSeries ?? r.contract ?? "—"}</span>
                    {st && <span className={`inline-block rounded-full px-1.5 text-[10px] font-medium ${st.cls}`}>{t(st.label)}</span>}
                  </>
                }
                trailing={r.latestInvoice ? <span className={`tabular-nums ${r.latestInvoice.grandTotal > 0 ? "font-semibold" : "text-ink-soft"}`}>{money(r.latestInvoice.grandTotal)}</span> : undefined}
              >
                <dl>
                  <CompactField label={t("Adresă")}>{r.consumAddress ?? <Dash />}</CompactField>
                  <CompactField label={t("Email")}>
                    {r.email ? <span className={flags & 1 ? "" : "text-st-progress"} title={flags & 1 ? undefined : t("Adresă invalidă")}>{r.email}</span> : <Dash />}
                  </CompactField>
                  <CompactField label={t("Telefon")}>
                    {r.phone ? <span className={`tabular-nums ${flags & 2 ? "" : "text-st-progress"}`} title={flags & 2 ? undefined : t("Număr invalid pentru SMS")}>{r.phone}</span> : <Dash />}
                  </CompactField>
                  <CompactField label={t("Factură")}>{r.latestInvoice?.number ?? <Dash />}</CompactField>
                  <CompactField label={t("Scadență")}>{r.latestInvoice?.dueDate ? fmtDay(r.latestInvoice.dueDate) : <Dash />}</CompactField>
                  <CompactField label={t("Portal")}>{r.activated ? <span className="text-st-done">✓ {t("activ")}</span> : <span className="text-ink-soft/60">—</span>}</CompactField>
                  <CompactField label={t("Facturi")}>{r.invoiceCount}</CompactField>
                  <CompactField label={t("Ultima notificare")}>
                    {r.lastNotifiedAt ? <span className={recent ? "font-medium text-st-done" : "text-ink-soft"}>● {agoLabel(r.lastNotifiedAt, t)}</span> : <Dash />}
                  </CompactField>
                </dl>
                <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-line)]/60 px-2.5 py-1.5">
                  <button type="button" onClick={() => setDetailRow(r)} className="tap h-7 cursor-pointer rounded-lg bg-brand px-3 text-[11px] font-semibold text-white hover:bg-brand-strong">{t("Fișa plătitorului")}</button>
                  {canSend && (
                    <button
                      type="button"
                      disabled={flags === 0}
                      onClick={() => openForRow(r)}
                      title={flags === 0 ? t("Fără email/telefon valid") : t("Trimite doar acestui plătitor")}
                      className="tap h-7 cursor-pointer rounded-lg border border-[var(--color-line)] px-3 text-[11px] font-medium hover:bg-brand-soft disabled:cursor-default disabled:opacity-30"
                    >
                      ✉ {t("Trimite")}
                    </button>
                  )}
                </div>
              </CompactCard>
            );
          })}
          {pageRows.length === 0 && !loading && (
            <div className="card p-8 text-center text-ink-soft">
              {t("Niciun plătitor cu filtrele acestea.")}{" "}
              {active > 0 && <button type="button" onClick={clearAll} className="font-semibold text-brand underline">{t("Resetează filtrele")}</button>}
            </div>
          )}
        </div>
      ) : (
      <div
        ref={scrollRef}
        onScroll={virtualTable ? onTableScroll : undefined}
        className={`card overflow-auto transition-opacity duration-150 ${loading ? "opacity-60" : ""}`}
        style={{ maxHeight: rowCount > 50 ? "max(78vh, 890px)" : undefined }}
      >
        <table className="min-w-full table-fixed border-separate border-spacing-0 text-[11px] leading-[14px]" style={{ width: COL_W.reduce((a, b) => a + b, 0) + (canSelect ? 28 : 0) + (canSend ? 32 : 0) }}>
          <colgroup>
            {canSelect && <col style={{ width: 28 }} />}
            {COL_W.map((w, i) => <col key={i} style={{ width: w }} />)}
            {canSend && <col style={{ width: 32 }} />}
          </colgroup>
          <thead className="sticky top-0 z-20 bg-[var(--color-surface-2)]">
            <tr>
              {canSelect && (
                <th className="sticky left-0 z-30 w-7 border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-1.5 py-1">
                  <input
                    ref={headerCheck}
                    type="checkbox"
                    checked={allOnPage}
                    onChange={togglePage}
                    className="size-3 accent-[var(--color-brand)]"
                    aria-label={t("Selectează pagina")}
                  />
                </th>
              )}
              <Th sticky={canSelect ? "left-7" : "left-0"} minW={190}>
                <button type="button" onClick={() => setFilter({ sort: "" })} className="font-semibold hover:text-brand">{t("Plătitor")}</button>
              </Th>
              <Th minW={95}>{t("Cont / contract")}</Th>
              <Th minW={160}>{t("Adresă")}</Th>
              <Th minW={160}>{t("Email")}</Th>
              <Th minW={95}>{t("Telefon")}</Th>
              <Th minW={80}>{t("Factură")}</Th>
              <Th minW={70}>{t("Scadență")}</Th>
              <Th minW={80} right>
                <button type="button" onClick={() => sortToggle("debtDesc", "debtAsc")} className="inline-flex items-center gap-1 font-semibold hover:text-brand">
                  {t("De achitat")} <span className="text-[10px] text-ink-soft">{arrow("debtDesc", "debtAsc")}</span>
                </button>
              </Th>
              <Th minW={65}>{t("Status")}</Th>
              <Th minW={50}>{t("Portal")}</Th>
              <Th minW={45} right>{t("Facturi")}</Th>
              <Th minW={95}>{t("Ultima notificare")}</Th>
              {canSend && <Th minW={32}> </Th>}
            </tr>
          </thead>
          <tbody>
            {winStart > 0 && (
              <tr aria-hidden>
                <td colSpan={colCount} style={{ height: winStart * ROW_H, padding: 0, border: 0 }} />
              </tr>
            )}
            {winRows.map((r, k) => {
              const i = winStart + k;
              const sel = selected.has(r.id);
              const st = r.latestInvoice ? INVOICE_STATUS[r.latestInvoice.status as InvoiceStatusKey] : null;
              const flags = flagsOf(r);
              const recent = notifiedRecently(r.lastNotifiedAt);
              const bg = sel ? "bg-brand-soft" : "bg-[var(--color-surface)]";
              return (
                <tr
                  key={r.id}
                  onClick={() => setDetailRow(r)}
                  style={{ height: ROW_H }}
                  className={`cursor-pointer ${sel ? "bg-brand-soft/60" : "hover:bg-brand-soft/30"}`}
                >
                  {canSelect && (
                    <td
                      className={`sticky left-0 z-10 cursor-pointer border-b border-[var(--color-line)] px-1.5 py-px ${bg}`}
                      onClick={(e) => { e.stopPropagation(); toggleRow(i, e.shiftKey); }}
                      onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
                      title={t("Bifează (Shift = interval)")}
                    >
                      <input type="checkbox" checked={sel} readOnly tabIndex={-1} className="pointer-events-none block size-3 accent-[var(--color-brand)]" aria-label={`${t("Selectează")} ${r.name}`} />
                    </td>
                  )}
                  <td className={`sticky ${canSelect ? "left-7" : "left-0"} z-10 border-b border-[var(--color-line)] px-1.5 py-px font-medium ${bg}`} style={{ maxWidth: 220 }}>
                    <div className="truncate hover:text-brand" title={r.name}>{r.name}</div>
                  </td>
                  <td className="border-b border-[var(--color-line)] px-1.5 py-px">{r.meterSeries ?? r.contract ?? "—"}</td>
                  <td className="border-b border-[var(--color-line)] px-1.5 py-px" style={{ maxWidth: 190 }}>
                    <div className="truncate" title={r.consumAddress ?? ""}>{r.consumAddress ?? <Dash />}</div>
                  </td>
                  <td className="border-b border-[var(--color-line)] px-1.5 py-px" style={{ maxWidth: 190 }}>
                    {r.email ? (
                      <div className={`truncate ${flags & 1 ? "" : "text-st-progress"}`} title={flags & 1 ? r.email : `${t("Adresă invalidă")}: ${r.email}`}>{r.email}</div>
                    ) : <Dash />}
                  </td>
                  <td className="border-b border-[var(--color-line)] px-1.5 py-px tabular-nums">
                    {r.phone ? (
                      <span className={flags & 2 ? "" : "text-st-progress"} title={flags & 2 ? undefined : t("Număr invalid pentru SMS")}>{r.phone}</span>
                    ) : <Dash />}
                  </td>
                  <td className="border-b border-[var(--color-line)] px-1.5 py-px">{r.latestInvoice?.number ?? <Dash />}</td>
                  <td className="border-b border-[var(--color-line)] px-1.5 py-px">{r.latestInvoice?.dueDate ? fmtDay(r.latestInvoice.dueDate) : <Dash />}</td>
                  <td className={`border-b border-[var(--color-line)] px-1.5 py-px text-right tabular-nums ${r.latestInvoice && r.latestInvoice.grandTotal > 0 ? "font-semibold" : "text-ink-soft"}`}>
                    {r.latestInvoice ? money(r.latestInvoice.grandTotal) : <Dash />}
                  </td>
                  <td className="border-b border-[var(--color-line)] px-1.5 py-px">
                    {st ? <span className={`inline-block rounded-full px-1.5 text-[10px] leading-[14px] font-medium ${st.cls}`}>{t(st.label)}</span> : <Dash />}
                  </td>
                  <td className="border-b border-[var(--color-line)] px-1.5 py-px" title={r.activated ? t("Cont portal activat") : t("Cont portal neactivat")}>
                    {r.activated ? <span className="text-st-done">✓ {t("activ")}</span> : <span className="text-ink-soft/60">—</span>}
                  </td>
                  <td className="border-b border-[var(--color-line)] px-1.5 py-px text-right tabular-nums text-ink-soft">{r.invoiceCount}</td>
                  <td className="border-b border-[var(--color-line)] px-1.5 py-px whitespace-nowrap" title={r.lastNotifiedAt ? new Date(r.lastNotifiedAt).toLocaleString(tag) : t("Niciodată notificat")}>
                    {r.lastNotifiedAt ? (
                      <span className={recent ? "font-medium text-st-done" : "text-ink-soft"}>● {agoLabel(r.lastNotifiedAt, t)}</span>
                    ) : <Dash />}
                  </td>
                  {canSend && (
                    <td className="border-b border-[var(--color-line)] px-1.5 py-px">
                      <button
                        type="button"
                        disabled={flags === 0}
                        onClick={(e) => { e.stopPropagation(); openForRow(r); }}
                        title={flags === 0 ? t("Fără email/telefon valid") : t("Trimite doar acestui plătitor")}
                        className="tap grid size-4 place-items-center rounded border text-[9px] leading-none border-[var(--color-line)] hover:bg-brand-soft disabled:opacity-30"
                      >
                        ✉
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
            {winEnd > pageRows.length && winStart < winEnd &&
              Array.from({ length: winEnd - Math.max(winStart, pageRows.length) }, (_, k) => (
                <tr key={`sk-${Math.max(winStart, pageRows.length) + k}`} aria-hidden style={{ height: ROW_H }}>
                  <td colSpan={colCount} className="border-b border-[var(--color-line)] px-2 text-ink-soft/40">…</td>
                </tr>
              ))}
            {winEnd < rowCount && (
              <tr aria-hidden>
                <td colSpan={colCount} style={{ height: (rowCount - winEnd) * ROW_H, padding: 0, border: 0 }} />
              </tr>
            )}
            {pageRows.length === 0 && !loading && (
              <tr>
                <td colSpan={colCount} className="p-8 text-center text-ink-soft">
                  {t("Niciun plătitor cu filtrele acestea.")}{" "}
                  {active > 0 && <button type="button" onClick={clearAll} className="font-semibold text-brand underline">{t("Resetează filtrele")}</button>}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      {/* ── Paginare numerică (ca în Task-uri) ─────────────────────────────── */}
      {view.total > 0 && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-1">
          <button
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="tap grid size-7 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40"
            aria-label={t("Pagina anterioară")}
          >
            <IconChevronLeft className="size-4" />
          </button>
          {pageButtons.map((b, i) =>
            b === "…" ? (
              <span key={`e${i}`} className="flex h-7 w-6 items-center justify-center text-sm text-ink-soft">…</span>
            ) : (
              <button
                key={b}
                onClick={() => setPage(b)}
                className={`tap h-7 min-w-[28px] rounded-lg px-2 text-xs font-medium ${
                  b === page ? "bg-brand text-white" : "border border-[var(--color-line)] text-ink hover:bg-[var(--color-surface-2)]"
                }`}
              >
                {b}
              </button>
            ),
          )}
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
            className="tap grid size-7 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40"
            aria-label={t("Pagina următoare")}
          >
            <IconChevronRight className="size-4" />
          </button>
        </div>
      )}

      {tplOpen && (
        <PayerTemplatesDialog
          templates={templates}
          onCreate={createTemplate}
          onUpdate={updateTemplate}
          onDelete={deleteTemplate}
          onClose={() => setTplOpen(false)}
        />
      )}

      {deleting && (
        <PayerBulkDeleteDialog
          ids={[...selected.keys()]}
          onClose={() => setDeleting(false)}
          onDone={(deletedIds) => {
            setDeleting(false);
            if (deletedIds.length) {
              const gone = new Set(deletedIds);
              setSelected((prev) => new Map([...prev].filter(([id]) => !gone.has(id))));
              reload();
            }
          }}
        />
      )}

      {detailRow && (
        <PayerDetailDialog
          row={detailRow}
          canSend={canSend}
          canNote={canSendProp}
          canEditInvoices={canEditInvoices}
          onUpdated={onPayerUpdated}
          userId={userId}
          isAdmin={isAdmin}
          hasContact={flagsOf(detailRow) !== 0}
          onSend={() => { const r = detailRow; setDetailRow(null); openForRow(r); }}
          onClose={() => setDetailRow(null)}
        />
      )}

      {compose && (
        <PayerNotifyDialog
          recipients={compose.recipients}
          previewName={compose.previewRow?.name ?? t("Ion Popescu (exemplu)")}
          previewVars={compose.previewRow ? rowVars(compose.previewRow) : SAMPLE_VARS}
          emailEnabled={emailEnabled}
          smsEnabled={smsEnabled}
          callEnabled={callEnabled}
          userEmail={userEmail}
          templates={templates}
          onSaveTemplate={createTemplate}
          onClose={closeCompose}
          onSent={onSent}
          onSelectFailed={(ids) => {
            // Păstrăm steagurile de contact știute; cei fără rând încărcat se tratează ca având ambele canale.
            const known = new Map(compose.recipients.map((r) => [r.id, r.flags]));
            setSelected(new Map(ids.map((id) => [id, known.get(id) ?? 3])));
            closeCompose();
          }}
        />
      )}
    </div>
  );
}

function Dash() {
  return <span className="text-ink-soft/60">—</span>;
}

function Th({
  children, minW, right, sticky,
}: {
  children: React.ReactNode;
  minW: number;
  right?: boolean;
  sticky?: string;
}) {
  return (
    <th
      style={{ minWidth: minW }}
      className={`border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-1.5 py-1 font-semibold ${right ? "text-right" : "text-left"} ${
        sticky ? `sticky ${sticky} z-30` : ""
      }`}
    >
      {children}
    </th>
  );
}

/** Butoanele de paginare cu „…" pentru spații mari (aceeași logică ca în Task-uri). */
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
