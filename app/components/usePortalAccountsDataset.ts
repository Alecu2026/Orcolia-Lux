"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { decodeAccount, type AccountTuple, type PortalAccountRow } from "@/lib/portal-accounts";
import { idbGet, idbSet } from "./usePayerDataset";

const IDB_KEY = "portal-accounts-v1";
const FRESH_MS = 20_000; // sub 20 s de la ultima verificare nu mai întrebăm serverul (altfel o cerere condiționată: 304 dacă nu s-a schimbat nimic)

type Stored = { at: number; etag: string | null; rows: AccountTuple[] };

/** Lista decodată, păstrată în memoria paginii: la revenire pe pagină rândurile sunt acolo din prima randare. */
let memo: { rows: PortalAccountRow[]; at: number; etag: string | null } | null = null;

/**
 * Toate conturile din portal în memoria browserului. Pagina vine cu primele rânduri randate de server (`initial`, din `total`); lista completă se aduce o singură dată
 * (comprimată, cu ETag), apoi rămâne în IndexedDB: la următoarea deschidere apare instant și se reîntreabă serverul condiționat (304 = nimic nou).
 * Filtrarea, sortarea și paginarea se fac în JS pe acest set (vezi DataTable), fără nicio interogare în baza de date.
 */
export function usePortalAccountsDataset(initial: PortalAccountRow[], total: number) {
  const [rows, setRows] = useState<PortalAccountRow[]>(() => memo?.rows ?? initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(() => !!memo || initial.length >= total);
  const etagRef = useRef<string | null>(memo?.etag ?? null);
  const inflight = useRef<Promise<void> | null>(null);

  const apply = useCallback((tuples: AccountTuple[], at: number, etag: string | null) => {
    const decoded = tuples.map(decodeAccount);
    memo = { rows: decoded, at, etag };
    setRows(decoded);
    setFull(true);
  }, []);

  const refresh = useCallback(async () => {
    if (inflight.current) return inflight.current;
    const p = (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/portal-accounts/snapshot", { headers: etagRef.current ? { "If-None-Match": etagRef.current } : undefined });
        if (res.status === 304) {
          if (memo) memo = { ...memo, at: Date.now() };
          setFull(true);
          return;
        }
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? "Eroare la încărcare.");
        const etag = res.headers.get("etag");
        etagRef.current = etag;
        const at = Date.now();
        apply(j.rows as AccountTuple[], at, etag);
        void idbSet(IDB_KEY, { at, etag, rows: j.rows } satisfies Stored);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Eroare la încărcare.");
      } finally {
        setLoading(false);
        inflight.current = null;
      }
    })();
    inflight.current = p;
    return p;
  }, [apply]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (memo && Date.now() - memo.at <= FRESH_MS) return;
      if (!memo) {
        const stored = await idbGet<Stored>(IDB_KEY);
        if (!alive) return;
        if (stored?.rows?.length) {
          etagRef.current = stored.etag;
          apply(stored.rows, stored.at, stored.etag);
        }
      }
      await refresh();
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { rows, full, loading, error, refresh };
}
