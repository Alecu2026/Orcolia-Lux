"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { decodeIssueRows, type IssueRow } from "@/lib/meter-issue-register";
import type { IssueDto, IssueRegisterRow } from "@/lib/meter-issues";
import { idbGet, idbSet } from "./usePayerDataset";

const IDB_KEY = "meter-issues-v1";
const FRESH_MS = 20_000; // sub 20 s de la ultima verificare nu mai întrebăm serverul (altfel o cerere condiționată: 304 dacă nu s-a schimbat nimic)

type Stored = { at: number; etag: string | null; rows: IssueRegisterRow[] };

/** Registrul decodat, păstrat în memoria paginii: la revenire pe pagină lista e acolo din prima randare. */
let memo: { raw: IssueRegisterRow[]; rows: IssueRow[]; at: number; etag: string | null } | null = null;

/**
 * Toate neregulile în memoria browserului. Pornește din ce a randat serverul (`initial`), apoi din IndexedDB, și se reîntreabă serverul condiționat (ETag → 304 =
 * nimic nou). Editările și rezolvările se aplică imediat local (`patch`), fără să aștepte o nouă descărcare.
 */
export function useIssueDataset(initial: IssueRegisterRow[]) {
  const [raw, setRaw] = useState<IssueRegisterRow[]>(() => memo?.raw ?? initial);
  const [rows, setRows] = useState<IssueRow[]>(() => memo?.rows ?? decodeIssueRows(initial));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const etagRef = useRef<string | null>(memo?.etag ?? null);
  const inflight = useRef<Promise<void> | null>(null);
  const [canManage, setCanManage] = useState<boolean | null>(null);
  /** Accesul pe secție (vezi lib/meter-issue-access.ts): `restricted` = vede doar neregulile secțiilor lui (`ownTeamIds`). */
  const [scope, setScope] = useState<{ restricted: boolean; ownTeamIds: string[] } | null>(null);
  const rawRef = useRef<IssueRegisterRow[]>(raw);

  const apply = useCallback((next: IssueRegisterRow[], at: number, etag: string | null) => {
    const decoded = decodeIssueRows(next);
    memo = { raw: next, rows: decoded, at, etag };
    rawRef.current = next;
    setRaw(next);
    setRows(decoded);
  }, []);

  const refresh = useCallback(async () => {
    if (inflight.current) return inflight.current;
    const p = (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/contoare/nereguli", { headers: etagRef.current ? { "If-None-Match": etagRef.current } : undefined });
        if (res.status === 304) {
          if (memo) memo = { ...memo, at: Date.now() };
          return;
        }
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? "Eroare la încărcare.");
        const etag = res.headers.get("etag");
        etagRef.current = etag;
        const at = Date.now();
        apply(j.rows as IssueRegisterRow[], at, etag);
        setCanManage(!!j.canManage);
        setScope({ restricted: !!j.restricted, ownTeamIds: Array.isArray(j.ownTeamIds) ? (j.ownTeamIds as string[]) : [] });
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
        // randarea de pe server e mai proaspătă decât un cache vechi din browser: IndexedDB doar acoperă cazul fără date de la server
        if (stored?.rows?.length && initial.length === 0) {
          etagRef.current = stored.etag;
          apply(stored.rows, stored.at, stored.etag);
        }
      }
      await refresh();
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Aplică local o neregulă modificată / rezolvată și marchează lista locală ca depășită (următoarea descărcare o confirmă). */
  const patch = useCallback((id: string, change: Partial<IssueDto>) => {
    const next = rawRef.current.map((r) => (r.id === id ? { ...r, ...change } : r));
    const decoded = decodeIssueRows(next);
    memo = { raw: next, rows: decoded, at: 0, etag: null };
    rawRef.current = next;
    etagRef.current = null;
    setRaw(next);
    setRows(decoded);
    void idbSet(IDB_KEY, { at: 0, etag: null, rows: next } satisfies Stored);
  }, []);

  return { rows, raw, loading, error, refresh, patch, canManage, scope };
}
