"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PayerRow } from "@/lib/queries/payers";
import {
  CONTACT_OPTIONS,
  DEFAULT_PER_PAGE,
  EMPTY_FILTERS,
  NOTIFIED_OPTIONS,
  NOTIFY_PER_PAGE,
  agoLabel,
  buildVars,
  countActiveFilters,
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

type Page = { items: PayerRow[]; total: number };

const BASE_PATH = "/notificari-platitori";
const STORAGE_KEY = `filters:${BASE_PATH}`;
const LUNI = ["ianuarie", "februarie", "martie", "aprilie", "mai", "iunie", "iulie", "august", "septembrie", "octombrie", "noiembrie", "decembrie"];
const monthLabel = (m: string) => `${LUNI[Number(m.slice(5, 7)) - 1] ?? m.slice(5, 7)} ${m.slice(0, 4)}`;
const nf = (n: number) => n.toLocaleString("ro-RO");
const money = (n: number) => n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("ro-RO", { timeZone: "Europe/Bucharest", day: "2-digit", month: "2-digit", year: "numeric" });

// Aceleași clase ca filtrele din Task-uri: câmpul cu valoare aleasă capătă fundal/chenar colorat.
const fld = (val: string) =>
  `h-9 min-w-0 max-w-full appearance-none sel-arrow rounded-lg border pl-2 pr-7 text-xs outline-none focus:border-brand ${
    val ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink"
  }`;
const txtFld = (val: string) =>
  `h-9 min-w-0 rounded-lg border px-3 text-xs outline-none focus:border-brand ${
    val ? "border-brand bg-brand/10 font-semibold text-brand placeholder:font-normal" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink"
  }`;

const flagsOf = (r: PayerRow) => (isEmail(r.email) ? 1 : 0) | (normalizePhone(r.phone) ? 2 : 0);

function rowVars(r: PayerRow): NotifyVars {
  return buildVars({
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
  canSend,
  emailEnabled,
  smsEnabled,
  userEmail,
}: {
  initial: { filters: NotifyFilters; page: number; perPage: number; items: PayerRow[]; total: number };
  months: { month: string; count: number }[];
  canSend: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
  userEmail: string;
}) {
  const toast = useToast();

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
  const freshKey = useRef(initialKey);
  const forceReload = useRef(false);
  const [reloadTick, setReloadTick] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const debounce = useRef<Partial<Record<TextKey, ReturnType<typeof setTimeout>>>>({});

  // ── Selecție (id → steaguri contact); persistă între pagini și filtre ──
  const [selected, setSelected] = useState<Map<string, number>>(new Map());
  const [resolving, setResolving] = useState(false);
  const resolveToken = useRef(0);
  const lastClicked = useRef<number | null>(null);
  const [compose, setCompose] = useState<{ recipients: Recipient[]; previewRow: PayerRow | null } | null>(null);
  const sentSomething = useRef(false);

  const totalPages = Math.max(1, Math.ceil(data.total / perPage));
  const key = queryKey(filters, page, perPage);

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
  }, [filters, page, perPage, ready]);

  // Încărcarea datelor: răspuns instant din cache (dacă am mai văzut pagina), apoi reîmprospătare de pe server;
  // o cerere nouă anulează pe cea veche, deci filtrarea rapidă nu se „îneacă" în răspunsuri vechi.
  useEffect(() => {
    if (!ready) return;
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
  }, [key, ready, reloadTick]);

  const reload = useCallback(() => {
    cache.current.clear();
    forceReload.current = true;
    setReloadTick((t) => t + 1);
  }, []);

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

  function applyPreset(patch: Partial<NotifyFilters>) {
    Object.values(debounce.current).forEach((t) => clearTimeout(t));
    const f = { ...EMPTY_FILTERS, ...patch };
    setFilters(f);
    setDraft({ q: f.q, street: f.street, minDebt: f.minDebt, maxDebt: f.maxDebt });
    setPage(1);
  }

  // Filtrele „active" iau în calcul și ce e tastat dar încă neaplicat (debounce) — culoarea reacționează imediat.
  const active = countActiveFilters({ ...filters, q: draft.q, street: draft.street, minDebt: draft.minDebt, maxDebt: draft.maxDebt });

  // ── Selecție ──
  const pageRows = data.items;
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

  // Actualizare optimistă: imediat ce un lot a plecat, „Ultima notificare" se vede în tabel, fără reîncărcare.
  const onSent = useCallback((results: RecipientResult[]) => {
    const sent = new Set(results.filter((r) => r.email.status === "sent" || r.sms.status === "sent").map((r) => r.id));
    if (sent.size === 0) return;
    sentSomething.current = true;
    const now = new Date().toISOString();
    setData((d) => ({ ...d, items: d.items.map((r) => (sent.has(r.id) ? { ...r, lastNotifiedAt: now } : r)) }));
  }, []);

  function closeCompose() {
    setCompose(null);
    if (sentSomething.current) {
      sentSomething.current = false;
      reload(); // filtrul „notificat" / sortarea se pot schimba după trimitere
    }
  }

  const sortToggle = (up: NotifyFilters["sort"], down: NotifyFilters["sort"]) =>
    setFilter({ sort: filters.sort === up ? down : filters.sort === down ? "" : up });
  const arrow = (up: NotifyFilters["sort"], down: NotifyFilters["sort"]) =>
    filters.sort === up ? "▲" : filters.sort === down ? "▼" : "↕";

  const pageButtons = buildPageButtons(page, totalPages);
  const from = data.total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, data.total);
  const colCount = canSend ? 12 : 10;

  return (
    <div>
      {!emailEnabled && !smsEnabled && (
        <div className="mb-3 rounded-xl border border-st-progress/30 bg-st-progress/10 px-4 py-3 text-sm text-st-progress">
          Niciun canal de trimitere nu este configurat. Setează <b>SMTP_*</b> pentru email și <b>TWILIO_*</b> sau <b>SMS_HTTP_URL</b> pentru SMS (vezi .env.example).
        </div>
      )}
      {(emailEnabled !== smsEnabled) && (
        <p className="mb-3 text-xs text-ink-soft">
          {emailEnabled ? "SMS-ul nu este configurat — poți trimite doar email." : "Emailul nu este configurat — poți trimite doar SMS."}
        </p>
      )}

      {/* ── Filtre (stil Task-uri: colorate când sunt active) ─────────────────── */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
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
            className="tap h-9 rounded-lg border border-[var(--color-line)] px-3 text-xs text-ink-soft hover:bg-[var(--color-surface-2)]"
          >
            Resetează filtrele{active > 0 ? ` (${active})` : ""}
          </button>
        )}
      </div>

      {/* Filtre rapide */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-semibold text-ink-soft">Rapid:</span>
        <button type="button" onClick={() => applyPreset({ debt: "has", contact: "any", notified: "not7d", sort: "debtDesc" })} className="tap h-7 rounded-full border border-[var(--color-line)] px-3 hover:border-brand hover:bg-brand-soft">
          Datornici de contactat
        </button>
        <button type="button" onClick={() => applyPreset({ notified: "never", contact: "any" })} className="tap h-7 rounded-full border border-[var(--color-line)] px-3 hover:border-brand hover:bg-brand-soft">
          Niciodată notificați
        </button>
        <button type="button" onClick={() => applyPreset({ contact: "none" })} className="tap h-7 rounded-full border border-[var(--color-line)] px-3 hover:border-brand hover:bg-brand-soft">
          Fără contact (de completat)
        </button>
      </div>

      {/* ── Bară de selecție / acțiuni ─────────────────────────────────────── */}
      {canSend && (
        <div className={`mb-3 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm ${selCount ? "border-brand bg-brand/10" : "border-[var(--color-line)] bg-[var(--color-surface-2)]"}`}>
          {selCount > 0 ? (
            <span className="font-semibold text-brand">
              {nf(selCount)} selectați <span className="font-normal text-ink-soft">· {nf(selEmail)} cu email · {nf(selPhone)} cu telefon</span>
            </span>
          ) : (
            <span className="text-ink-soft">Bifează plătitorii (Shift = interval) sau selectează-i pe toți din filtru.</span>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {data.total > 0 && (
              <button
                type="button"
                onClick={selectAllMatching}
                disabled={resolving}
                className="tap h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-xs font-medium hover:bg-brand-soft disabled:opacity-60"
              >
                {resolving ? "Se selectează…" : `Selectează toți cei ${nf(data.total)} din filtru`}
              </button>
            )}
            {selCount > 0 && (
              <button type="button" onClick={() => setSelected(new Map())} className="tap h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-xs hover:bg-[var(--color-surface-2)]">
                Golește selecția
              </button>
            )}
            <button
              type="button"
              onClick={openForSelection}
              disabled={selCount === 0}
              className="tap h-9 rounded-lg bg-brand px-4 text-xs font-semibold text-white hover:bg-brand-strong disabled:opacity-40"
            >
              ✉ Trimite notificare{selCount ? ` (${nf(selCount)})` : ""}
            </button>
          </div>
        </div>
      )}

      {/* ── Sumar + rânduri pe pagină ─────────────────────────────────────── */}
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span><b>{nf(data.total)}</b> plătitori{active > 0 ? " (filtrat)" : ""}</span>
        {data.total > 0 && <span className="text-ink-soft">{nf(from)}–{nf(to)}</span>}
        {loading && <span className="text-ink-soft">se încarcă…</span>}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-ink-soft">
          Afișează
          <select
            value={perPage}
            onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}
            className={fld(perPage === DEFAULT_PER_PAGE ? "" : "x")}
            aria-label="Rânduri pe pagină"
          >
            {NOTIFY_PER_PAGE.map((n) => <option key={n} value={n}>{n} / pagină</option>)}
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
      <div className={`card overflow-auto transition-opacity duration-150 ${loading ? "opacity-60" : ""}`} style={{ maxHeight: "68vh" }}>
        <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
          <thead className="sticky top-0 z-20 bg-[var(--color-surface-2)]">
            <tr>
              {canSend && (
                <th className="sticky left-0 z-30 w-10 border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-2">
                  <input
                    ref={headerCheck}
                    type="checkbox"
                    checked={allOnPage}
                    onChange={togglePage}
                    className="size-4 accent-[var(--color-brand)]"
                    aria-label="Selectează pagina"
                  />
                </th>
              )}
              <Th sticky={canSend ? "left-10" : "left-0"} minW={230}>
                <button type="button" onClick={() => setFilter({ sort: "" })} className="font-semibold hover:text-brand">Plătitor</button>
              </Th>
              <Th minW={120}>Cont / contract</Th>
              <Th minW={200}>Adresă</Th>
              <Th minW={190}>Email</Th>
              <Th minW={120}>Telefon</Th>
              <Th minW={100}>Factură</Th>
              <Th minW={90}>Scadență</Th>
              <Th minW={110} right>
                <button type="button" onClick={() => sortToggle("debtDesc", "debtAsc")} className="inline-flex items-center gap-1 font-semibold hover:text-brand">
                  De achitat <span className="text-[10px] text-ink-soft">{arrow("debtDesc", "debtAsc")}</span>
                </button>
              </Th>
              <Th minW={90}>Status</Th>
              <Th minW={120}>Ultima notificare</Th>
              {canSend && <Th minW={60}> </Th>}
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
                  onClick={canSend ? (e) => toggleRow(i, e.shiftKey) : undefined}
                  onMouseDown={canSend ? (e) => { if (e.shiftKey) e.preventDefault(); } : undefined}
                  className={`${canSend ? "cursor-pointer" : ""} ${sel ? "bg-brand-soft/60" : "hover:bg-brand-soft/30"}`}
                >
                  {canSend && (
                    <td className={`sticky left-0 z-10 border-b border-[var(--color-line)] px-2 py-1.5 ${bg}`}>
                      <input type="checkbox" checked={sel} readOnly tabIndex={-1} className="pointer-events-none size-4 accent-[var(--color-brand)]" aria-label={`Selectează ${r.name}`} />
                    </td>
                  )}
                  <td className={`sticky ${canSend ? "left-10" : "left-0"} z-10 border-b border-[var(--color-line)] px-2 py-1.5 font-medium ${bg}`} style={{ maxWidth: 280 }}>
                    <Link
                      href={`/platitori/${r.id}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="block truncate hover:text-brand hover:underline"
                      title={`${r.name} — deschide fișa`}
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td className="border-b border-[var(--color-line)] px-2 py-1.5">{r.meterSeries ?? r.contract ?? "—"}</td>
                  <td className="border-b border-[var(--color-line)] px-2 py-1.5" style={{ maxWidth: 240 }}>
                    <div className="truncate" title={r.consumAddress ?? ""}>{r.consumAddress ?? <Dash />}</div>
                  </td>
                  <td className="border-b border-[var(--color-line)] px-2 py-1.5" style={{ maxWidth: 230 }}>
                    {r.email ? (
                      <div className={`truncate ${flags & 1 ? "" : "text-st-progress"}`} title={flags & 1 ? r.email : `Adresă invalidă: ${r.email}`}>{r.email}</div>
                    ) : <Dash />}
                  </td>
                  <td className="border-b border-[var(--color-line)] px-2 py-1.5 tabular-nums">
                    {r.phone ? (
                      <span className={flags & 2 ? "" : "text-st-progress"} title={flags & 2 ? undefined : "Număr invalid pentru SMS"}>{r.phone}</span>
                    ) : <Dash />}
                  </td>
                  <td className="border-b border-[var(--color-line)] px-2 py-1.5">{r.latestInvoice?.number ?? <Dash />}</td>
                  <td className="border-b border-[var(--color-line)] px-2 py-1.5">{r.latestInvoice?.dueDate ? fmtDay(r.latestInvoice.dueDate) : <Dash />}</td>
                  <td className={`border-b border-[var(--color-line)] px-2 py-1.5 text-right tabular-nums ${r.latestInvoice && r.latestInvoice.grandTotal > 0 ? "font-semibold" : "text-ink-soft"}`}>
                    {r.latestInvoice ? money(r.latestInvoice.grandTotal) : <Dash />}
                  </td>
                  <td className="border-b border-[var(--color-line)] px-2 py-1.5">
                    {st ? <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{st.label}</span> : <Dash />}
                  </td>
                  <td className="border-b border-[var(--color-line)] px-2 py-1.5 whitespace-nowrap" title={r.lastNotifiedAt ? new Date(r.lastNotifiedAt).toLocaleString("ro-RO") : "Niciodată notificat"}>
                    {r.lastNotifiedAt ? (
                      <span className={recent ? "font-medium text-st-done" : "text-ink-soft"}>● {agoLabel(r.lastNotifiedAt)}</span>
                    ) : <Dash />}
                  </td>
                  {canSend && (
                    <td className="border-b border-[var(--color-line)] px-2 py-1.5">
                      <button
                        type="button"
                        disabled={flags === 0}
                        onClick={(e) => { e.stopPropagation(); openForRow(r); }}
                        title={flags === 0 ? "Fără email/telefon valid" : "Trimite doar acestui plătitor"}
                        className="tap grid size-7 place-items-center rounded-md border border-[var(--color-line)] hover:bg-brand-soft disabled:opacity-30"
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

      {/* ── Paginare numerică (ca în Task-uri) ─────────────────────────────── */}
      {data.total > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-1">
          <button
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="tap grid size-9 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40"
            aria-label="Pagina anterioară"
          >
            <IconChevronLeft className="size-4" />
          </button>
          {pageButtons.map((b, i) =>
            b === "…" ? (
              <span key={`e${i}`} className="flex h-9 w-6 items-center justify-center text-sm text-ink-soft">…</span>
            ) : (
              <button
                key={b}
                onClick={() => setPage(b)}
                className={`tap h-9 min-w-[36px] rounded-lg px-2.5 text-sm font-medium ${
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
            className="tap grid size-9 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40"
            aria-label="Pagina următoare"
          >
            <IconChevronRight className="size-4" />
          </button>
        </div>
      )}

      {compose && (
        <PayerNotifyDialog
          recipients={compose.recipients}
          previewName={compose.previewRow?.name ?? "Ion Popescu (exemplu)"}
          previewVars={compose.previewRow ? rowVars(compose.previewRow) : SAMPLE_VARS}
          emailEnabled={emailEnabled}
          smsEnabled={smsEnabled}
          userEmail={userEmail}
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
      className={`border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-2 font-semibold ${right ? "text-right" : "text-left"} ${
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
