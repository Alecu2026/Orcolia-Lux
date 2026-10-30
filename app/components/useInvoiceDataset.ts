"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { decodeInvoices, type InvRow, type InvTuple } from "@/lib/invoice-list";
import { INVOICES_V_COOKIE } from "@/lib/payer-prefs";
import { idbName } from "@/lib/cache-scope";

const IDB_NAME = "payers-cache"; // aceeași bază IndexedDB ca la plătitori (un singur depozit „kv"), alt cheie
const IDB_KEY = "invoices-v1";
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

function rememberVersion(etag: string | null) {
  if (!etag) return;
  try {
    document.cookie = `${INVOICES_V_COOKIE}=${etag.replace(/[^0-9a-zA-Z]/g, "")}; path=/; max-age=31536000; samesite=lax`;
  } catch {}
}

/** Aduce lista în IndexedDB în fundal, înainte să deschidă cineva /invoices (apelată din layout). Cerere condiționată: 304 = ~1 KB. */
export async function prefetchInvoiceDataset(): Promise<void> {
  try {
    const stored = await idbGet<Stored>(IDB_KEY);
    if (stored && Date.now() - stored.at < 10 * 60_000) return;
    const res = await fetch("/api/invoices/snapshot", { headers: stored?.etag ? { "If-None-Match": stored.etag } : undefined });
    if (res.status === 304 && stored) {
      await idbSet(IDB_KEY, { ...stored, at: Date.now() } satisfies Stored);
      rememberVersion(stored.etag);
      return;
    }
    if (!res.ok) return;
    const j = (await res.json()) as { mode?: string; rows?: InvTuple[] };
    if (j.mode === "server" || !j.rows) return; // prea multe facturi: nu se ține local
    const etag = res.headers.get("etag");
    await idbSet(IDB_KEY, { at: Date.now(), etag, rows: j.rows } satisfies Stored);
    rememberVersion(etag);
  } catch {
    // fără rețea / IndexedDB: nu e grav
  }
}

/**
 * Toate facturile în memoria browserului (când nu sunt prea multe): filtrate/paginate local, instant. Din IndexedDB la deschidere, apoi validare
 * condiționată (ETag). \`mode === "server"\` = prea multe facturi pentru browser: lista se aduce pagină cu pagină de pe server.
 */
export function useInvoiceDataset(enabled: boolean) {
  const rowsRef = useRef<InvRow[] | null>(null);
  const [rows, setRows] = useState<InvRow[] | null>(null);
  const [mode, setMode] = useState<"snapshot" | "server" | null>(null);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const loadedAtRef = useRef<number | null>(null);
  const etagRef = useRef<string | null>(null);
  const inflight = useRef<Promise<void> | null>(null);

  const apply = useCallback((tuples: InvTuple[], at: number) => {
    const decoded = decodeInvoices(tuples);
    rowsRef.current = decoded;
    setRows(decoded);
    setMode("snapshot");
    loadedAtRef.current = at;
    setLoadedAt(at);
    setVersion((v) => v + 1);
  }, []);

  const fetchFresh = useCallback(async () => {
    if (inflight.current) return inflight.current;
    const p = (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/invoices/snapshot", { headers: etagRef.current ? { "If-None-Match": etagRef.current } : undefined });
        if (res.status === 304) {
          const at = Date.now();
          loadedAtRef.current = at;
          setLoadedAt(at);
          rememberVersion(etagRef.current);
          return;
        }
        if (!res.ok) return;
        const j = (await res.json()) as { mode?: string; rows?: InvTuple[] };
        const at = Date.now();
        if (j.mode === "server" || !j.rows) {
          setMode("server");
          return;
        }
        const etag = res.headers.get("etag");
        etagRef.current = etag;
        apply(j.rows, at);
        void idbSet(IDB_KEY, { at, etag, rows: j.rows } satisfies Stored).then(() => rememberVersion(etag));
      } catch {
        // rămâne ce avem; interfața folosește lista de pe server
      } finally {
        setLoading(false);
        inflight.current = null;
      }
    })();
    inflight.current = p;
    return p;
  }, [apply]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const id = setTimeout(() => {
      void (async () => {
        const stored = await idbGet<Stored>(IDB_KEY);
        if (!alive) return;
        if (stored?.rows?.length) {
          etagRef.current = stored.etag;
          apply(stored.rows, stored.at);
          rememberVersion(stored.etag);
        }
        if (!stored || Date.now() - stored.at > FRESH_MS) await fetchFresh();
      })();
    }, 0);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [enabled, apply, fetchFresh]);

  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === "visible" && loadedAtRef.current && Date.now() - loadedAtRef.current > 5 * 60_000) void fetchFresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, fetchFresh]);

  /** Modificare locală a unei facturi (status, dată achitare…) — apare imediat în listă. */
  const patchInvoice = useCallback((id: string, patch: Partial<InvRow>) => {
    const cur = rowsRef.current;
    if (!cur) return;
    const next = cur.map((r) => (r.id === id ? { ...r, ...patch } : r));
    rowsRef.current = next;
    setRows(next);
    setVersion((v) => v + 1);
  }, []);

  const removeInvoice = useCallback((id: string) => {
    const cur = rowsRef.current;
    if (!cur) return;
    const next = cur.filter((r) => r.id !== id);
    rowsRef.current = next;
    setRows(next);
    setVersion((v) => v + 1);
  }, []);

  const restoreRows = useCallback((prev: InvRow[]) => {
    rowsRef.current = prev;
    setRows(prev);
    setVersion((v) => v + 1);
  }, []);

  const snapshotRows = useCallback(() => rowsRef.current, []);
  const refresh = useCallback(() => fetchFresh(), [fetchFresh]);

  return { rows, mode, version, loading, loadedAt, patchInvoice, removeInvoice, restoreRows, snapshotRows, refresh };
}
