"use client";

import DateFilterInput from "./DateFilterInput";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { PayerRow } from "@/lib/queries/payers";
import {
  CONTACT_OPTIONS,
  DEFAULT_PER_PAGE,
  EMPTY_FILTERS,
  NO_INVOICE_VALUES,
  withCurrentMonth,
  noInvoiceRun,
  runMonths,
  type SnapInvoice,
  NOTIFIED_OPTIONS,
  viaChannel,
  viaMode,
  composeVia,
  notifyCriterion,
  notifyCriterionKey,
  NOTIFY_MAX_RECIPIENTS,
  PER_PAGE_ALL,
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
import { useToast } from "./toast";
import { AGING_BUCKETS } from "@/lib/debt-aging";
import { useLocale, useT } from "@/lib/i18n/context";
import FiltersToggle from "./FiltersToggle";
import { useFiltersOpen } from "./useFiltersOpen";
import { dateTag } from "@/lib/i18n/t";
import PayerNotifyDialog, { type Recipient } from "./PayerNotifyDialog";
import PayerTemplatesDialog from "./PayerTemplatesDialog";
import PayerDetailDialog, { type PayerPatch } from "./PayerDetailDialog";
import ContractExpiry from "./ContractExpiry";
import { CONTRACT_EXP_OPTIONS } from "@/lib/contract-expiry";
import { METROLOGY_FILTER_OPTIONS } from "@/lib/metrology";
import { PAYER_ISSUE_OPTIONS } from "@/lib/meter-issue-register";
import PayerBulkDeleteDialog from "./PayerBulkDeleteDialog";
import { PAYERS_PP_COOKIE } from "@/lib/payer-prefs";
import { usePayerDataset } from "./usePayerDataset";
import SectorFilter from "./SectorFilter";
import { addressLocality, distinctBy, distinctSectors } from "@/lib/sector-filter";
import ExportButton from "./ExportButton";
import {
  createPayerTemplateAction,
  deletePayerTemplateAction,
  updatePayerTemplateAction,
} from "@/app/actions/payer-templates";
import type { PayerTemplate, PayerTemplateDraft } from "@/lib/payer-notify";
import DataTable, { type Col } from "./DataTable";
import { BRAND } from "@/lib/brand";
import { ONEC_COLUMNS, type OneCColumn } from "@/lib/apa-canal-1c";
import { HEAD, type OneCTuple } from "@/lib/onec-table";
import { useOneCDataset } from "./useOneCDataset";

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
    expired: r.latestInvoice?.debt ?? null,
    currency: r.latestInvoice?.currency ?? null,
    invoiceNumber: r.latestInvoice?.number ?? null,
    dueDate: r.latestInvoice?.dueDate ?? null,
    address: r.consumAddress,
    issues: r.issuesOpen > 0 ? (r.issuesOpen === 1 ? "neregulă de contor" : `${r.issuesOpen} nereguli de contor`) : null,
    issueDue: r.issueDueAt,
  });
}

const SAMPLE_VARS = buildVars({
  invoiceLink: "https://exemplu.md/invoice/public/…",
  name: "Ion Popescu", account: "123456", amount: 250, expired: 180, currency: "MDL", invoiceNumber: "AC-0001",
  dueDate: new Date(Date.now() + 10 * 86_400_000), address: "str. Exemplu 1",
  issues: "Sigiliu rupt sau lipsă (contor 123456)", issueDue: new Date(Date.now() + 10 * 86_400_000),
});

/** Valoarea unei coloane din tabelul 1C, ca text (sumele cu 2 zecimale, ca în „Tabel 1C”). */
const MONEY_1C = new Set(["calculat", "datorieAvans", "deAchitat", "apaSuma", "canalSuma", "apaTarif", "canalTarif"]);
function fmt1c(c: OneCColumn, v: string | number | null | undefined): string {
  if (v == null || v === "") return "";
  if (c.type === "num") return MONEY_1C.has(c.key) ? Number(v).toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v);
  return String(v);
}

function queryKey(f: NotifyFilters, page: number, perPage: number): string {
  return filtersToParams(sanitizeFilters(f), { page, perPage }).toString();
}

type TextKey = "q" | "street" | "minDebt" | "maxDebt";

/**
 * „Toate" înseamnă 19.000 de rânduri în memorie, dar în DOM stau doar cele vizibile (virtualizare): fără ea, desenarea tuturor era
 * sute de mii de noduri (măsurat: 343.000 de noduri și 220 MB pe telefon → fila pica, iar alegerea salvată se reaplica la fiecare deschidere).
 */
const SERVER_MAX_ROWS = 200; // doar cât timp lista completă nu e încă în browser (răspunsul vine de pe server)
const BOOT_GUARD_MS = 120_000;

export default function PayerNotifyManager({
  initial,
  months,
  initialTemplates,
  canSend: canSendProp,
  canTask = false,
  emailEnabled,
  smsEnabled,
  callEnabled = false,
  userEmail,
  userId = "",
  isAdmin = false,
  canDelete = false,
  canEditPayer = false,
  canEditInvoices = false,
  basePath = "/notificari-platitori",
  browseOnly = false,
  topActions,
  canExport = true,
  nameFixCount = 0,
}: {
  initial: { filters: NotifyFilters; page: number; perPage: number; items: PayerRow[]; total: number };
  months: { month: string; count: number }[];
  initialTemplates: PayerTemplate[];
  canSend: boolean;
  /** Are „Sarcini – Creare": rândul are „+" pentru o sarcină nouă (clientul și adresa se completează singure). */
  canTask?: boolean;
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
  /** Plătitori – Editare: fișa (editare nume/telefon/email) și notițele. Fără ea fișa e doar de citit. */
  canEditPayer?: boolean;
  /** Ruta paginii — pentru URL și cheia de salvare a filtrelor (fiecare pagină își ține filtrele separat). */
  basePath?: string;
  /** Mod „răsfoire" (/platitori): același tabel, fără bife/trimitere/șabloane, cu export. */
  browseOnly?: boolean;
  /** Butoane ale paginii (Tabel 1C, sincronizare, import…), puse în același rând compact cu filtrele și numărătoarea. */
  topActions?: React.ReactNode;
  /** Permisiunea „Export plătitori”. */
  canExport?: boolean;
  /** Câte nume au „?" — arată bannerul de corectare (doar în modul răsfoire). */
  nameFixCount?: number;
}) {
  const toast = useToast();
  const t = useT();
  const [fOpen, toggleF] = useFiltersOpen(browseOnly ? "payers" : "notify");
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
  // Filtrul de plăți se aplică pe factura unei luni: fără lună aleasă (ex. dintr-un link sau filtre salvate) se alege cea mai recentă — aceeași regulă pe ecran, la trimitere și la export
  const pinMonth = (f: NotifyFilters): NotifyFilters => (f.bal && !f.month && months[0] ? { ...f, month: months[0].month } : f);
  const [filters, setFilters] = useState<NotifyFilters>(() => pinMonth(initial.filters));
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
  // ── Șabloane (optimist: UI-ul se schimbă pe loc, serverul confirmă din urmă; la eșec revenim + mesaj) ──
  const [templates, setTemplates] = useState<PayerTemplate[]>(initialTemplates);
  const [tplOpen, setTplOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<PayerRow | null>(null);

  function createTemplate(d: PayerTemplateDraft) {
    const tmp = `tmp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    setTemplates((ts) => [{ id: tmp, ...d }, ...ts]);
    createPayerTemplateAction(d)
      .then((res) => {
        if (res.ok) setTemplates((ts) => ts.map((x) => (x.id === tmp ? res.template : x)));
        else { setTemplates((ts) => ts.filter((x) => x.id !== tmp)); toast.error(t(res.error)); }
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
  const uSectors = useMemo(() => (ds.rows ? distinctSectors(ds.rows) : []), [ds.rows]);
  const uLocs = useMemo(() => (ds.rows ? distinctBy(ds.rows, (r) => addressLocality(r.consumAddress)) : []), [ds.rows]);
  // Controalele (liste, câmpuri) se actualizează imediat; lista de 19.000 de rânduri se recalculează în randarea următoare (amânată), deci
  // un select nu „se agață" cât timp se filtrează/sortează.
  const listFilters = useDeferredValue(filters);
  const monthMap = listFilters.month ? (ds.monthMaps.get(listFilters.month) ?? null) : null;
  // Filtrul „canal + perioadă" se evaluează pe jurnalul de trimiteri: serverul dă mulțimea de plătitori (id-uri), iar filtrarea rămâne locală.
  // Până sosește mulțimea, lista vine de pe server (care aplică același criteriu), deci nimic nu se blochează.
  const crit = notifyCriterion(listFilters);
  const critKey = crit ? notifyCriterionKey(crit) : "";
  const [notifySets, setNotifySets] = useState<Map<string, Set<string>>>(new Map());
  const notifySet = critKey ? (notifySets.get(critKey) ?? null) : null;
  const haveNotifySet = !!notifySet;
  // „Datorie pe vechime”: serverul dă id-urile plătitorilor din intervalul ales (raportul de datorii), iar filtrarea rămâne locală, direct în tabel.
  // Până sosesc, lista vine de pe server (care aplică același criteriu).
  const agingKey = listFilters.aging;
  const [agingSets, setAgingSets] = useState<Map<string, Set<string>>>(new Map());
  const agingSet = agingKey ? (agingSets.get(agingKey) ?? null) : null;
  const haveAgingSet = !!agingSet;
  useEffect(() => {
    if (!ready || !agingKey || haveAgingSet) return;
    const ctl = new AbortController();
    fetch(`/api/platitori/aging-ids?bucket=${encodeURIComponent(agingKey)}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ids?: string[] } | null) => {
        if (j?.ids) setAgingSets((m) => new Map(m).set(agingKey, new Set(j.ids)));
      })
      .catch(() => {});
    return () => ctl.abort();
  }, [ready, agingKey, haveAgingSet]);
  useEffect(() => {
    if (!ready || !critKey || haveNotifySet) return;
    const ctl = new AbortController();
    const q = new URLSearchParams({ via: listFilters.via, notifiedFrom: listFilters.notifiedFrom, notifiedTo: listFilters.notifiedTo });
    fetch(`/api/platitori/notificari-ids?${q}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ids?: string[] } | null) => {
        if (j?.ids) setNotifySets((m) => new Map(m).set(critKey, new Set(j.ids)));
      })
      .catch(() => {});
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, critKey, haveNotifySet]);
  // „Fără factură N luni la rând”: feliile lunilor seriei (se aduc în avans); până sosesc toate, lista vine de pe server (care aplică aceeași regulă).
  const run = noInvoiceRun(listFilters);
  const monthChoices = useMemo(() => withCurrentMonth(months), [months]);
  const refMonth = listFilters.month || monthChoices[0]?.month || "";
  const runList = useMemo(() => (run > 1 && refMonth ? runMonths(refMonth, run) : []), [run, refMonth]);
  const runMaps = useMemo(() => {
    if (runList.length === 0) return null;
    const ms = runList.map((m) => ds.monthMaps.get(m));
    return ms.every((x): x is Map<string, SnapInvoice> => !!x) ? ms : null;
  }, [runList, ds.monthMaps]);
  const useLocal = !!ds.rows && (!listFilters.month || !!monthMap) && (!critKey || haveNotifySet) && (!agingKey || haveAgingSet) && (runList.length === 0 || !!runMaps);
  // Cu lista completă în browser, orice dimensiune de pagină (inclusiv „Toate") e instant; până atunci serverul dă cel mult 200 de rânduri.
  const perPage = useLocal ? wantPerPage : Math.min(wantPerPage, SERVER_MAX_ROWS);
  const key = queryKey(filters, page, perPage);
  const localList = useMemo(
    () => (useLocal && ds.rows ? filterSnapshot(ds.rows, sanitizeFilters(listFilters), monthMap, notifySet, agingSet, runMaps) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [useLocal, ds.rows, ds.version, listFilters, monthMap, notifySet, agingSet, runMaps],
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
  useEffect(() => {
    if (ds.rows) for (const m of runList) ensureMonth(m);
  }, [runList, ds.rows, ensureMonth]);
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
            setFilters(pinMonth(f));
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
        setError(t(e.message));
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
      if (!res.ok) { toast.error(t(res.error)); return; }
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
    const sent = new Set(results.filter((r) => r.email.status === "sent" || r.sms.status === "sent" || r.pdf?.status === "sent").map((r) => r.id)); // apelul nu intră aici: abia pus în coadă, „Ultima notificare" se marchează când se sună
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
      setNotifySets(new Map()); // jurnalul s-a schimbat: mulțimile „canal + perioadă" se recitesc
      if (!useLocal) reload(); // cu motorul local, „Ultima notificare" e deja actualizată în memorie
    }
  }


  /** Sarcină nouă pentru plătitor: pagina de sarcini deschide fereastra de creare cu clientul ales și adresa lui completată. */
  const taskHref = (r: PayerRow) => {
    const sp = new URLSearchParams({ create: "task", client: r.id, desc: [r.name, r.meterSeries ?? r.contract, r.phone].filter(Boolean).join(" · ") });
    return `/tasks?${sp.toString()}`;
  };
  /** Cerere nouă pentru plătitor: pagina de cereri deschide fereastra de creare cu plătitorul, adresa și telefonul lui; șabloanele de cereri se completează cu datele lui. */
  const ticketHref = (r: PayerRow) => {
    const sp = new URLSearchParams({ create: "ticket", client: r.id, desc: [r.name, r.meterSeries ?? r.contract, r.phone].filter(Boolean).join(" · ") });
    if (r.phone) sp.set("phone", r.phone.replace(/[^\d+]/g, ""));
    return `/tickets?${sp.toString()}`;
  };

  // ── Coloane (ca la Sarcini): se mută, se ascund, se redimensionează și se colorează din „⚙ Coloane”; alegerea rămâne salvată în browser, iar „Resetează” revine la cele de la început.
  //    Din tabelul 1C se pot adăuga câte coloane vrei (ascunse implicit): datele se leagă de plătitor prin clientul din 1C (luna cea mai recentă) și se încarcă doar când alegi o astfel de coloană. ──
  const [need1c, setNeed1c] = useState(false);
  const oc = useOneCDataset(need1c ? "latest" : null);
  const ocByClient = useMemo(() => {
    const m = new Map<string, OneCTuple>();
    for (const row of oc.rows ?? []) {
      const cid = row[1];
      if (typeof cid === "string" && cid) m.set(cid, row);
    }
    return m;
  }, [oc.rows]);
  function toggleOne(r: PayerRow) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (prev.has(r.id)) next.delete(r.id);
      else next.set(r.id, flagsOf(r));
      return next;
    });
  }
  const dash = <Dash />;
  const selCols: Col<PayerRow>[] = canSelect
    ? [{
        key: "sel", label: "", minW: 30,
        render: (r) => <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r)} aria-label={`${t("Selectează")} ${r.name}`} className="block size-3.5 cursor-pointer accent-[var(--color-brand)]" />,
      }]
    : [];
  const mainCols: Col<PayerRow>[] = [
    { key: "address", label: "Adresă", minW: 220, maxW: 300, sticky: true, sort: (r) => r.consumAddress ?? "", render: (r) => r.consumAddress ?? dash },
    { key: "name", label: "Plătitor", minW: 200, maxW: 280, sort: (r) => r.name, render: (r) => <span className="font-medium">{r.name}</span> },
    { key: "account", label: "Cont / contract", minW: 108, sort: (r) => r.meterSeries ?? r.contract ?? "", render: (r) => r.meterSeries ?? r.contract ?? "—" },
    { key: "contractExp", label: "Contract expiră", minW: 92, sort: (r) => r.contractExpiresAt ?? "", render: (r) => (r.contractExpiresAt ? <ContractExpiry date={r.contractExpiresAt} compact /> : dash) },
    { key: "metro", label: "Verificare metrologică", minW: 96, sort: (r) => r.metrologyDueAt ?? "", render: (r) => (r.metrologyDueAt ? <ContractExpiry date={r.metrologyDueAt} compact /> : dash) },
    {
      key: "issues", label: "Nereguli contoare", minW: 96, sort: (r) => r.issuesOpen,
      render: (r) => (r.issuesOpen > 0
        ? <a href={`/contoare/nereguli?q=${encodeURIComponent(r.meterSeries ?? r.contract ?? r.name)}`} className="hover:underline" title={t("Vezi neregulile în „Nereguli contoare”")}><b>{r.issuesOpen}</b>{r.issueDueAt ? <> · <ContractExpiry date={r.issueDueAt} compact /></> : null}</a>
        : dash),
    },
    {
      key: "email", label: "Email", minW: 160, maxW: 240, sort: (r) => r.email ?? "",
      render: (r) => (r.email ? <span className={flagsOf(r) & 1 ? "" : "text-st-progress"} title={flagsOf(r) & 1 ? r.email : `${t("Adresă invalidă")}: ${r.email}`}>{r.email}</span> : dash),
    },
    {
      key: "phone", label: "Telefon", minW: 108, sort: (r) => r.phone ?? "",
      render: (r) => (r.phone ? <span className={`tabular-nums ${flagsOf(r) & 2 ? "" : "text-st-progress"}`} title={flagsOf(r) & 2 ? undefined : t("Număr invalid pentru SMS")}>{r.phone}</span> : dash),
    },
    { key: "invoice", label: "Factură", minW: 120, sort: (r) => r.latestInvoice?.number ?? "", render: (r) => r.latestInvoice?.number ?? dash },
    { key: "due", label: "Scadență", minW: 80, sort: (r) => r.latestInvoice?.dueDate ?? "", render: (r) => (r.latestInvoice?.dueDate ? fmtDay(r.latestInvoice.dueDate) : dash) },
    {
      key: "amount", label: "De achitat", minW: 90, right: true, sort: (r) => r.latestInvoice?.grandTotal ?? null,
      render: (r) => (r.latestInvoice ? <span className={r.latestInvoice.grandTotal > 0 ? "font-semibold" : "text-ink-soft"}>{money(r.latestInvoice.grandTotal)}</span> : dash),
    },
    {
      key: "status", label: "Status", minW: 75, sort: (r) => r.latestInvoice?.status ?? "",
      render: (r) => {
        const st = r.latestInvoice ? INVOICE_STATUS[r.latestInvoice.status as InvoiceStatusKey] : null;
        return st ? <span className={`inline-block rounded-full px-1.5 text-[10px] leading-[14px] font-medium ${st.cls}`}>{t(st.label)}</span> : dash;
      },
    },
    {
      key: "portal", label: "Portal", minW: 60, sort: (r) => (r.activated ? 1 : 0),
      render: (r) => (r.activated ? <span className="text-st-done" title={t("Cont portal activat")}>✓ {t("activ")}</span> : <span className="text-ink-soft/60" title={t("Cont portal neactivat")}>—</span>),
    },
    { key: "invoices", label: "Facturi", minW: 55, right: true, sort: (r) => r.invoiceCount, render: (r) => <span className="text-ink-soft">{r.invoiceCount}</span> },
    {
      key: "notified", label: "Ultima notificare", minW: 110, sort: (r) => r.lastNotifiedAt ?? "",
      render: (r) => (r.lastNotifiedAt
        ? <span className={notifiedRecently(r.lastNotifiedAt) ? "font-medium text-st-done" : "text-ink-soft"} title={new Date(r.lastNotifiedAt).toLocaleString(tag)}>● {agoLabel(r.lastNotifiedAt, t)}</span>
        : dash),
    },
  ];
  // coloane din tabelul 1C (ascunse implicit; dacă eticheta există și printre cele de mai sus, se adaugă „(1C)” ca să se deosebească)
  const mainLabels = new Set(mainCols.map((c) => c.label));
  const oneCCols: Col<PayerRow>[] = ONEC_COLUMNS.map((c, i) => ({
    key: `onec:${c.key}`,
    label: mainLabels.has(c.label) ? `${c.label} (1C)` : c.label,
    minW: Math.min(Math.max(c.w, 80), 180),
    maxW: Math.max(c.w, 160),
    right: c.type === "num",
    defaultHidden: true,
    sort: (r: PayerRow) => {
      const v = ocByClient.get(r.id)?.[HEAD + i];
      if (v == null || v === "") return null;
      return c.type === "num" ? Number(v) : String(v);
    },
    render: (r: PayerRow) => (oc.rows ? fmt1c(c, ocByClient.get(r.id)?.[HEAD + i]) : oc.error ? "!" : "…"),
  }));
  const endCols: Col<PayerRow>[] = [
    ...(canSend
      ? [{
          key: "send", label: "", minW: 36,
          render: (r: PayerRow) => (
            <button
              type="button"
              disabled={flagsOf(r) === 0}
              onClick={() => openForRow(r)}
              title={flagsOf(r) === 0 ? t("Fără email/telefon valid") : t("Trimite doar acestui plătitor")}
              className="tap grid size-4 place-items-center rounded border border-[var(--color-line)] text-[9px] leading-none hover:bg-brand-soft disabled:opacity-30"
            >
              ✉
            </button>
          ),
        }]
      : []),
    ...(canTask
      ? [{
          key: "task", label: "", minW: 56,
          render: (r: PayerRow) => (
            <span className="flex items-center gap-1">
              <Link
                href={taskHref(r)}
                prefetch={false}
                title={t("Creează sarcină pentru acest plătitor (adresa se completează singură)")}
                aria-label={t("Creează sarcină pentru acest plătitor (adresa se completează singură)")}
                className="grid size-4 place-items-center rounded bg-brand text-[11px] font-bold leading-none text-white hover:bg-brand-strong"
              >
                +
              </Link>
              <Link
                href={ticketHref(r)}
                prefetch={false}
                data-new-ticket=""
                title={t("Creează cerere pentru acest plătitor (datele lui se completează singure, și în șabloane)")}
                aria-label={t("Creează cerere pentru acest plătitor (datele lui se completează singure, și în șabloane)")}
                className="grid size-4 place-items-center rounded bg-st-progress text-[10px] font-bold leading-none text-white hover:opacity-80"
              >
                C
              </Link>
            </span>
          ),
        }]
      : []),
  ];
  const columns: Col<PayerRow>[] = [...selCols, ...mainCols, ...oneCCols, ...endCols];


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

      {/* ── Bară compactă: filtre, număr, selecție, acțiuni, mod telefon și rânduri pe pagină — un singur rând (mai mult loc pentru listă) ── */}
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <FiltersToggle open={fOpen} onToggle={toggleF} activeCount={active} />
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
        {canSelect && selCount > 0 && (
          <span className="font-semibold text-brand">
            {t("{n} selectați", { n: nf(selCount) })} {canSend && <span className="font-normal text-ink-soft">· {t("{n} cu email", { n: nf(selEmail) })} · {t("{n} cu telefon", { n: nf(selPhone) })}</span>}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {canSelect && view.total > 0 && (
            <button
              type="button"
              onClick={selectAllMatching}
              disabled={resolving}
              title={view.total > pageRows.length ? t("Selectează toți cei {n} din filtru (toate paginile)", { n: nf(view.total) }) : t("Selectează toți cei {n} din filtru", { n: nf(view.total) })}
              className="tap h-7 cursor-pointer rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[11px] font-medium hover:bg-brand-soft disabled:opacity-60"
            >
              {resolving ? t("Se selectează…") : `☑ ${t("Toți {n}", { n: nf(view.total) })}`}
            </button>
          )}
          {canSelect && selCount > 0 && (
            <button type="button" onClick={() => setSelected(new Map())} className="tap h-7 cursor-pointer rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[11px] hover:bg-[var(--color-surface-2)]">
              ✕ {t("Golește selecția")}
            </button>
          )}
          {canSelect && canDelete && (
            <button
              type="button"
              onClick={() => setDeleting(true)}
              disabled={selCount === 0}
              className="tap h-7 cursor-pointer rounded-lg border border-st-cancelled/40 px-2 text-[11px] font-semibold text-st-cancelled hover:bg-st-cancelled/10 disabled:cursor-default disabled:opacity-40"
              title={t("Șterge plătitorii selectați (doar cei fără facturi etc.)")}
            >
              🗑 {t("Șterge selectați")}{selCount ? ` (${nf(selCount)})` : ""}
            </button>
          )}
          {canSelect && canSend && (
            <button
              type="button"
              onClick={openForSelection}
              disabled={selCount === 0}
              className="tap h-7 cursor-pointer rounded-lg bg-brand px-3 text-[11px] font-semibold text-white hover:bg-brand-strong disabled:cursor-default disabled:opacity-40"
            >
              ✉ {t("Trimite notificare")}{selCount ? ` (${nf(selCount)})` : ""}
            </button>
          )}
          {canSend && (
            <button
              type="button"
              onClick={() => setTplOpen(true)}
              className="tap h-7 cursor-pointer rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[11px] font-medium hover:bg-brand-soft"
              title={t("Creează, editează sau șterge șabloanele de mesaje")}
            >
              📝 {t("Șabloane")}{templates.length ? ` (${templates.length})` : ""}
            </button>
          )}
          {topActions}
        </div>
      </div>

      <div className={`flex-wrap items-center gap-1.5 ${fOpen ? "mb-1.5 flex" : "hidden"}`}>
        <div className={fOpen ? "contents" : "hidden"}>
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
          {monthChoices.map((m) => (
            <option key={m.month} value={m.month}>{t("Factura pe {month}", { month: monthLabel(m.month) })} ({nf(m.count)})</option>
          ))}
        </select>
        <select
          value={filters.noInvoice}
          onChange={(e) => setFilter({ noInvoice: e.target.value as NotifyFilters["noInvoice"], ...(e.target.value && !filters.month && monthChoices[0] ? { month: monthChoices[0].month } : {}) })}
          className={fld(filters.noInvoice)}
          aria-label={t("Factură în luna aleasă")}
          title={t("Alege luna din „Luna facturii” (la „luni la rând”: ultima lună a seriei): arată plătitorii care NU au primit factură")}
        >
          <option value="">{t("Factură în lună: cu factură")}</option>
          <option value="1">{t("Fără factură în luna aleasă")}</option>
          {NO_INVOICE_VALUES.filter((v) => v !== "1").map((v) => <option key={v} value={v}>{t("Fără factură {n} luni la rând", { n: v })}</option>)}
        </select>
        {runList.length > 0 && <span className="text-[11px] text-ink-soft">{t("Luni verificate: {a}", { a: runList.slice().reverse().join(", ") })}</span>}
        <select value={filters.aging} onChange={(e) => setFilter({ aging: e.target.value as NotifyFilters["aging"] })} className={fld(filters.aging)} aria-label={t("Datorie pe vechime")} title={t("Plătitorii cu datorie, după de cât timp sunt datornici (de la prima factură rămasă neachitată)")}>
          <option value="">{t("Datorie pe vechime: toate")}</option>
          {AGING_BUCKETS.map((b) => <option key={b.key} value={b.key}>{t(b.label)}</option>)}
        </select>
        <select value={filters.service} onChange={(e) => setFilter({ service: e.target.value as NotifyFilters["service"] })} className={fld(filters.service)} aria-label={t("Serviciu")}>
          <option value="">{t("Serviciu: toate")}</option>
          <option value="water">{t("Doar apă")}</option>
          <option value="sewer">{t("Doar canalizare")}</option>
          <option value="both">{t("Apă + canalizare")}</option>
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
        <select value={filters.bal} onChange={(e) => setFilter({ bal: e.target.value as NotifyFilters["bal"], ...(e.target.value && !filters.month && months[0] ? { month: months[0].month } : {}) })} className={fld(filters.bal)} aria-label={t("Plăți")} title={t("Plățile deduse din lanțul de facturi, pe factura lunii alese (fără lună: pe ultima factură)")}>
          <option value="">{t("Plăți: toate")}</option>
          <option value="unpaid">{t("Neachitate (trimise / restante)")}</option>
          <option value="settled">{t("Au achitat factura anterioară")}</option>
          <option value="owes">{t("Cu datorie (sold anterior neachitat)")}</option>
          <option value="advance">{t("Cu avans")}</option>
          <option value="paidprev">{t("Cu plată primită înainte de factură")}</option>
          <option value="partial">{t("Parțial achitate")}</option>
        </select>
        <select value={filters.notified} onChange={(e) => setFilter({ notified: e.target.value as NotifyFilters["notified"] })} className={fld(filters.notified)} aria-label={t("Ultima notificare")}>
          <option value="">{t("Notificat: oricând")}</option>
          {NOTIFIED_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
        </select>
        <select value={viaChannel(filters.via)} onChange={(e) => setFilter({ via: composeVia(e.target.value, viaMode(filters.via)) })} className={fld(viaChannel(filters.via))} aria-label={t("Canal notificare")} title={t("Canalul pe care s-a trimis (sau nu) notificarea; se combină cu perioada de mai jos")}>
          <option value="">{t("Canal: email, SMS, apel, PDF")}</option>
          <option value="EMAIL">{t("Email")}</option>
          <option value="SMS">{t("SMS")}</option>
          <option value="CALL">{t("Apel")}</option>
          <option value="PDF">{t("PDF (tipărit)")}</option>
        </select>
        <select value={viaMode(filters.via)} onChange={(e) => setFilter({ via: composeVia(viaChannel(filters.via), e.target.value) })} className={fld(viaMode(filters.via))} aria-label={t("Notificați sau nu")} title={t("Cine a primit notificarea, sau cine NU a primit-o (pe canalul ales, în perioada aleasă)")}>
          <option value="">{t("Notificați / nenotificați")}</option>
          <option value="yes">{t("Notificați")}</option>
          <option value="no">{t("Nenotificați")}</option>
        </select>
        <span className="flex items-center gap-1">
          <DateFilterInput
            label={t("De la")}
            value={filters.notifiedFrom}
            onChange={(e) => setFilter({ notifiedFrom: e.target.value })}
            title={t("Perioadă notificare: de la data")}
            aria-label={t("Perioadă notificare: de la data")}
            className={txtFld(filters.notifiedFrom)}
          />
          <span className="text-ink-soft">–</span>
          <DateFilterInput
            label={t("Până la")}
            value={filters.notifiedTo}
            onChange={(e) => setFilter({ notifiedTo: e.target.value })}
            title={t("Perioadă notificare: până la data")}
            aria-label={t("Perioadă notificare: până la data")}
            className={txtFld(filters.notifiedTo)}
          />
        </span>
        <select value={filters.invoices} onChange={(e) => setFilter({ invoices: e.target.value as NotifyFilters["invoices"] })} className={fld(filters.invoices)} aria-label={t("Facturi")}>
          <option value="">{t("Facturi: toate")}</option>
          <option value="none">{t("Fără nicio factură")}</option>
        </select>
        <select value={filters.lorawan} onChange={(e) => setFilter({ lorawan: e.target.value as NotifyFilters["lorawan"] })} className={fld(filters.lorawan)} aria-label={t("Contor LoRaWAN")}>
          <option value="">{t("Contor: toate")}</option>
          <option value="yes">{t("📡 Cu contor LoRaWAN (automat)")}</option>
          <option value="no">{t("Fără contor LoRaWAN")}</option>
        </select>
        <select value={filters.estimated} onChange={(e) => setFilter({ estimated: e.target.value as NotifyFilters["estimated"] })} className={fld(filters.estimated)} aria-label={t("Citire estimată")}>
          <option value="">{t("Estimare: toate")}</option>
          <option value="yes">{t("Citire estimată (calculată)")}</option>
          <option value="no">{t("Citire reală (nu estimată)")}</option>
        </select>
        <select value={filters.contractExp} onChange={(e) => setFilter({ contractExp: e.target.value as NotifyFilters["contractExp"] })} className={fld(filters.contractExp)} aria-label={t("Contract")}>
          <option value="">{t("Contract: toate")}</option>
          {CONTRACT_EXP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
        </select>
        <select value={filters.metrologyExp} onChange={(e) => setFilter({ metrologyExp: e.target.value as NotifyFilters["metrologyExp"] })} className={fld(filters.metrologyExp)} aria-label={t("Verificare metrologică")}>
          <option value="">{t("Verificare metrologică: toate")}</option>
          {METROLOGY_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
        </select>
        <select value={filters.meterIssues} onChange={(e) => setFilter({ meterIssues: e.target.value as NotifyFilters["meterIssues"] })} className={fld(filters.meterIssues)} aria-label={t("Nereguli contoare")}>
          <option value="">{t("Nereguli contoare: toate")}</option>
          {PAYER_ISSUE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
        </select>
        <select value={filters.kind} onChange={(e) => setFilter({ kind: e.target.value as NotifyFilters["kind"] })} className={fld(filters.kind)} aria-label={t("Tip plătitor")}>
          <option value="">{t("Tip: toți")}</option>
          <option value="person">{t("Casnic")}</option>
          <option value="company">{t("Non casnic")}</option>
        </select>
        <select value={filters.sector} onChange={(e) => setFilter({ sector: e.target.value as NotifyFilters["sector"] })} className={fld(filters.sector)} aria-label={t("Sector")}>
          <option value="">{t("Toate sectoarele")}</option>
          <option value="privat">{t("Sector privat")}</option>
          <option value="comunal">{t("Sector comunal")}</option>
        </select>
        <SectorFilter options={uSectors} value={filters.usector} onChange={(v) => setFilter({ usector: v })} className={(on) => fld(on ? "x" : "")} />
        <SectorFilter kind="locality" options={uLocs} value={filters.uloc} onChange={(v) => setFilter({ uloc: v })} className={(on) => fld(on ? "x" : "")} />
        <select value={filters.account} onChange={(e) => setFilter({ account: e.target.value as NotifyFilters["account"] })} className={fld(filters.account)} aria-label={t("Cont portal")}>
          <option value="">{t("Cont portal: toate")}</option>
          <option value="activated">{t("Activat")}</option>
          <option value="pending">{t("Neactivat")}</option>
        </select>
        <DateFilterInput
          label={t("Instalat")}
          value={filters.installedFrom}
          onChange={(e) => setFilter({ installedFrom: e.target.value })}
          title={t("Contor instalat după data")}
          aria-label={t("Contor instalat după data")}
          className={txtFld(filters.installedFrom)}
        />
        <DateFilterInput
          label={t("Consumator nou")}
          value={filters.newFrom}
          onChange={(e) => setFilter({ newFrom: e.target.value })}
          title={t("Consumatori noi: adăugați în CRM de la data")}
          aria-label={t("Consumatori noi: adăugați în CRM de la data")}
          className={txtFld(filters.newFrom)}
        />
        <DateFilterInput
          label={t("Loc de consum nou")}
          value={filters.placeFrom}
          onChange={(e) => setFilter({ placeFrom: e.target.value })}
          title={t("Locuri de consum noi: începutul consumului de la data")}
          aria-label={t("Locuri de consum noi: începutul consumului de la data")}
          className={txtFld(filters.placeFrom)}
        />
        <select value={filters.sort} onChange={(e) => setFilter({ sort: e.target.value as NotifyFilters["sort"] })} className={fld(filters.sort)} aria-label={t("Sortare")}>
          <option value="">{t("Sortare: nume (A-Z)")}</option>
          <option value="debtDesc">{t("Sold: descrescător")}</option>
          <option value="debtAsc">{t("Sold: crescător")}</option>
          <option value="installDesc">{t("Instalare: recente")}</option>
          <option value="installAsc">{t("Instalare: vechi")}</option>
        </select>
          {browseOnly && canExport && (
            <span className="ml-auto">
              <ExportButton
                entity="payers"
                params={{ ...Object.fromEntries(Object.entries(sanitizeFilters(filters)).filter(([, v]) => v)) }}
                label={t("Export (cu filtrele)")}
                className="tap inline-flex h-6 items-center gap-1 rounded-full border border-[var(--color-line)] px-2.5 text-[11px] hover:border-brand hover:bg-brand-soft"
              />
            </span>
          )}
        </div>
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
      {loading && <div className="mb-2 h-0.5 animate-pulse rounded-full bg-brand opacity-60" />}
      {error && (
        <p className="mb-2 flex items-center justify-between gap-3 rounded-lg bg-st-cancelled/10 px-3 py-2 text-sm text-st-cancelled">
          {error}
          <button type="button" onClick={reload} className="tap shrink-0 font-semibold underline">{t("Reîncearcă")}</button>
        </p>
      )}

      {!localList && view.total > data.items.length && !loading && (
        <p className="mb-1 text-[11px] text-ink-soft">
          {t("Se afișează doar primele {n} rânduri; restul apar când se încarcă lista completă.", { n: nf(data.items.length) })}{" "}
          <button type="button" onClick={reload} className="cursor-pointer font-semibold text-brand underline">{t("Reîncearcă")}</button>
        </p>
      )}
      <DataTable<PayerRow>
        storageKey={browseOnly ? "payers" : "payer-notify"}
        rows={localList ?? data.items}
        columns={columns}
        filters={[]}
        noun={t("plătitori")}
        emptyText={t("Niciun plătitor cu filtrele acestea.")}
        pending={localList ? undefined : { total: view.total }}
        onRowClick={(r) => setDetailRow(r)}
        rowClickSkipsControls
        rowColor={(r) => (selected.has(r.id) ? BRAND.brand : null)}
        cardKeys={["name", "address", "amount"]}
        onVisibleKeys={(keys) => setNeed1c(keys.some((k) => k.startsWith("onec:")))}
      />

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
          canNote={canEditPayer}
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
          // programarea: dacă sunt bifați TOȚI cei din filtru, se salvează filtrele (destinatarii se recalculează la fiecare rulare); altfel lista fixă de acum
          scheduleTarget={{ filters: view.total > 0 && compose.recipients.length === view.total ? sanitizeFilters(filters) : null }}
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


/** Butoanele de paginare cu „…" pentru spații mari (aceeași logică ca în Task-uri). */
