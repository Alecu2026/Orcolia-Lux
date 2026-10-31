"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decodeInvoices, type InvRow, type InvTuple, type MonthCount } from "@/lib/invoice-list";
import { INVOICES_V_COOKIE } from "@/lib/payer-prefs";
import { idbName } from "@/lib/cache-scope";

const IDB_NAME = "payers-cache"; // aceeași bază IndexedDB ca la plătitori (un singur depozit „kv"), alte chei
const keyOf = (month: string) => `invoices-m-${month}`;
const LATEST_KEY = "invoices-latest";
const FRESH_MS = 20_000;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(idbName(IDB_NAME), 1);
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
    // fără IndexedDB: merge și fără cache local
  }
}

type Stored = { at: number; etag: string | null; rows: InvTuple[] };

/**
 * Cookie cu versiunile lunilor pe care le are browserul (ultimele 6, `AAAA-LL-versiune` separate prin punct): serverul nu mai cere descărcarea unei luni din HTML (preload) dacă o are deja.
 * Același format ca pe server (app/(app)/invoices/page.tsx).
 */
function rememberVersion(month: string, etag: string | null) {
  if (!etag) return;
  try {
    const mine = `${month}-${etag.replace(/[^0-9a-zA-Z]/g, "")}`;
    const cur = (document.cookie.split("; ").find((c) => c.startsWith(INVOICES_V_COOKIE + "="))?.slice(INVOICES_V_COOKIE.length + 1) ?? "").split(".").filter((e) => /^\d{4}-\d{2}-[0-9a-zA-Z]+$/.test(e) && !e.startsWith(month + "-"));
    document.cookie = `${INVOICES_V_COOKIE}=${[mine, ...cur].slice(0, 6).join(".")}; path=/; max-age=31536000; samesite=lax`;
  } catch {}
}

/** Luna cea mai recentă în IndexedDB, în fundal, înainte să deschidă cineva /invoices (apelată din layout). Cerere condiționată: 304 = ~1 KB. */
export async function prefetchInvoiceDataset(): Promise<void> {
  try {
    const latest = await idbGet<{ month: string; etag: string | null; at: number }>(LATEST_KEY);
    if (latest && Date.now() - latest.at < 10 * 60_000) return;
    const res = await fetch("/api/invoices/snapshot", { headers: latest?.etag ? { "If-None-Match": latest.etag } : undefined });
    if (res.status === 304 && latest) {
      await idbSet(LATEST_KEY, { ...latest, at: Date.now() });
      rememberVersion(latest.month, latest.etag);
      return;
    }
    const month = res.headers.get("x-invoice-month");
    if (!res.ok || !month) return;
    const j = (await res.json()) as { rows?: InvTuple[] };
    if (!j.rows) return;
    const etag = res.headers.get("etag");
    const at = Date.now();
    await idbSet(keyOf(month), { at, etag, rows: j.rows } satisfies Stored);
    await idbSet(LATEST_KEY, { month, etag, at });
    rememberVersion(month, etag);
  } catch {
    // fără rețea / IndexedDB: nu e grav
  }
}

type Shard = { at: number; etag: string | null; rows: InvRow[] };
// luni deja decodate în această sesiune (revenirea la o perioadă văzută e instantanee)
const memo = new Map<string, Shard>();

/**
 * Facturile lunilor cerute, în memoria browserului: din IndexedDB la deschidere, apoi validare condiționată (ETag) per lună. `rows` apare când TOATE lunile cerute sunt încărcate
 * (în ordinea lunilor date); până atunci pagina folosește lista de pe server. Lunile vechi, neschimbate, costă un 304.
 */
export function useInvoiceDataset(monthsWanted: string[] | null) {
  const wantKey = monthsWanted ? monthsWanted.join(",") : "";
  const shardsRef = useRef<Map<string, Shard>>(new Map());
  const [rows, setRows] = useState<InvRow[] | null>(null);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const loadedAtRef = useRef<number | null>(null);
  const wantRef = useRef<string[]>([]);
  const inflight = useRef<Map<string, Promise<void>>>(new Map());
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const publish = useCallback(() => {
    const want = wantRef.current;
    if (want.length === 0) { setRows(null); return; }
    const parts: InvRow[][] = [];
    for (const m of want) {
      const sh = shardsRef.current.get(m);
      if (!sh) { setRows(null); return; } // încă lipsește o lună
      parts.push(sh.rows);
    }
    setRows(parts.length === 1 ? parts[0] : parts.flat());
    setVersion((v) => v + 1);
  }, []);

  const fetchMonth = useCallback((month: string, force: boolean): Promise<void> => {
    const running = inflight.current.get(month);
    if (running) return running;
    const p = (async () => {
      const cur = shardsRef.current.get(month);
      if (cur && !force && Date.now() - cur.at < FRESH_MS) return;
      try {
        const res = await fetch(`/api/invoices/snapshot?month=${month}`, { headers: cur?.etag ? { "If-None-Match": cur.etag } : undefined });
        const at = Date.now();
        if (res.status === 304 && cur) {
          const next = { ...cur, at };
          shardsRef.current.set(month, next);
          memo.set(month, next);
          rememberVersion(month, cur.etag);
          return;
        }
        if (!res.ok) {
          if (res.status === 404) { shardsRef.current.set(month, { at, etag: null, rows: [] }); return; } // luna nu mai are facturi
          throw new Error(String(res.status));
        }
        const j = (await res.json()) as { rows?: InvTuple[] };
        const etag = res.headers.get("etag");
        const tuples = j.rows ?? [];
        const next: Shard = { at, etag, rows: decodeInvoices(tuples) };
        shardsRef.current.set(month, next);
        memo.set(month, next);
        void idbSet(keyOf(month), { at, etag, rows: tuples } satisfies Stored).then(() => rememberVersion(month, etag));
      } finally {
        inflight.current.delete(month);
      }
    })();
    inflight.current.set(month, p);
    return p;
  }, []);

  const loadAll = useCallback(async (force: boolean) => {
    const want = wantRef.current;
    if (want.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      await Promise.all(want.map((m) => fetchMonth(m, force)));
      if (!alive.current) return;
      const at = Date.now();
      loadedAtRef.current = at;
      setLoadedAt(at);
      publish();
    } catch {
      if (alive.current) setError("Nu am putut încărca lista de facturi.");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [fetchMonth, publish]);

  useEffect(() => {
    const want = wantKey ? wantKey.split(",") : [];
    wantRef.current = want;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (want.length === 0) { setRows(null); setLoading(false); return; }
    let cancelled = false;
    // din memoria sesiunii, apoi din IndexedDB, apoi validare în rețea
    for (const m of want) { const s = memo.get(m); if (s && !shardsRef.current.has(m)) shardsRef.current.set(m, s); }
    publish();
    const id = setTimeout(() => {
      void (async () => {
        await Promise.all(want.map(async (m) => {
          if (shardsRef.current.has(m)) return;
          const st = await idbGet<Stored>(keyOf(m));
          if (cancelled || !st?.rows) return;
          const sh: Shard = { at: st.at, etag: st.etag, rows: decodeInvoices(st.rows) };
          shardsRef.current.set(m, sh);
          memo.set(m, sh);
          rememberVersion(m, st.etag);
        }));
        if (cancelled) return;
        publish();
        await loadAll(false);
      })();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [wantKey, loadAll, publish]);

  useEffect(() => {
    if (!wantKey) return;
    const onVisible = () => {
      if (document.visibilityState === "visible" && loadedAtRef.current && Date.now() - loadedAtRef.current > 5 * 60_000) void loadAll(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [wantKey, loadAll]);

  /** Modificare locală a unei facturi (status, dată achitare…) — apare imediat în listă; se aplică în luna în care se află. */
  const patchInvoice = useCallback((id: string, patch: Partial<InvRow>) => {
    for (const [m, sh] of shardsRef.current) {
      const i = sh.rows.findIndex((r) => r.id === id);
      if (i < 0) continue;
      const rowsNext = sh.rows.slice();
      rowsNext[i] = { ...sh.rows[i], ...patch };
      const next = { ...sh, rows: rowsNext };
      shardsRef.current.set(m, next);
      memo.set(m, next);
      publish();
      return;
    }
  }, [publish]);

  const removeInvoice = useCallback((id: string) => {
    for (const [m, sh] of shardsRef.current) {
      const i = sh.rows.findIndex((r) => r.id === id);
      if (i < 0) continue;
      const next = { ...sh, rows: sh.rows.filter((r) => r.id !== id) };
      shardsRef.current.set(m, next);
      memo.set(m, next);
      publish();
      return;
    }
  }, [publish]);

  /** Starea lunilor (pentru a o putea restaura dacă o acțiune eșuează). */
  const snapshotRows = useCallback(() => new Map(shardsRef.current), []);
  const restoreRows = useCallback((prev: Map<string, Shard>) => {
    for (const [m, sh] of prev) { shardsRef.current.set(m, sh); memo.set(m, sh); }
    publish();
  }, [publish]);
  const refresh = useCallback(() => loadAll(true), [loadAll]);

  return useMemo(
    () => ({ rows, version, loading, error, loadedAt, patchInvoice, removeInvoice, restoreRows, snapshotRows, refresh }),
    [rows, version, loading, error, loadedAt, patchInvoice, removeInvoice, restoreRows, snapshotRows, refresh],
  );
}

/** Lista lunilor cu facturi, reîmprospătată din rețea la deschiderea paginii (cea de pe server poate fi veche cu până la un minut). */
export function useInvoiceMonths(initial: MonthCount[]): MonthCount[] {
  const [months, setMonths] = useState(initial);
  useEffect(() => {
    let alive = true;
    fetch("/api/invoices/months")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { months?: MonthCount[] } | null) => {
        if (alive && j?.months) setMonths((cur) => (JSON.stringify(cur) === JSON.stringify(j.months) ? cur : j.months!));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return months;
}
