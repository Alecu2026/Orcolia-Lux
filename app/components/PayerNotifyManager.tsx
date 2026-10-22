"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PayerRow } from "@/lib/queries/payers";
import {
  CONTACT_OPTIONS,
  DEFAULT_PER_PAGE,
  EMPTY_FILTERS,
  NOTIFIED_OPTIONS,
  NOTIFY_MAX_RECIPIENTS,
  NOTIFY_PER_PAGE,
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
import PayerNotifyDialog, { type Recipient } from "./PayerNotifyDialog";
import PayerTemplatesDialog from "./PayerTemplatesDialog";
import PayerDetailDialog, { type PayerPatch } from "./PayerDetailDialog";
import PayerBulkDeleteDialog from "./PayerBulkDeleteDialog";
import { usePayerDataset } from "./usePayerDataset";
import ExportButton from "./ExportButton";
import {
  createPayerTemplateAction,
  deletePayerTemplateAction,
  updatePayerTemplateAction,
} from "@/app/actions/payer-templates";
import type { PayerTemplate, PayerTemplateDraft } from "@/lib/payer-notify";

type Page = { items: PayerRow[]; total: number };

const LUNI = ["ianuarie", "februarie", "martie", "aprilie", "mai", "iunie", "iulie", "august", "septembrie", "octombrie", "noiembrie", "decembrie"];
const monthLabel = (m: string) => `${LUNI[Number(m.slice(5, 7)) - 1] ?? m.slice(5, 7)} ${m.slice(0, 4)}`;
const nf = (n: number) => n.toLocaleString("ro-RO");
const money = (n: number) => n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("ro-RO", { timeZone: "Europe/Bucharest", day: "2-digit", month: "2-digit", year: "numeric" });

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
  const canSend = canSendProp && !browseOnly;
  const canSelect = canSend || canDelete;
  const [deleting, setDeleting] = useState(false);
  const BASE_PATH = basePath;
  const STORAGE_KEY = `filters:${basePath}`;

  // ── Stare: filtrele sunt locale (schimbarea lor e instantanee în UI), datele vin de pe server ──
  const [filters, setFilters] = useState<NotifyFilters>(initial.filters);
  const [draft, setDraft] = useState<Record<TextKey, string>>({
    q: initial.filters.q, street: initial.filters.street, minDebt: initial.filters.minDebt, maxDebt: initial.filters.maxDebt,
  });
  const [page, setPage] = useState(initial.page);
  const [perPage, setPerPage] = useState(initial.perPage);
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
    setTemplates((t) => [{ id: tmp, ...d }, ...t]);
    createPayerTemplateAction(d)
      .then((res) => {
        if (res.ok) setTemplates((t) => t.map((x) => (x.id === tmp ? res.template : x)));
        else { setTemplates((t) => t.filter((x) => x.id !== tmp)); toast.error(res.error); }
      })
      .catch(() => { setTemplates((t) => t.filter((x) => x.id !== tmp)); toast.error("Nu am putut salva șablonul."); });
  }

  function updateTemplate(id: string, d: PayerTemplateDraft) {
    const prev = templates.find((x) => x.id === id);
    setTemplates((t) => t.map((x) => (x.id === id ? { id, ...d } : x)));
    const revert = (msg: string) => {
      if (prev) setTemplates((t) => t.map((x) => (x.id === id ? prev : x)));
      toast.error(msg);
    };
    updatePayerTemplateAction(id, d)
      .then((res) => { if (!res.ok) revert(res.error); })
      .catch(() => revert("Nu am putut salva modificarea."));
  }

  function deleteTemplate(id: string) {
    const prevList = templates;
    setTemplates((t) => t.filter((x) => x.id !== id));
    const revert = (msg: string) => { setTemplates(prevList); toast.error(msg); };
    deletePayerTemplateAction(id)
      .then((res) => { if (!res.ok) revert(res.error); })
      .catch(() => revert("Nu am putut șterge șablonul."));
  }

  const [compose, setCompose] = useState<{ recipients: Recipient[]; previewRow: PayerRow | null } | null>(null);
  const sentSomething = useRef(false);

  const key = queryKey(filters, page, perPage);

  // ── Motor local: toți plătitorii în memorie, filtrați/sortați/paginați în JS (instant). Până se încarcă setul
  //    (sau cât timp se încarcă o lună nouă), se folosește interogarea clasică pe server de mai jos. ──
  const ds = usePayerDataset(ready);
  const monthMap = filters.month ? (ds.monthMaps.get(filters.month) ?? null) : null;
  const useLocal = !!ds.rows && (!filters.month || !!monthMap);
  const localList = useMemo(
    () => (useLocal && ds.rows ? filterSnapshot(ds.rows, sanitizeFilters(filters), monthMap) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [useLocal, ds.rows, ds.version, filters, monthMap],
  );
  const view: Page = localList
    ? { items: localList.slice((page - 1) * perPage, page * perPage), total: localList.length }
    : data;
  const totalPages = Math.max(1, Math.ceil(view.total / perPage));
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
    if (urlEmpty) {
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

  // Salvează filtrele + sincronizează URL-ul (link de partajat), fără navigare.
  useEffect(() => {
    if (!ready) return;
    const f = sanitizeFilters(filters);
    const empty = countActiveFilters(f) === 0 && !f.sort;
    try {
      if (empty && perPage === DEFAULT_PER_PAGE) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify({ f, perPage }));
    } catch {}
    const usp = filtersToParams(f);
    if (page > 1) usp.set("page", String(page));
    if (perPage !== DEFAULT_PER_PAGE) usp.set("perPage", String(perPage));
    const qs = usp.toString();
    window.history.replaceState(null, "", `${BASE_PATH}${qs ? `?${qs}` : ""}`);
  }, [filters, page, perPage, ready, BASE_PATH, STORAGE_KEY]);

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
    setLoading(true);
    setError(null);
    fetch(`/api/platitori/notificari?${key}`, { signal: ctl.signal })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Eroare la încărcare.");
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
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready, reloadTick, useLocal]);

  const refreshDataset = ds.refresh;
  const reload = useCallback(() => {
    void refreshDataset();
    cache.current.clear();
    forceReload.current = true;
    setReloadTick((t) => t + 1);
  }, [refreshDataset]);

  function setFilter(patch: Partial<NotifyFilters>) {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  }

  function onText(k: TextKey, value: string) {
    setDraft((d) => ({ ...d, [k]: value }));
    clearTimeout(debounce.current[k]);
    debounce.current[k] = setTimeout(() => setFilter({ [k]: value.trim() } as Partial<NotifyFilters>), 350);
  }

  function clearAll() {
    Object.values(debounce.current).forEach((t) => clearTimeout(t));
    setFilters(EMPTY_FILTERS);
    setDraft({ q: "", street: "", minDebt: "", maxDebt: "" });
    setPage(1);
  }

  // Filtrele „active" iau în calcul și ce e tastat dar încă neaplicat (debounce) — culoarea reacționează imediat.
  const active = countActiveFilters({ ...filters, q: draft.q, street: draft.street, minDebt: draft.minDebt, maxDebt: draft.maxDebt });

  // ── Selecție ──
  const pageRows = view.items;
  const allOnPage = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));
  const someOnPage = pageRows.some((r) => selected.has(r.id));
  const headerCheck = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerCheck.current) headerCheck.current.indeterminate = someOnPage && !allOnPage;
  }, [someOnPage, allOnPage]);

  function toggleRow(i: number, shift: boolean) {
    const row = pageRows[i];
    if (!row) return;
    setSelected((prev) => {
      const next = new Map(prev);
      const on = !prev.has(row.id);
      const from = shift && lastClicked.current !== null ? Math.min(lastClicked.current, i) : i;
      const to = shift && lastClicked.current !== null ? Math.max(lastClicked.current, i) : i;
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
          ? `Am selectat primii ${nf(capped.length)} din ${nf(localList.length)} (limita unei trimiteri).`
          : `${nf(capped.length)} plătitori selectați.`,
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
          ? `Am selectat primii ${nf(res.contacts.length)} din ${nf(res.total)} (limita unei trimiteri).`
          : `${nf(res.contacts.length)} plătitori selectați.`,
      );
    } catch {
      if (token === resolveToken.current) toast.error("Nu am putut selecta lista. Încearcă din nou.");
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
    [patchRow],
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
  const from = view.total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, view.total);
  const colCount = 12 + (canSelect ? 1 : 0) + (canSend ? 1 : 0);

  return (
    <div>
      {!browseOnly && !emailEnabled && !smsEnabled && (
        <div className="mb-3 rounded-xl border border-st-progress/30 bg-st-progress/10 px-4 py-3 text-sm text-st-progress">
          Niciun canal de trimitere nu este configurat. Setează <b>SMTP_*</b> pentru email și <b>TWILIO_*</b> sau <b>SMS_HTTP_URL</b> pentru SMS (vezi .env.example).
        </div>
      )}
      {!browseOnly && (emailEnabled !== smsEnabled) && (
        <p className="mb-3 text-xs text-ink-soft">
          {emailEnabled ? "SMS-ul nu este configurat — poți trimite doar email." : "Emailul nu este configurat — poți trimite doar SMS."}
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
          <span><b>{nf(nameFixCount)} nume</b> conțin un caracter „?” — litere românești (Ș/Ț) pe care exportul original nu le putea reprezenta.</span>
          <span className="shrink-0 font-medium underline">{filters.nameFix ? "Arată pe toți" : "Arată-le"}</span>
        </button>
      )}

      {/* ── Filtre (stil Task-uri: colorate când sunt active) ─────────────────── */}
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <input
          value={draft.q}
          onChange={(e) => onText("q", e.target.value)}
          placeholder="Caută nume, cont, contract, email, telefon…"
          className={`${txtFld(draft.q)} min-w-48 flex-1`}
          aria-label="Căutare"
        />
        <input
          value={draft.street}
          onChange={(e) => onText("street", e.target.value)}
          placeholder="Stradă / adresă…"
          className={`${txtFld(draft.street)} w-44`}
          aria-label="Adresă"
        />
        <select value={filters.month} onChange={(e) => setFilter({ month: e.target.value })} className={fld(filters.month)} aria-label="Luna facturii">
          <option value="">Luna facturii: ultima</option>
          {months.map((m) => (
            <option key={m.month} value={m.month}>Factura pe {monthLabel(m.month)} ({nf(m.count)})</option>
          ))}
        </select>
        <select value={filters.contact} onChange={(e) => setFilter({ contact: e.target.value as NotifyFilters["contact"] })} className={fld(filters.contact)} aria-label="Date de contact">
          <option value="">Contact: toți</option>
          {CONTACT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filters.debt} onChange={(e) => setFilter({ debt: e.target.value as NotifyFilters["debt"] })} className={fld(filters.debt)} aria-label="Datorie">
          <option value="">Sold: toate</option>
          <option value="has">Cu datorie</option>
          <option value="none">Fără datorie</option>
        </select>
        <input
          value={draft.minDebt}
          onChange={(e) => onText("minDebt", e.target.value)}
          inputMode="decimal"
          placeholder="Sold de la"
          className={`${txtFld(draft.minDebt)} w-24`}
          aria-label="Sold minim"
        />
        <input
          value={draft.maxDebt}
          onChange={(e) => onText("maxDebt", e.target.value)}
          inputMode="decimal"
          placeholder="până la"
          className={`${txtFld(draft.maxDebt)} w-24`}
          aria-label="Sold maxim"
        />
        <select value={filters.invoiceStatus} onChange={(e) => setFilter({ invoiceStatus: e.target.value })} className={fld(filters.invoiceStatus)} aria-label="Status factură">
          <option value="">Status factură</option>
          {INVOICE_STATUS_LIST.map((s) => <option key={s} value={s}>{INVOICE_STATUS[s].label}</option>)}
        </select>
        <select value={filters.notified} onChange={(e) => setFilter({ notified: e.target.value as NotifyFilters["notified"] })} className={fld(filters.notified)} aria-label="Ultima notificare">
          <option value="">Notificat: oricând</option>
          {NOTIFIED_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filters.invoices} onChange={(e) => setFilter({ invoices: e.target.value as NotifyFilters["invoices"] })} className={fld(filters.invoices)} aria-label="Facturi">
          <option value="">Facturi: toate</option>
          <option value="none">Fără nicio factură</option>
        </select>
        <select value={filters.kind} onChange={(e) => setFilter({ kind: e.target.value as NotifyFilters["kind"] })} className={fld(filters.kind)} aria-label="Tip plătitor">
          <option value="">Tip: toți</option>
          <option value="person">Persoane fizice</option>
          <option value="company">Firme / instituții</option>
        </select>
        <select value={filters.sector} onChange={(e) => setFilter({ sector: e.target.value as NotifyFilters["sector"] })} className={fld(filters.sector)} aria-label="Sector">
          <option value="">Toate sectoarele</option>
          <option value="privat">Sector privat</option>
          <option value="comunal">Sector comunal</option>
        </select>
        <select value={filters.account} onChange={(e) => setFilter({ account: e.target.value as NotifyFilters["account"] })} className={fld(filters.account)} aria-label="Cont portal">
          <option value="">Cont portal: toate</option>
          <option value="activated">Activat</option>
          <option value="pending">Neactivat</option>
        </select>
        <input
          type="date"
          value={filters.installedFrom}
          onChange={(e) => setFilter({ installedFrom: e.target.value })}
          title="Contor instalat după data"
          aria-label="Contor instalat după data"
          className={txtFld(filters.installedFrom)}
        />
        <select value={filters.sort} onChange={(e) => setFilter({ sort: e.target.value as NotifyFilters["sort"] })} className={fld(filters.sort)} aria-label="Sortare">
          <option value="">Sortare: nume (A-Z)</option>
          <option value="debtDesc">Sold: descrescător</option>
          <option value="debtAsc">Sold: crescător</option>
          <option value="installDesc">Instalare: recente</option>
          <option value="installAsc">Instalare: vechi</option>
        </select>
        {(active > 0 || filters.sort) && (
          <button
            type="button"
            onClick={clearAll}
            className="tap h-7 rounded-lg border border-[var(--color-line)] px-2 text-[11px] text-ink-soft hover:bg-[var(--color-surface-2)]"
          >
            Resetează filtrele{active > 0 ? ` (${active})` : ""}
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
              label="Export (cu filtrele)"
              className="tap inline-flex h-6 items-center gap-1 rounded-full border border-[var(--color-line)] px-2.5 text-[11px] hover:border-brand hover:bg-brand-soft"
            />
          </span>
        )}
        {canSend && (
          <button
            type="button"
            onClick={() => setTplOpen(true)}
            className="tap ml-auto h-6 rounded-full border border-[var(--color-line)] px-3 hover:border-brand hover:bg-brand-soft"
            title="Creează, editează sau șterge șabloanele de mesaje"
          >
            📝 Șabloane{templates.length ? ` (${templates.length})` : ""}
          </button>
        )}
      </div>

      {/* ── Bară de selecție / acțiuni ─────────────────────────────────────── */}
      {canSelect && (
        <div className={`mb-2 flex flex-wrap items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs ${selCount ? "border-brand bg-brand/10" : "border-[var(--color-line)] bg-[var(--color-surface-2)]"}`}>
          {selCount > 0 ? (
            <span className="font-semibold text-brand">
              {nf(selCount)} selectați {canSend && <span className="font-normal text-ink-soft">· {nf(selEmail)} cu email · {nf(selPhone)} cu telefon</span>}
            </span>
          ) : (
            <span className="text-ink-soft">Bifează plătitorii (Shift = interval) sau selectează-i pe toți din filtru. Click pe un rând = datele lui.</span>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {view.total > 0 && (
              <button
                type="button"
                onClick={selectAllMatching}
                disabled={resolving}
                className="tap h-7 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[11px] font-medium hover:bg-brand-soft disabled:opacity-60"
              >
                {resolving ? "Se selectează…" : (view.total > pageRows.length ? `Selectează toți cei ${nf(view.total)} din filtru (toate paginile)` : `Selectează toți cei ${nf(view.total)} din filtru`)}
              </button>
            )}
            {selCount > 0 && (
              <button type="button" onClick={() => setSelected(new Map())} className="tap h-7 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[11px] hover:bg-[var(--color-surface-2)]">
                Golește selecția
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={() => setDeleting(true)}
                disabled={selCount === 0}
                className="tap h-7 rounded-lg border border-st-cancelled/40 px-3 text-[11px] font-semibold text-st-cancelled hover:bg-st-cancelled/10 disabled:opacity-40"
                title="Șterge plătitorii selectați (doar cei fără facturi etc.)"
              >
                🗑 Șterge selectați{selCount ? ` (${nf(selCount)})` : ""}
              </button>
            )}
            {canSend && (
              <button
                type="button"
                onClick={openForSelection}
                disabled={selCount === 0}
                className="tap h-7 rounded-lg bg-brand px-3 text-[11px] font-semibold text-white hover:bg-brand-strong disabled:opacity-40"
              >
                ✉ Trimite notificare{selCount ? ` (${nf(selCount)})` : ""}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Sumar + rânduri pe pagină ─────────────────────────────────────── */}
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
        <span><b>{nf(view.total)}</b> plătitori{active > 0 ? " (filtrat)" : ""}</span>
        {view.total > 0 && <span className="text-ink-soft">afișați {nf(from)}–{nf(to)} din {nf(view.total)}{totalPages > 1 ? ` · pagina ${page}/${totalPages}` : ""}</span>}
        {loading && <span className="text-ink-soft">se încarcă…</span>}
        {ds.rows ? (
          <button
            type="button"
            onClick={() => void ds.refresh()}
            disabled={ds.loading}
            title="Lista e ținută în memorie și filtrată instant în browser. Apasă ca să o reîncarci de pe server."
            className="tap cursor-pointer text-ink-soft hover:text-brand disabled:cursor-default"
          >
            ⚡ local{ds.loading ? " · se reîmprospătează…" : ds.loadedAt ? ` · ${agoLabel(new Date(ds.loadedAt).toISOString())}` : ""} ↻
          </button>
        ) : ds.loading ? (
          <span className="text-ink-soft">se încarcă lista completă…</span>
        ) : null}
        <button
          type="button"
          onClick={toggleCards}
          aria-pressed={cards}
          title={cards ? "Înapoi la tabel" : "Afișează fiecare plătitor ca un card, cu câmpurile unul sub altul (potrivit pentru telefon)"}
          className={`tap ml-auto h-7 cursor-pointer rounded-lg border px-2 text-[11px] ${cards ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink-soft hover:bg-[var(--color-surface-2)]"}`}
        >
          {cards ? "▦ Tabel" : "📱 Mod telefon"}
        </button>
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
      {loading && <div className="mb-2 h-0.5 animate-pulse rounded-full bg-brand opacity-60" />}
      {error && (
        <p className="mb-2 flex items-center justify-between gap-3 rounded-lg bg-st-cancelled/10 px-3 py-2 text-sm text-st-cancelled">
          {error}
          <button type="button" onClick={reload} className="tap shrink-0 font-semibold underline">Reîncearcă</button>
        </p>
      )}

      {/* ── Tabel (stil 1C) ───────────────────────────────────────────────── */}
      {cards ? (
        <div className={`flex flex-col gap-2 transition-opacity duration-150 ${loading ? "opacity-60" : ""}`}>
          {pageRows.map((r, i) => {
            const sel = selected.has(r.id);
            const st = r.latestInvoice ? INVOICE_STATUS[r.latestInvoice.status as InvoiceStatusKey] : null;
            const flags = flagsOf(r);
            const recent = notifiedRecently(r.lastNotifiedAt);
            return (
              <div
                key={r.id}
                onClick={() => setDetailRow(r)}
                className={`card cursor-pointer overflow-hidden ${sel ? "border-brand bg-brand-soft/40" : ""}`}
              >
                <div className="flex items-start gap-2 border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2">
                  {canSelect && (
                    <input
                      type="checkbox"
                      checked={sel}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleRow(i, false)}
                      className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--color-brand)]"
                      aria-label={`Selectează ${r.name}`}
                    />
                  )}
                  <div className="min-w-0 flex-1 break-words text-[14px] font-semibold leading-snug">{r.name}</div>
                  {canSend && (
                    <button
                      type="button"
                      disabled={flags === 0}
                      onClick={(e) => { e.stopPropagation(); openForRow(r); }}
                      title={flags === 0 ? "Fără email/telefon valid" : "Trimite doar acestui plătitor"}
                      className="tap grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg border border-[var(--color-line)] text-sm hover:bg-brand-soft disabled:cursor-default disabled:opacity-30"
                    >
                      ✉
                    </button>
                  )}
                </div>
                <dl className="divide-y divide-[var(--color-line)] text-[13px] leading-snug">
                  <CardRow label="Cont / contract">{r.meterSeries ?? r.contract ?? "—"}</CardRow>
                  <CardRow label="Adresă">{r.consumAddress ?? <Dash />}</CardRow>
                  <CardRow label="Email">
                    {r.email ? <span className={flags & 1 ? "" : "text-st-progress"} title={flags & 1 ? undefined : "Adresă invalidă"}>{r.email}</span> : <Dash />}
                  </CardRow>
                  <CardRow label="Telefon">
                    {r.phone ? <span className={`tabular-nums ${flags & 2 ? "" : "text-st-progress"}`} title={flags & 2 ? undefined : "Număr invalid pentru SMS"}>{r.phone}</span> : <Dash />}
                  </CardRow>
                  <CardRow label="Factură">{r.latestInvoice?.number ?? <Dash />}</CardRow>
                  <CardRow label="Scadență">{r.latestInvoice?.dueDate ? fmtDay(r.latestInvoice.dueDate) : <Dash />}</CardRow>
                  <CardRow label="De achitat">
                    {r.latestInvoice ? <span className={`tabular-nums ${r.latestInvoice.grandTotal > 0 ? "font-semibold" : "text-ink-soft"}`}>{money(r.latestInvoice.grandTotal)}</span> : <Dash />}
                  </CardRow>
                  <CardRow label="Status">
                    {st ? <span className={`inline-block rounded-full px-2 text-[11px] font-medium ${st.cls}`}>{st.label}</span> : <Dash />}
                  </CardRow>
                  <CardRow label="Portal">{r.activated ? <span className="text-st-done">✓ activ</span> : <span className="text-ink-soft/60">—</span>}</CardRow>
                  <CardRow label="Facturi">{r.invoiceCount}</CardRow>
                  <CardRow label="Ultima notificare">
                    {r.lastNotifiedAt ? <span className={recent ? "font-medium text-st-done" : "text-ink-soft"}>● {agoLabel(r.lastNotifiedAt)}</span> : <Dash />}
                  </CardRow>
                </dl>
              </div>
            );
          })}
          {pageRows.length === 0 && !loading && (
            <div className="card p-8 text-center text-ink-soft">
              Niciun plătitor cu filtrele acestea.{" "}
              {active > 0 && <button type="button" onClick={clearAll} className="font-semibold text-brand underline">Resetează filtrele</button>}
            </div>
          )}
        </div>
      ) : (
      <div className={`card overflow-auto transition-opacity duration-150 ${loading ? "opacity-60" : ""}`} style={{ maxHeight: perPage > 50 ? "max(78vh, 890px)" : undefined }}>
        <table className="w-max min-w-full border-separate border-spacing-0 text-[11px] leading-[14px]">
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
                    aria-label="Selectează pagina"
                  />
                </th>
              )}
              <Th sticky={canSelect ? "left-7" : "left-0"} minW={190}>
                <button type="button" onClick={() => setFilter({ sort: "" })} className="font-semibold hover:text-brand">Plătitor</button>
              </Th>
              <Th minW={95}>Cont / contract</Th>
              <Th minW={160}>Adresă</Th>
              <Th minW={160}>Email</Th>
              <Th minW={95}>Telefon</Th>
              <Th minW={80}>Factură</Th>
              <Th minW={70}>Scadență</Th>
              <Th minW={80} right>
                <button type="button" onClick={() => sortToggle("debtDesc", "debtAsc")} className="inline-flex items-center gap-1 font-semibold hover:text-brand">
                  De achitat <span className="text-[10px] text-ink-soft">{arrow("debtDesc", "debtAsc")}</span>
                </button>
              </Th>
              <Th minW={65}>Status</Th>
              <Th minW={50}>Portal</Th>
              <Th minW={45} right>Facturi</Th>
              <Th minW={95}>Ultima notificare</Th>
              {canSend && <Th minW={32}> </Th>}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, i) => {
              const sel = selected.has(r.id);
              const st = r.latestInvoice ? INVOICE_STATUS[r.latestInvoice.status as InvoiceStatusKey] : null;
              const flags = flagsOf(r);
              const recent = notifiedRecently(r.lastNotifiedAt);
              const bg = sel ? "bg-brand-soft" : "bg-[var(--color-surface)]";
              return (
                <tr
                  key={r.id}
                  onClick={() => setDetailRow(r)}
                  className={`cursor-pointer ${sel ? "bg-brand-soft/60" : "hover:bg-brand-soft/30"}`}
                >
                  {canSelect && (
                    <td
                      className={`sticky left-0 z-10 cursor-pointer border-b border-[var(--color-line)] px-1.5 py-px ${bg}`}
                      onClick={(e) => { e.stopPropagation(); toggleRow(i, e.shiftKey); }}
                      onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
                      title="Bifează (Shift = interval)"
                    >
                      <input type="checkbox" checked={sel} readOnly tabIndex={-1} className="pointer-events-none block size-3 accent-[var(--color-brand)]" aria-label={`Selectează ${r.name}`} />
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
                      <div className={`truncate ${flags & 1 ? "" : "text-st-progress"}`} title={flags & 1 ? r.email : `Adresă invalidă: ${r.email}`}>{r.email}</div>
                    ) : <Dash />}
                  </td>
                  <td className="border-b border-[var(--color-line)] px-1.5 py-px tabular-nums">
                    {r.phone ? (
                      <span className={flags & 2 ? "" : "text-st-progress"} title={flags & 2 ? undefined : "Număr invalid pentru SMS"}>{r.phone}</span>
                    ) : <Dash />}
                  </td>
                  <td className="border-b border-[var(--color-line)] px-1.5 py-px">{r.latestInvoice?.number ?? <Dash />}</td>
                  <td className="border-b border-[var(--color-line)] px-1.5 py-px">{r.latestInvoice?.dueDate ? fmtDay(r.latestInvoice.dueDate) : <Dash />}</td>
                  <td className={`border-b border-[var(--color-line)] px-1.5 py-px text-right tabular-nums ${r.latestInvoice && r.latestInvoice.grandTotal > 0 ? "font-semibold" : "text-ink-soft"}`}>
                    {r.latestInvoice ? money(r.latestInvoice.grandTotal) : <Dash />}
                  </td>
                  <td className="border-b border-[var(--color-line)] px-1.5 py-px">
                    {st ? <span className={`inline-block rounded-full px-1.5 text-[10px] leading-[14px] font-medium ${st.cls}`}>{st.label}</span> : <Dash />}
                  </td>
                  <td className="border-b border-[var(--color-line)] px-1.5 py-px" title={r.activated ? "Cont portal activat" : "Cont portal neactivat"}>
                    {r.activated ? <span className="text-st-done">✓ activ</span> : <span className="text-ink-soft/60">—</span>}
                  </td>
                  <td className="border-b border-[var(--color-line)] px-1.5 py-px text-right tabular-nums text-ink-soft">{r.invoiceCount}</td>
                  <td className="border-b border-[var(--color-line)] px-1.5 py-px whitespace-nowrap" title={r.lastNotifiedAt ? new Date(r.lastNotifiedAt).toLocaleString("ro-RO") : "Niciodată notificat"}>
                    {r.lastNotifiedAt ? (
                      <span className={recent ? "font-medium text-st-done" : "text-ink-soft"}>● {agoLabel(r.lastNotifiedAt)}</span>
                    ) : <Dash />}
                  </td>
                  {canSend && (
                    <td className="border-b border-[var(--color-line)] px-1.5 py-px">
                      <button
                        type="button"
                        disabled={flags === 0}
                        onClick={(e) => { e.stopPropagation(); openForRow(r); }}
                        title={flags === 0 ? "Fără email/telefon valid" : "Trimite doar acestui plătitor"}
                        className="tap grid size-4 place-items-center rounded border text-[9px] leading-none border-[var(--color-line)] hover:bg-brand-soft disabled:opacity-30"
                      >
                        ✉
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
            {pageRows.length === 0 && !loading && (
              <tr>
                <td colSpan={colCount} className="p-8 text-center text-ink-soft">
                  Niciun plătitor cu filtrele acestea.{" "}
                  {active > 0 && <button type="button" onClick={clearAll} className="font-semibold text-brand underline">Resetează filtrele</button>}
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
            aria-label="Pagina anterioară"
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
            aria-label="Pagina următoare"
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
          previewName={compose.previewRow?.name ?? "Ion Popescu (exemplu)"}
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

/** Un câmp al cardului din modul telefon: eticheta mică deasupra/în stânga, valoarea lizibilă, cu rânduri multiple dacă e lungă. */
function CardRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(5.5rem,34%)_1fr] items-start gap-x-3 px-3 py-1.5">
      <dt className="pt-px text-[10px] font-semibold uppercase tracking-wide text-ink-soft">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
