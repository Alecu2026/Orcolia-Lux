"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  decodeMonth,
  decodeSnapshot,
  refreshDerived,
  type MonthTuple,
  type SnapInvoice,
  type SnapRow,
  type SnapTuple,
} from "@/lib/payer-notify";

const IDB_NAME = "payers-cache";
import { PAYERS_V_COOKIE } from "@/lib/payer-prefs";

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
type StoredMonth = { etag: string | null; rows: MonthTuple[] };

/** Anunță serverul ce versiune a listei avem local (cookie): dacă e cea curentă, pagina nu mai cere descărcarea ei. */
function rememberVersion(etag: string | null) {
  if (!etag) return;
  try {
    document.cookie = `${PAYERS_V_COOKIE}=${etag.replace(/[^0-9a-zA-Z]/g, "")}; path=/; max-age=31536000; samesite=lax`;
  } catch {}
}

/**
 * Aduce lista în IndexedDB în fundal, înainte să deschidă cineva /platitori (apelată din layout, după ce pagina curentă s-a liniștit):
 * la deschidere lista e deja locală, deci „Toate" e instant chiar și prima dată. Cerere condiționată (304 = ~1 KB).
 */
export async function prefetchPayerDataset(): Promise<void> {
  try {
    const stored = await idbGet<Stored>(IDB_KEY);
    if (stored && Date.now() - stored.at < 10 * 60_000) return;
    const res = await fetch("/api/platitori/snapshot", { headers: stored?.etag ? { "If-None-Match": stored.etag } : undefined });
    if (res.status === 304 && stored) {
      await idbSet(IDB_KEY, { ...stored, at: Date.now() } satisfies Stored);
      rememberVersion(stored.etag);
      return;
    }
    if (!res.ok) return;
    const j = await res.json();
    const etag = res.headers.get("etag");
    await idbSet(IDB_KEY, { at: Date.now(), etag, sorted: j.sorted === true, rows: j.rows } satisfies Stored);
    rememberVersion(etag);
  } catch {
    // fără rețea / IndexedDB: nu e grav, pagina o aduce la deschidere
  }
}

/** Rulează după prima afișare (nu blochează primul rând vizibil cu descărcarea/decodarea a ~19.000 de plătitori). */
function startSoon(fn: () => void): () => void {
  const id = setTimeout(fn, 0); // după hidratare, dar fără pauză artificială
  return () => clearTimeout(id);
}

/**
 * Toți plătitorii în memoria browserului. Prima dată vin de pe server într-o singură cerere (compactă), apoi
 * rămân în IndexedDB: la următoarea deschidere apar instant și se reîmprospătează în fundal. Filtrarea/sortarea/paginarea
 * se fac în JS pe acest set (vezi filterSnapshot) — nicio interogare în baza de date la fiecare filtru.
 */
export function usePayerDataset(enabled: boolean, warmMonths: string[] = []) {
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
  const monthsRef = useRef(new Set<string>()); // lunile deja în `monthMaps` (fără a depinde de starea React în closure)

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
          rememberVersion(etagRef.current);
          return;
        }
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? "Eroare la încărcare.");
        const at = Date.now();
        const etag = res.headers.get("etag");
        etagRef.current = etag;
        apply(j.rows as SnapTuple[], at, j.sorted === true);
        void idbSet(IDB_KEY, { at, etag, sorted: j.sorted === true, rows: j.rows } satisfies Stored).then(() => rememberVersion(etag));
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
    const cancel = startSoon(() => {
      void (async () => {
        const stored = await idbGet<Stored>(IDB_KEY);
        if (!alive) return;
        if (stored?.rows?.length) {
          etagRef.current = stored.etag;
          apply(stored.rows, stored.at, stored.sorted);
          rememberVersion(stored.etag);
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

  /**
   * Facturile unei luni: din memorie, altfel din IndexedDB (instant) cu revalidare în fundal (ETag), altfel de pe server (comprimat, din cache-ul lui).
   * Lunile recente se aduc în avans (vezi `warmMonths`), deci alegerea lor în filtru nu mai așteaptă nimic.
   */
  const ensureMonth = useCallback((month: string) => {
    if (!month || monthsRef.current.has(month) || monthLoading.current.has(month)) return;
    monthLoading.current.add(month);
    const key = `month:${month}`;
    const put = (rows: MonthTuple[]) => {
      monthsRef.current.add(month);
      setMonthMaps((m) => new Map(m).set(month, decodeMonth(rows)));
    };
    void (async () => {
      try {
        const stored = await idbGet<StoredMonth>(key);
        if (stored?.rows) put(stored.rows);
        const res = await fetch(`/api/platitori/snapshot?month=${encodeURIComponent(month)}`, {
          headers: stored?.etag && etagRef.current ? { "If-None-Match": stored.etag } : undefined,
        });
        if (res.status === 304) return;
        if (!res.ok) return;
        const j = (await res.json()) as { rows?: MonthTuple[] };
        if (!j.rows) return;
        put(j.rows);
        void idbSet(key, { etag: res.headers.get("etag"), rows: j.rows } satisfies StoredMonth);
      } catch {
        // fără rețea: rămâne ce a fost în IndexedDB (dacă a fost)
      } finally {
        monthLoading.current.delete(month);
      }
    })();
  }, []);

  // După ce lista principală e în memorie, aducem pe rând lunile recente (în pauzele browserului, fără date mobile economisite).
  const warmKey = warmMonths.join(",");
  useEffect(() => {
    if (!enabled || !rows || !warmKey) return;
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;
    const list = warmKey.split(",");
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      if (i >= list.length) return;
      ensureMonth(list[i++]);
      timer = setTimeout(next, 350);
    };
    timer = setTimeout(next, 600);
    return () => clearTimeout(timer);
  }, [enabled, rows, warmKey, ensureMonth]);

  /** „Ultima notificare" actualizată local, imediat după trimitere (și în cache-ul din IndexedDB la următoarea descărcare). */
  const patchNotified = useCallback((ids: Set<string>, iso: string) => {
    const rows = rowsRef.current;
    if (!rows) return;
    const next = rows.map((r) => (ids.has(r.id) ? refreshDerived({ ...r, lastNotifiedAt: iso }) : r));
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
      return refreshDerived({ ...r, ...patch });
    });
    rowsRef.current = next;
    setRows(next);
    setVersion((v) => v + 1);
  }, []);

  const refresh = useCallback(() => {
    setMonthMaps(new Map());
    monthsRef.current.clear();
    monthLoading.current.clear();
    return fetchFresh();
  }, [fetchFresh]);

  return { rows, version, loading, error, loadedAt, monthMaps, ensureMonth, patchNotified, patchRow, refresh };
}
