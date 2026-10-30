"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clearReadNotifications, markAllNotificationsRead, markNotificationsReadAction } from "@/app/actions/notifications";
import { setTaskProgress, setTaskStatus } from "@/app/actions/tasks";
import { setStatus as setAppointmentStatus } from "@/app/actions/appointments";
import { notificationDay, objectIdOfUrl, type NRow, type NotificationKind } from "@/lib/notification-kind";
import { useLocale, useMessages, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";
import { DEFAULT_PER_PAGE, NOTIFY_PER_PAGE, normalizePerPageClient, perPageLabel } from "@/lib/payer-notify";
import { IconChevronLeft, IconChevronRight } from "./icons";
import { useToast } from "./toast";
import DateFilterInput from "./DateFilterInput";
import { useNotificationDataset } from "./useNotificationDataset";

type Kind = "" | "reminders" | NotificationKind;
type Status = "all" | "unread" | "read";
type Period = "all" | "today" | "yesterday" | "7d" | "30d" | "custom";
type Filters = { kind: Kind; status: Status; period: Period; from: string; to: string; q: string; sort: "new" | "old"; actions: boolean };
const EMPTY: Filters = { kind: "", status: "all", period: "all", from: "", to: "", q: "", sort: "new", actions: false };
const LS_KEY = "notif-filters-v1";
const LS_PER_PAGE = "notif-perpage-v1";

/** Butoanele de paginare cu „…” pentru spații mari (aceeași logică ca la Plătitori / Citiri teren). */
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

const TZ = "Europe/Bucharest";
const ICON: Record<NotificationKind, string> = { tasks: "✅", tickets: "🎫", appointments: "📅", meters: "💧", payers: "👥", invoices: "🧾", projects: "📁", clients: "🧑", calls: "📞" };
const KIND_CHIPS: { key: Kind; label: string }[] = [
  { key: "reminders", label: "Remindere" },
  { key: "tasks", label: "Sarcini" },
  { key: "tickets", label: "Cereri" },
  { key: "appointments", label: "Programări" },
  { key: "meters", label: "Contoare" },
  { key: "payers", label: "Plătitori" },
  { key: "invoices", label: "Facturi" },
  { key: "projects", label: "Proiecte" },
  { key: "clients", label: "Clienți" },
  { key: "calls", label: "Apeluri" },
];
const DWELL_MS = 1_800;
const OVERSCAN_PX = 900;
const EST_ITEM = 92;
const EST_ITEM_ACT = 128;
const EST_DAY = 44;

type Entry = { key: string; kind: "day"; day: string } | { key: string; kind: "item"; row: NRow };

const hasActions = (r: NRow, canAppt: boolean) => !!objectIdOfUrl(r.url) && (r.kind === "tasks" || r.kind === "tickets" || (r.kind === "appointments" && canAppt));

function filterRows(rows: NRow[], f: Filters, canAppt: boolean, skipKind = false): NRow[] {
  const today = notificationDay(Date.now());
  const yesterday = notificationDay(Date.now() - 86_400_000);
  const d7 = notificationDay(Date.now() - 6 * 86_400_000);
  const d30 = notificationDay(Date.now() - 29 * 86_400_000);
  const tokens = f.q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5);
  return rows.filter((r) => {
    if (f.status === "unread" ? r.read : f.status === "read" ? !r.read : false) return false;
    if (!skipKind && f.kind) {
      if (f.kind === "reminders" ? !r.reminder : r.kind !== f.kind) return false;
    }
    if (f.period === "today" ? r.day !== today : f.period === "yesterday" ? r.day !== yesterday : f.period === "7d" ? r.day < d7 : f.period === "30d" ? r.day < d30 : false) return false;
    if (f.period === "custom") {
      if (f.from && r.day < f.from) return false;
      if (f.to && r.day > f.to) return false;
    }
    if (f.actions && !hasActions(r, canAppt)) return false;
    for (const tk of tokens) if (!r._h.includes(tk)) return false;
    return true;
  });
}

const activeCount = (f: Filters) => (f.kind ? 1 : 0) + (f.status !== "all" ? 1 : 0) + (f.period !== "all" ? 1 : 0) + (f.q ? 1 : 0) + (f.actions ? 1 : 0) + (f.sort !== "new" ? 1 : 0);

const sel = (on: boolean) => `h-8 rounded-lg border px-2 text-xs outline-none focus:border-brand ${on ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)]"}`;

/**
 * Inbox-ul de notificări (ca în Telegram, dar în aplicație), construit ca „Plătitori”: lista completă stă în browser pe 3 straturi (memorie → IndexedDB → server, vezi
 * useNotificationDataset), filtrele / căutarea rulează în JS pe toată lista, iar randarea e VIRTUALIZATĂ (doar rândurile din ecran sunt în pagină), deci rămâne fluidă și cu mii de
 * notificări. Notificările noi apar singure, o notificare se marchează citită când o vezi, iar pe cele de sarcini / cereri / programări sunt acțiuni rapide.
 */
export default function NotificationsInbox({ userId, canAppointments }: { userId: string; canAppointments: boolean }) {
  const t = useT();
  const m = useMessages();
  const tag = dateTag(useLocale());
  const toast = useToast();
  const router = useRouter();
  const ds = useNotificationDataset(userId);
  const { rows } = ds;

  const [f, setF] = useState<Filters>(EMPTY);
  const [draftQ, setDraftQ] = useState("");
  const [ready, setReady] = useState(false);
  const [perPage, setPerPageState] = useState<number>(DEFAULT_PER_PAGE);
  /** Pagina curentă, legată de filtrele pentru care a fost aleasă: la orice schimbare de filtru / mărime se revine la pagina 1 (fără efecte). */
  const [pg, setPg] = useState({ key: "", page: 1 });
  const [acts, setActs] = useState<Record<string, { busy?: boolean; done?: string; error?: string }>>({});
  /** Notificările necitite la deschidere / apărute cât timp pagina e deschisă: rămân evidențiate în această vizită chiar după ce sunt marcate citite. */
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const freshSeen = useRef<Set<string> | null>(null);

  // filtrele salvate pe acest dispozitiv
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Partial<Filters>;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setF({ ...EMPTY, ...s, q: "" });
      }
      const pp = localStorage.getItem(LS_PER_PAGE);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (pp) setPerPageState(normalizePerPageClient(pp));
    } catch {}
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(LS_KEY, JSON.stringify({ ...f, q: "" })); } catch {}
  }, [f, ready]);
  useEffect(() => {
    const id = setTimeout(() => setF((cur) => (cur.q === draftQ ? cur : { ...cur, q: draftQ })), 160);
    return () => clearTimeout(id);
  }, [draftQ]);

  // evidențierea „nou”: necitite la prima afișare + cele apărute ulterior
  useEffect(() => {
    if (!rows) return;
    if (freshSeen.current === null) {
      freshSeen.current = new Set(rows.map((r) => r.id));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFresh(new Set(rows.filter((r) => !r.read).map((r) => r.id)));
      return;
    }
    const seen = freshSeen.current;
    const add = rows.filter((r) => !seen.has(r.id));
    if (add.length === 0) return;
    for (const r of add) seen.add(r.id);
    setFresh((cur) => new Set([...cur, ...add.filter((r) => !r.read).map((r) => r.id)]));
  }, [rows]);

  // ── filtrare + sortare + contoare (totul în JS, pe lista completă) ────────────────────
  const filtered = useMemo(() => {
    if (!rows) return [];
    const out = filterRows(rows, f, canAppointments);
    return f.sort === "old" ? [...out].reverse() : out;
  }, [rows, f, canAppointments]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    if (!rows) return c;
    for (const r of filterRows(rows, f, canAppointments, true)) {
      if (r.kind) c[r.kind] = (c[r.kind] ?? 0) + 1;
      if (r.reminder) c.reminders = (c.reminders ?? 0) + 1;
    }
    return c;
  }, [rows, f, canAppointments]);

  // ── paginare: pagina curentă din lista filtrată ──────────────────────────────────────
  const fkey = `${JSON.stringify(f)}|${perPage}`;
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const curPage = Math.min(pg.key === fkey ? pg.page : 1, totalPages);
  const setPage = useCallback((n: number) => { setPg({ key: fkey, page: n }); window.scrollTo({ top: 0 }); }, [fkey]);
  const paged = useMemo(() => (filtered.length <= perPage ? filtered : filtered.slice((curPage - 1) * perPage, curPage * perPage)), [filtered, perPage, curPage]);
  const from = filtered.length === 0 ? 0 : (curPage - 1) * perPage + 1;
  const to = Math.min(curPage * perPage, filtered.length);
  const pageButtons = buildPageButtons(curPage, totalPages);

  // ── intrări (antet de zi + notificare) ────────────────────────────────────────────────
  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    let last = "";
    for (const r of paged) {
      if (r.day !== last) { out.push({ key: `d:${r.day}`, kind: "day", day: r.day }); last = r.day; }
      out.push({ key: r.id, kind: "item", row: r });
    }
    return out;
  }, [paged]);

  // ── virtualizare (scroll-ul paginii): înălțimile se măsoară; până atunci se estimează ───────────
  const heights = useRef(new Map<string, number>());
  const [hv, setHv] = useState(0);
  const rafH = useRef<number | null>(null);
  const bumpHeights = useCallback(() => {
    if (rafH.current != null) return;
    rafH.current = requestAnimationFrame(() => { rafH.current = null; setHv((v) => v + 1); });
  }, []);
  const est = useCallback((e: Entry) => heights.current.get(e.key) ?? (e.kind === "day" ? EST_DAY : hasActions(e.row, canAppointments) ? EST_ITEM_ACT : EST_ITEM), [canAppointments]);
  const offsets = useMemo(() => {
    const o = new Array<number>(entries.length + 1);
    o[0] = 0;
    for (let i = 0; i < entries.length; i++) o[i + 1] = o[i] + est(entries[i]);
    return o;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, est, hv]);
  const listRef = useRef<HTMLDivElement>(null);
  const [win, setWin] = useState({ top: 0, h: 900 });
  const rafS = useRef<number | null>(null);
  const readWin = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const top = -el.getBoundingClientRect().top; // cât din listă a trecut deasupra ferestrei
    setWin((w) => (Math.abs(w.top - top) < 4 && w.h === window.innerHeight ? w : { top, h: window.innerHeight }));
  }, []);
  useLayoutEffect(() => { readWin(); }, [readWin, entries.length]);
  useEffect(() => {
    const on = () => { if (rafS.current == null) rafS.current = requestAnimationFrame(() => { rafS.current = null; readWin(); }); };
    window.addEventListener("scroll", on, { passive: true, capture: true });
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on, true); window.removeEventListener("resize", on); };
  }, [readWin]);

  const total = offsets[entries.length] ?? 0;
  const lo = (x: number) => { // primul index cu offsets[i+1] > x
    let a = 0, b = entries.length;
    while (a < b) { const mid = (a + b) >> 1; if (offsets[mid + 1] > x) b = mid; else a = mid + 1; }
    return a;
  };
  const start = Math.max(0, lo(win.top - OVERSCAN_PX));
  const end = Math.min(entries.length, lo(win.top + win.h + OVERSCAN_PX) + 1);
  const visible = entries.slice(start, end);

  // măsurarea rândurilor randate
  const ro = useRef<ResizeObserver | null>(null);
  useEffect(() => {
    ro.current = new ResizeObserver((list) => {
      let changed = false;
      for (const e of list) {
        const key = (e.target as HTMLElement).dataset.ek;
        if (!key) continue;
        const h = Math.round((e.target as HTMLElement).getBoundingClientRect().height);
        if (h > 0 && heights.current.get(key) !== h) { heights.current.set(key, h); changed = true; }
      }
      if (changed) bumpHeights();
    });
    return () => ro.current?.disconnect();
  }, [bumpHeights]);
  const measure = useCallback((el: HTMLElement | null) => { if (el && ro.current) ro.current.observe(el); }, []);

  // ── marcare ca citite: o notificare văzută ~2 s (cât tab-ul e vizibil) ─────────────────
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const queue = useRef(new Set<string>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    const ids = [...queue.current];
    queue.current.clear();
    if (ids.length === 0) return;
    ds.markRead(ids);
    markNotificationsReadAction(ids).then((r) => { ds.markRead([], r.unread); window.dispatchEvent(new CustomEvent("crm:unread", { detail: r.unread })); }).catch(() => {});
  }, [ds]);
  const flushRef = useRef(flush);
  flushRef.current = flush;
  const markSoon = useCallback((id: string) => {
    queue.current.add(id);
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => flushRef.current(), 600);
  }, []);
  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (list) => {
        for (const e of list) {
          const id = (e.target as HTMLElement).dataset.nid;
          if (!id) continue;
          if (e.isIntersecting) {
            if (timers.current.has(id)) continue;
            timers.current.set(id, setTimeout(() => { timers.current.delete(id); if (document.visibilityState === "visible") markSoon(id); }, DWELL_MS));
          } else {
            const tm = timers.current.get(id);
            if (tm) { clearTimeout(tm); timers.current.delete(id); }
          }
        }
      },
      { threshold: 0.6 },
    );
    root.querySelectorAll<HTMLElement>("[data-nid][data-unread='1']").forEach((el) => io.observe(el));
    const tm = timers.current;
    return () => { io.disconnect(); tm.forEach(clearTimeout); tm.clear(); };
  }, [start, end, rows, entries, markSoon]);

  function open(r: NRow) {
    if (!r.read) markSoon(r.id);
    if (r.url) router.push(r.url);
  }
  async function markAll() {
    ds.markAllRead();
    window.dispatchEvent(new CustomEvent("crm:unread", { detail: 0 }));
    await markAllNotificationsRead().catch(() => {});
  }
  async function clearRead() {
    ds.removeRead();
    await clearReadNotifications().then(() => toast.success(m.notifications.clearReadDone)).catch(() => toast.error(t(m.common.error)));
  }
  async function act(r: NRow, label: string, run: () => Promise<{ ok?: boolean; error?: string; needsProof?: boolean } | undefined>) {
    setActs((a) => ({ ...a, [r.id]: { busy: true } }));
    try {
      const res = await run();
      if (res?.needsProof) setActs((a) => ({ ...a, [r.id]: { error: t("Finalizarea cere o poză sau un fișier — deschide sarcina.") } }));
      else if (res?.error) setActs((a) => ({ ...a, [r.id]: { error: t(res.error!) } }));
      else {
        setActs((a) => ({ ...a, [r.id]: { done: label } }));
        if (!r.read) markSoon(r.id);
      }
    } catch {
      setActs((a) => ({ ...a, [r.id]: { error: t(m.common.error) } }));
    }
  }

  const today = notificationDay(Date.now());
  const yesterday = notificationDay(Date.now() - 86_400_000);
  const dayLabel = (d: string) => (d === today ? t("Azi") : d === yesterday ? t("Ieri") : new Date(`${d}T12:00:00`).toLocaleDateString(tag, { weekday: "long", day: "2-digit", month: "long", year: "numeric" }));
  const time = (ms: number) => new Date(ms).toLocaleTimeString(tag, { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  const nActive = activeCount(f);
  const unreadLocal = ds.unread;

  return (
    <div data-source={ds.source ?? ""} data-total={rows?.length ?? ""}>
      <div className="mb-3 border-b border-[var(--color-line)] pb-2">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold">{m.notifications.title}</h1>
            {unreadLocal > 0 && <span className="rounded-full bg-st-cancelled px-2 py-0.5 text-[11px] font-bold text-white">{unreadLocal}</span>}
            <span className="flex items-center gap-1 text-[11px] text-ink-soft" title={t("Se actualizează singur")}>
              <span className={`size-1.5 rounded-full ${ds.loading ? "animate-pulse bg-st-progress" : "bg-st-done"}`} /> {t("live")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={markAll} disabled={unreadLocal === 0} className="tap h-8 cursor-pointer rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium hover:bg-[var(--color-surface-2)] disabled:opacity-40">✓ {m.notifications.markAllRead}</button>
            <button onClick={clearRead} className="tap h-8 cursor-pointer rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium text-ink-soft hover:bg-[var(--color-surface-2)]">🗑 {m.notifications.clearRead}</button>
          </div>
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label={t("Filtre notificări")}>
          <button type="button" role="tab" aria-selected={f.kind === "" && f.status === "all"} onClick={() => setF({ ...f, kind: "", status: "all" })} className={`tap h-8 shrink-0 cursor-pointer rounded-full border px-3 text-xs font-medium ${f.kind === "" && f.status === "all" ? "border-brand bg-brand text-white" : "border-[var(--color-line)] hover:bg-brand-soft"}`}>{t("Toate")}{rows ? ` (${rows.length})` : ""}</button>
          <button type="button" role="tab" aria-selected={f.status === "unread"} onClick={() => setF({ ...f, status: f.status === "unread" ? "all" : "unread" })} className={`tap h-8 shrink-0 cursor-pointer rounded-full border px-3 text-xs font-medium ${f.status === "unread" ? "border-brand bg-brand text-white" : "border-[var(--color-line)] hover:bg-brand-soft"}`}>{t("Necitite")}{unreadLocal > 0 ? ` (${unreadLocal})` : ""}</button>
          {KIND_CHIPS.filter((k) => (counts[k.key] ?? 0) > 0 || f.kind === k.key).map((k) => (
            <button key={k.key} type="button" role="tab" aria-selected={f.kind === k.key} onClick={() => setF({ ...f, kind: f.kind === k.key ? "" : k.key })} className={`tap h-8 shrink-0 cursor-pointer rounded-full border px-3 text-xs font-medium ${f.kind === k.key ? "border-brand bg-brand text-white" : "border-[var(--color-line)] hover:bg-brand-soft"}`}>
              {t(k.label)} ({counts[k.key] ?? 0})
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={draftQ}
            onChange={(e) => setDraftQ(e.target.value)}
            placeholder={t("Caută în notificări…")}
            aria-label={t("Caută în notificări…")}
            className={`min-w-40 flex-1 rounded-lg border px-2.5 text-xs outline-none focus:border-brand ${f.q ? "h-8 border-brand bg-brand/10 font-semibold text-brand" : "h-8 border-[var(--color-line)] bg-[var(--color-surface)]"}`}
          />
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Status })} className={sel(f.status !== "all")} aria-label={t("Stare")}>
            <option value="all">{t("Stare: toate")}</option>
            <option value="unread">{t("Necitite")}</option>
            <option value="read">{t("Citite")}</option>
          </select>
          <select value={f.period} onChange={(e) => setF({ ...f, period: e.target.value as Period })} className={sel(f.period !== "all")} aria-label={t("Perioadă")}>
            <option value="all">{t("Oricând")}</option>
            <option value="today">{t("Azi")}</option>
            <option value="yesterday">{t("Ieri")}</option>
            <option value="7d">{t("Ultimele 7 zile")}</option>
            <option value="30d">{t("Ultimele 30 de zile")}</option>
            <option value="custom">{t("Interval…")}</option>
          </select>
          {f.period === "custom" && (
            <>
              <DateFilterInput label={t("De la data")} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className={sel(!!f.from)} aria-label={t("De la data")} />
              <DateFilterInput label={t("Până la data")} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className={sel(!!f.to)} aria-label={t("Până la data")} />
            </>
          )}
          <select value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value as "new" | "old" })} className={sel(f.sort !== "new")} aria-label={t("Sortare")}>
            <option value="new">{t("Cele mai noi întâi")}</option>
            <option value="old">{t("Cele mai vechi întâi")}</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-ink-soft">
            {t("Afișează")}
            <select
              value={perPage}
              onChange={(e) => { const n = normalizePerPageClient(e.target.value); setPerPageState(n); setPg({ key: `${JSON.stringify(f)}|${n}`, page: 1 }); try { localStorage.setItem(LS_PER_PAGE, String(n)); } catch {} }}
              className={sel(perPage !== DEFAULT_PER_PAGE)}
              aria-label={t("Rânduri pe pagină")}
            >
              {NOTIFY_PER_PAGE.map((n) => <option key={n} value={n}>{perPageLabel(n, t)}</option>)}
            </select>
          </label>
          <label className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2 text-xs ${f.actions ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)]"}`}>
            <input type="checkbox" checked={f.actions} onChange={(e) => setF({ ...f, actions: e.target.checked })} className="size-3.5 accent-[var(--color-brand)]" />
            {t("Cu acțiuni rapide")}
          </label>
          {nActive > 0 && (
            <button type="button" onClick={() => { setF(EMPTY); setDraftQ(""); }} className="tap h-8 cursor-pointer rounded-lg border border-[var(--color-line)] px-2.5 text-xs text-ink-soft hover:bg-[var(--color-surface-2)]">
              {t("Resetează filtrele")} ({nActive})
            </button>
          )}
        </div>
        {rows && <p className="mt-1 text-[11px] text-ink-soft">{t("{n} din {total} notificări", { n: filtered.length, total: rows.length })}{totalPages > 1 ? ` · ${t("afișate {from}–{to}", { from, to })}` : ""}{ds.total > rows.length ? ` · ${t("se păstrează ultimele {n}", { n: rows.length })}` : ""}</p>}
      </div>

      {ds.error && !rows && <p className="rounded-xl bg-st-cancelled/10 p-3 text-sm text-st-cancelled">{t(ds.error)}</p>}

      {!rows ? (
        <div className="flex flex-col gap-1.5" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="card h-20 animate-pulse opacity-60" />)}
        </div>
      ) : entries.length === 0 ? (
        <div className="card grid place-items-center p-10 text-center text-sm text-ink-soft">
          {nActive === 0 ? m.notifications.noNotifications : t("Nicio notificare pentru aceste filtre.")}
        </div>
      ) : (
        <div ref={listRef} style={{ paddingTop: offsets[start], paddingBottom: Math.max(0, total - offsets[end]) }}>
          {visible.map((e) => {
            if (e.kind === "day") {
              return (
                <div key={e.key} data-ek={e.key} ref={measure} className="flex justify-center pb-1.5 pt-2">
                  <h2 className="rounded-full bg-[var(--color-surface-2)] px-3 py-0.5 text-[11px] font-semibold capitalize text-ink-soft">{dayLabel(e.day)}</h2>
                </div>
              );
            }
            const r = e.row;
            const a = acts[r.id];
            const isNew = fresh.has(r.id);
            const oid = objectIdOfUrl(r.url);
            const showWork = (r.kind === "tasks" || r.kind === "tickets") && !!oid;
            const showAppt = r.kind === "appointments" && !!oid && canAppointments;
            return (
              <div key={e.key} data-ek={e.key} ref={measure} className="pb-1.5">
                <article data-nid={r.id} data-unread={r.read ? "0" : "1"} className={`card flex gap-3 p-3 ${isNew ? "border-l-4 !border-l-brand" : ""} ${r.read && !isNew ? "opacity-70" : ""}`}>
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-[var(--color-surface-2)] text-base" aria-hidden>{r.kind ? ICON[r.kind] : "🔔"}</span>
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => open(r)} className="block w-full cursor-pointer text-left">
                      <p className={`text-sm ${r.read ? "font-medium" : "font-semibold"}`}>{r.title}</p>
                      {r.body && <p className="mt-0.5 line-clamp-4 whitespace-pre-line break-words text-xs text-ink-soft">{r.body}</p>}
                    </button>
                    {(showWork || showAppt || a?.done || a?.error) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {a?.done ? (
                          <span className="rounded-full bg-st-done/15 px-2.5 py-1 text-[11px] font-semibold text-st-done">✓ {a.done}</span>
                        ) : (
                          <>
                            {showWork && (
                              <>
                                <button type="button" disabled={a?.busy} onClick={() => act(r, t("În lucru"), () => setTaskStatus(oid!, "IN_PROGRESS"))} className="tap h-7 cursor-pointer rounded-lg border border-[var(--color-line)] px-2.5 text-[11px] font-medium hover:bg-brand-soft disabled:opacity-50">▶ {t("În lucru")}</button>
                                <button type="button" disabled={a?.busy} onClick={() => act(r, t("Finalizat"), () => setTaskStatus(oid!, "DONE"))} className="tap h-7 cursor-pointer rounded-lg border border-[var(--color-line)] px-2.5 text-[11px] font-medium hover:bg-brand-soft disabled:opacity-50">✓ {t("Finalizat")}</button>
                                {/* toate statusurile și progresul, ca în Telegram: listă derulantă (pe telefon se deschide selectorul nativ) */}
                                <select aria-label={t("Alt status")} value="" disabled={a?.busy} onChange={(ev) => { const v = ev.target.value; if (v) void act(r, m.status[v as keyof typeof m.status], () => setTaskStatus(oid!, v)); }} className="tap h-7 cursor-pointer rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-1.5 text-[11px] font-medium hover:bg-brand-soft disabled:opacity-50">
                                  <option value="">{t("Alt status")}…</option>
                                  {(["READ", "IN_PROGRESS", "ON_HOLD", "REVIEW", "DONE", "CANCELLED", "ASSIGNED", "NEW"] as const).map((k) => <option key={k} value={k}>{m.status[k]}</option>)}
                                </select>
                                <select aria-label={t("Progres")} value="" disabled={a?.busy} onChange={(ev) => { const v = ev.target.value; if (v) void act(r, `${v}%`, () => setTaskProgress(oid!, Number(v))); }} className="tap h-7 cursor-pointer rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-1.5 text-[11px] font-medium hover:bg-brand-soft disabled:opacity-50">
                                  <option value="">{t("Progres")}…</option>
                                  {[0, 25, 50, 75, 100].map((p) => <option key={p} value={p}>{p}%</option>)}
                                </select>
                              </>
                            )}
                            {showAppt && <button type="button" disabled={a?.busy} onClick={() => act(r, t("Confirmată"), () => setAppointmentStatus(oid!, "CONFIRMED"))} className="tap h-7 cursor-pointer rounded-lg border border-[var(--color-line)] px-2.5 text-[11px] font-medium hover:bg-brand-soft disabled:opacity-50">✓ {t("Confirmă")}</button>}
                          </>
                        )}
                        {a?.error && <span className="text-[11px] text-st-cancelled">{a.error}</span>}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-[11px] text-ink-soft">{time(r.t)}</span>
                    {!r.read && <span className="size-2 rounded-full bg-brand" aria-label={t("Necitită")} />}
                  </div>
                </article>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Paginare numerică ─────────────────────────────────────────────── */}
      {rows && filtered.length > 0 && totalPages > 1 && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-1" role="navigation" aria-label={t("Paginare")}>
          <button disabled={curPage <= 1} onClick={() => setPage(curPage - 1)} className="tap grid size-8 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40" aria-label={t("Pagina anterioară")}>
            <IconChevronLeft className="size-4" />
          </button>
          {pageButtons.map((b, i) =>
            b === "…" ? (
              <span key={`e${i}`} className="flex h-8 w-6 items-center justify-center text-sm text-ink-soft">…</span>
            ) : (
              <button key={b} onClick={() => setPage(b)} aria-current={b === curPage ? "page" : undefined} className={`tap h-8 min-w-[32px] rounded-lg px-2 text-xs font-medium ${b === curPage ? "bg-brand text-white" : "border border-[var(--color-line)] text-ink hover:bg-[var(--color-surface-2)]"}`}>
                {b}
              </button>
            ),
          )}
          <button disabled={curPage >= totalPages} onClick={() => setPage(curPage + 1)} className="tap grid size-8 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40" aria-label={t("Pagina următoare")}>
            <IconChevronRight className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
