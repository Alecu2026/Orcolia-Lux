"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decodeNotifications, toTuple, type FeedResponse, type NRow, type NTuple, type NotificationDataset } from "@/lib/notification-kind";
import { idbGet, idbSet } from "./usePayerDataset";

const FRESH_MS = 10_000; // sub 10 s de la ultima verificare nu mai întrebăm serverul
const POLL_NEW_MS = 12_000; // notificările noi: „ce e nou de atunci”, cerere mică
const REVALIDATE_MS = 60_000; // structura (șterse, citite în altă parte): cerere condiționată (304)
const IDB_PREFIX = "notif-v1:";

type Stored = { at: number; etag: string | null; unread: number; total: number; rows: NTuple[] };
type Memo = { tuples: NTuple[]; at: number; etag: string | null; unread: number; total: number };

/** STRATUL 1 — memoria paginii: la întoarcerea în pagină lista apare din prima randare, fără IndexedDB și fără decodare. */
const memos = new Map<string, Memo>();

const sortDesc = (a: NTuple, b: NTuple) => b[1] - a[1];

/**
 * Lista notificărilor în browser, pe 3 straturi: memorie (instant) → IndexedDB (instant la redeschidere, chiar și fără internet) → server (lista compactă gzip, cu ETag →
 * 304; serverul o ține în memorie pe versiune). Filtrarea, căutarea și gruparea se fac în JS pe lista completă (nicio interogare la fiecare filtru). Notificările noi vin la
 * 12 s printr-o cerere mică („după momentul X”); structura (șterse / citite în altă parte) se verifică la 60 s.
 */
export function useNotificationDataset(userId: string) {
  const key = IDB_PREFIX + userId;
  const [tuples, setTuples] = useState<NTuple[] | null>(() => memos.get(userId)?.tuples ?? null);
  const [unread, setUnread] = useState(() => memos.get(userId)?.unread ?? 0);
  const [total, setTotal] = useState(() => memos.get(userId)?.total ?? 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"memory" | "idb" | "server" | null>(() => (memos.has(userId) ? "memory" : null));
  const inflight = useRef<Promise<void> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({ unread: memos.get(userId)?.unread ?? 0 });

  const persist = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const m = memos.get(userId);
      if (m) void idbSet(key, { at: m.at, etag: m.etag, unread: m.unread, total: m.total, rows: m.tuples } satisfies Stored);
    }, 800);
  }, [key, userId]);

  const apply = useCallback((next: NTuple[], patch: Partial<Memo> = {}) => {
    const prev = memos.get(userId);
    const m: Memo = { tuples: next, at: patch.at ?? prev?.at ?? Date.now(), etag: patch.etag !== undefined ? patch.etag : prev?.etag ?? null, unread: patch.unread ?? prev?.unread ?? 0, total: patch.total ?? prev?.total ?? next.length };
    memos.set(userId, m);
    stateRef.current.unread = m.unread;
    setTuples(next);
    setUnread(m.unread);
    setTotal(m.total);
  }, [userId]);

  /** STRATUL 3 — serverul. `force` ignoră ETag-ul (când numărul de necitite de pe server diferă de cel local: s-a citit în altă parte). */
  const fetchFull = useCallback(async (force = false) => {
    if (inflight.current) return inflight.current;
    const p = (async () => {
      setLoading(true);
      setError(null);
      try {
        const etag = memos.get(userId)?.etag;
        const res = await fetch("/api/notifications/dataset", { headers: !force && etag ? { "If-None-Match": etag } : undefined });
        const srvUnread = Number(res.headers.get("x-unread"));
        if (res.status === 304) {
          const m = memos.get(userId);
          if (m) {
            memos.set(userId, { ...m, at: Date.now() });
            // aceeași structură, dar alt număr de necitite decât în rândurile locale: s-a citit / s-a marcat în altă parte (telefon, alt browser) → descărcăm lista din nou.
            // Se compară cu rândurile locale (nu cu numărul afișat, pe care „ce e nou” îl ia mereu de la server); dacă lista e plafonată, necititele mai vechi nu se văd, deci nu comparăm.
            const localUnread = m.tuples.reduce((n, t) => n + (t[2] === 0 ? 1 : 0), 0);
            if (m.total <= m.tuples.length && Number.isFinite(srvUnread) && srvUnread !== localUnread) {
              inflight.current = null;
              return void (await fetchFull(true));
            }
          }
          return;
        }
        if (!res.ok) throw new Error("Eroare la încărcare.");
        const j = (await res.json()) as NotificationDataset;
        const at = Date.now();
        apply(j.rows, { at, etag: res.headers.get("etag"), unread: j.unread, total: j.total });
        setSource("server");
        window.dispatchEvent(new CustomEvent("crm:unread", { detail: j.unread }));
        persist();
      } catch (e) {
        // fără internet nu e o eroare: lucrăm cu lista din memorie / IndexedDB
        if (typeof navigator === "undefined" || navigator.onLine) setError(e instanceof Error ? e.message : "Eroare la încărcare.");
      } finally {
        setLoading(false);
        inflight.current = null;
      }
    })();
    inflight.current = p;
    return p;
  }, [apply, persist, userId]);

  /** Notificările apărute după cea mai nouă cunoscută: cerere mică, se adaugă în fața listei. */
  const fetchNew = useCallback(async () => {
    const m = memos.get(userId);
    if (!m || m.tuples.length === 0 && m.total > 0) return;
    const newest = m.tuples[0]?.[1] ?? 0;
    try {
      const res = await fetch(`/api/notifications?after=${encodeURIComponent(new Date(newest).toISOString())}&limit=50`, { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as FeedResponse;
      const cur = memos.get(userId);
      if (!cur) return;
      const known = new Set(cur.tuples.map((t) => t[0]));
      const add = j.items.filter((i) => !known.has(i.id)).map(toTuple);
      stateRef.current.unread = j.unread;
      if (add.length === 0) {
        if (j.unread !== cur.unread) {
          memos.set(userId, { ...cur, unread: j.unread });
          setUnread(j.unread);
        }
        window.dispatchEvent(new CustomEvent("crm:unread", { detail: j.unread }));
        return;
      }
      apply([...add, ...cur.tuples].sort(sortDesc).slice(0, 5000), { unread: j.unread, total: cur.total + add.length, at: Date.now(), etag: j.etag ?? null });
      window.dispatchEvent(new CustomEvent("crm:unread", { detail: j.unread }));
      persist();
    } catch {
      /* reîncearcă la următorul ciclu */
    }
  }, [apply, persist, userId]);

  // Pornire: memorie → IndexedDB → server
  useEffect(() => {
    let alive = true;
    void (async () => {
      const m = memos.get(userId);
      if (m) {
        if (Date.now() - m.at > FRESH_MS) await fetchFull();
        return;
      }
      const stored = await idbGet<Stored>(key);
      if (!alive) return;
      if (stored?.rows) {
        apply(stored.rows, { at: stored.at, etag: stored.etag, unread: stored.unread, total: stored.total });
        setSource("idb");
        if (Date.now() - stored.at <= FRESH_MS) return;
      }
      await fetchFull();
    })();
    return () => { alive = false; };
  }, [apply, fetchFull, key, userId]);

  // Cât timp pagina e vizibilă: notificări noi la 12 s, structura la 60 s; la revenirea în filă — imediat
  useEffect(() => {
    const visible = () => document.visibilityState === "visible";
    const t1 = setInterval(() => { if (visible()) void fetchNew(); }, POLL_NEW_MS);
    const t2 = setInterval(() => { if (visible()) void fetchFull(); }, REVALIDATE_MS);
    const onVis = () => { if (visible()) { void fetchNew(); const m = memos.get(userId); if (m && Date.now() - m.at > FRESH_MS) void fetchFull(); } };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t1); clearInterval(t2); document.removeEventListener("visibilitychange", onVis); };
  }, [fetchFull, fetchNew, userId]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  // ── modificări locale (aplicate imediat, apoi trimise la server de apelant) ──
  const markRead = useCallback((ids: string[], serverUnread?: number) => {
    const m = memos.get(userId);
    if (!m) return;
    const set = new Set(ids);
    let changed = 0;
    const next = m.tuples.map((t) => (set.has(t[0]) && t[2] === 0 ? (changed++, [t[0], t[1], 1, t[3], t[4], t[5]] as NTuple) : t));
    if (changed === 0 && serverUnread == null) return;
    apply(next, { unread: serverUnread ?? Math.max(0, m.unread - changed) });
    persist();
  }, [apply, persist, userId]);
  const markAllRead = useCallback(() => {
    const m = memos.get(userId);
    if (!m) return;
    apply(m.tuples.map((t) => (t[2] === 0 ? ([t[0], t[1], 1, t[3], t[4], t[5]] as NTuple) : t)), { unread: 0 });
    persist();
  }, [apply, persist, userId]);
  const removeRead = useCallback(() => {
    const m = memos.get(userId);
    if (!m) return;
    const next = m.tuples.filter((t) => t[2] === 0);
    apply(next, { total: Math.max(next.length, m.total - (m.tuples.length - next.length)), etag: null });
    persist();
  }, [apply, persist, userId]);

  const rows: NRow[] | null = useMemo(() => (tuples ? decodeNotifications(tuples) : null), [tuples]);
  return { rows, unread, total, loading, error, source, markRead, markAllRead, removeRead, refresh: () => fetchFull(true) };
}
