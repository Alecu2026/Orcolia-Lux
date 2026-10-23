"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  decodeMonth,
  decodeSnapshot,
  type MonthTuple,
  type SnapInvoice,
  type SnapRow,
  type SnapTuple,
} from "@/lib/payer-notify";

const IDB_NAME = "payers-cache";
const IDB_KEY = "snapshot-v2";
const FRESH_MS = 20_000; // sub 20 s de la ultima verificare nu mai întrebăm serverul (altfel o cerere condiționată: 304 dacă nu s-a schimbat nimic)
const STALE_REFRESH_MS = 5 * 60_000; // la revenirea în filă, dacă datele sunt mai vechi de 5 minute, le reîmprospătăm discret

// ── IndexedDB (cache local, ca la următoarea deschidere lista să apară instant) ──
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openDb();
    return await new Promise<T | undefined>((resolve, reject) => {
      const r = db.transaction("kv").objectStore("kv").get(key);
      r.onsuccess = () => resolve(r.result as T | undefined);
      r.onerror = () => reject(r.error);
    });
  } catch {
    return undefined;
  }
}
async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // fără IndexedDB (mod privat etc.) — merge și fără cache local
  }
}

type Stored = { at: number; etag: string | null; sorted: boolean; rows: SnapTuple[] };

/** Rulează după prima afișare (nu blochează primul rând vizibil cu descărcarea/decodarea a ~19.000 de plătitori). */
function whenIdle(fn: () => void): () => void {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout: 250 });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = setTimeout(fn, 100);
  return () => clearTimeout(id);
}

/**
 * Toți plătitorii în memoria browserului. Prima dată vin de pe server într-o singură cerere (compactă), apoi
 * rămân în IndexedDB: la următoarea deschidere apar instant și se reîmprospătează în fundal. Filtrarea/sortarea/paginarea
 * se fac în JS pe acest set (vezi filterSnapshot) — nicio interogare în baza de date la fiecare filtru.
 */
export function usePayerDataset(enabled: boolean) {
  const rowsRef = useRef<SnapRow[] | null>(null); // același set ca `rows`, pentru patch-uri în-loc
  const [rows, setRows] = useState<SnapRow[] | null>(null);
  const [version, setVersion] = useState(0); // crește la orice schimbare a setului (descărcare nouă / patch local)
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const loadedAtRef = useRef<number | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const etagRef = useRef<string | null>(null); // versiunea pe care o avem (cererea următoare e condiționată: 304 = nimic nou)

  const [monthMaps, setMonthMaps] = useState<Map<string, Map<string, SnapInvoice>>>(new Map());
  const monthLoading = useRef(new Set<string>());

  const apply = useCallback((tuples: SnapTuple[], at: number, presorted = false) => {
    const decoded = decodeSnapshot(tuples, presorted);
    rowsRef.current = decoded;
    setRows(decoded);
    loadedAtRef.current = at;
    setLoadedAt(at);
    setVersion((v) => v + 1);
  }, []);

  const fetchFresh = useCallback(async () => {
    if (inflight.current) return inflight.current;
    const p = (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/platitori/snapshot", { headers: etagRef.current ? { "If-None-Match": etagRef.current } : undefined });
        if (res.status === 304) {
          // Aceeași versiune ca cea din memorie: nimic de descărcat sau de decodat.
          const at = Date.now();
          loadedAtRef.current = at;
          setLoadedAt(at);
          return;
        }
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? "Eroare la încărcare.");
        const at = Date.now();
        const etag = res.headers.get("etag");
        etagRef.current = etag;
        apply(j.rows as SnapTuple[], at, j.sorted === true);
        void idbSet(IDB_KEY, { at, etag, sorted: j.sorted === true, rows: j.rows } satisfies Stored);
      } catch (e) {
        // Dacă avem deja date (din cache local) le păstrăm; altfel UI-ul cade pe interogarea clasică pe server.
        setError(e instanceof Error ? e.message : "Eroare la încărcare.");
      } finally {
        setLoading(false);
        inflight.current = null;
      }
    })();
    inflight.current = p;
    return p;
  }, [apply]);

  // Pornire: întâi cache-ul local (instant), apoi, dacă e mai vechi de un minut, versiunea proaptă de pe server.
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const cancel = whenIdle(() => {
      void (async () => {
        const stored = await idbGet<Stored>(IDB_KEY);
        if (!alive) return;
        if (stored?.rows?.length) {
          etagRef.current = stored.etag;
          apply(stored.rows, stored.at, stored.sorted);
        }
        if (!stored || Date.now() - stored.at > FRESH_MS) await fetchFresh();
      })();
    });
    return () => {
      alive = false;
      cancel();
    };
  }, [enabled, apply, fetchFresh]);

  // La revenirea în filă după mult timp, reîmprospătare discretă.
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === "visible" && loadedAtRef.current && Date.now() - loadedAtRef.current > STALE_REFRESH_MS) {
        void fetchFresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, fetchFresh]);

  /** Facturile unei luni (cache pe lună) — se cer doar când utilizatorul alege „Luna facturii". */
  const ensureMonth = useCallback(
    (month: string) => {
      if (!month || monthMaps.has(month) || monthLoading.current.has(month)) return;
      monthLoading.current.add(month);
      fetch(`/api/platitori/snapshot?month=${encodeURIComponent(month)}`)
        .then((r) => r.json())
        .then((j: { rows?: MonthTuple[] }) => {
          if (j.rows) setMonthMaps((m) => new Map(m).set(month, decodeMonth(j.rows!)));
        })
        .catch(() => {})
        .finally(() => monthLoading.current.delete(month));
    },
    [monthMaps],
  );

  /** „Ultima notificare" actualizată local, imediat după trimitere (și în cache-ul din IndexedDB la următoarea descărcare). */
  const patchNotified = useCallback((ids: Set<string>, iso: string) => {
    const rows = rowsRef.current;
    if (!rows) return;
    const next = rows.map((r) => (ids.has(r.id) ? { ...r, lastNotifiedAt: iso } : r));
    rowsRef.current = next;
    setRows(next);
    setVersion((v) => v + 1);
  }, []);

  /** Nume/telefon/email schimbate local (după „Editează" din popup) — și textul de căutare se recalculează. */
  const patchRow = useCallback((id: string, patch: Partial<Pick<SnapRow, "name" | "phone" | "email">>) => {
    const rows = rowsRef.current;
    if (!rows) return;
    const next = rows.map((r) => {
      if (r.id !== id) return r;
      const n = { ...r, ...patch };
      n._h = [n.name, n.meterSeries, n.contract, n.email, n.phone].filter(Boolean).join("\n").toLowerCase();
      return n;
    });
    rowsRef.current = next;
    setRows(next);
    setVersion((v) => v + 1);
  }, []);

  const refresh = useCallback(() => {
    setMonthMaps(new Map());
    monthLoading.current.clear();
    return fetchFresh();
  }, [fetchFresh]);

  return { rows, version, loading, error, loadedAt, monthMaps, ensureMonth, patchNotified, patchRow, refresh };
}
