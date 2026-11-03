"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { OneCPayload, OneCTuple } from "@/lib/onec-table";
import { ONEC_V_COOKIE } from "@/lib/payer-prefs";
import { idbGet, idbSet } from "./usePayerDataset";

const FRESH_MS = 20_000; // sub 20 s de la ultima verificare nu mai întrebăm serverul (altfel o cerere condiționată: 304 dacă nu s-a schimbat nimic)

type Stored = { at: number; etag: string | null; rows: OneCTuple[]; months: OneCPayload["months"] };
type Entry = { rows: OneCTuple[]; months: OneCPayload["months"]; at: number; etag: string | null };

/** Listele decodate, pe perioadă, păstrate în memoria paginii: la revenire pe pagină (sau la întoarcerea la o perioadă) rândurile sunt acolo imediat. */
const memo = new Map<string, Entry>();

/** Anunță serverului ce versiune a listei „latest” avem local (cookie): dacă e cea curentă, pagina nu mai cere descărcarea ei din timp. */
function rememberVersion(period: string, etag: string | null) {
  if (period !== "latest" || !etag) return;
  try {
    document.cookie = `${ONEC_V_COOKIE}=${etag.replace(/[^0-9a-zA-Z]/g, "")}; path=/; max-age=31536000; samesite=lax`;
  } catch {}
}

/**
 * Tabelul 1C în memoria browserului, pe perioadă („latest” sau „YYYY-MM”; null = „Toate lunile”, care rămâne pe server). Prima dată vine într-o singură cerere (compactă, gzip),
 * apoi rămâne în IndexedDB: la următoarea deschidere apare instant și se reîntreabă serverul condiționat (304 = nimic nou). Filtrarea / sortarea / paginarea rulează local (vezi filterOneC).
 */
export function useOneCDataset(period: string | null) {
  const [entry, setEntry] = useState<Entry | null>(() => (period ? (memo.get(period) ?? null) : null));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef<Map<string, Promise<void>>>(new Map());
  const [months, setMonths] = useState<OneCPayload["months"]>(() => (period ? (memo.get(period)?.months ?? []) : []));

  const apply = useCallback((per: string, rows: OneCTuple[], mo: OneCPayload["months"], at: number, etag: string | null) => {
    const e: Entry = { rows, months: mo, at, etag };
    memo.set(per, e);
    setEntry((cur) => cur ?? e);
    setMonths(mo);
    return e;
  }, []);

  const refresh = useCallback(
    async (per: string) => {
      const ex = inflight.current.get(per);
      if (ex) return ex;
      const p = (async () => {
        setLoading(true);
        setError(null);
        try {
          const etag0 = memo.get(per)?.etag ?? null;
          const res = await fetch(`/api/platitori/tabel/snapshot?period=${encodeURIComponent(per)}`, { headers: etag0 ? { "If-None-Match": etag0 } : undefined });
          if (res.status === 304) {
            const cur = memo.get(per);
            if (cur) memo.set(per, { ...cur, at: Date.now() });
            rememberVersion(per, etag0);
            return;
          }
          // la depășirea timpului serverul întoarce HTML, nu JSON: mesaj clar în loc de „Unexpected token…”
          const j = (await res.json().catch(() => null)) as { error?: string; rows?: OneCTuple[]; months?: OneCPayload["months"] } | null;
          if (!res.ok || !j?.rows) throw new Error(j?.error ?? (res.ok ? "Răspuns incomplet de la server. Reîncearcă." : "Serverul nu a răspuns la timp. Reîncearcă în câteva secunde (prima încărcare durează mai mult)."));
          const etag = res.headers.get("etag");
          const at = Date.now();
          const e: Entry = { rows: j.rows as OneCTuple[], months: j.months ?? [], at, etag };
          memo.set(per, e);
          setEntry(e);
          setMonths(e.months);
          void idbSet(`onec-v1-${per}`, { at, etag, rows: e.rows, months: e.months } satisfies Stored).then(() => rememberVersion(per, etag));
        } catch (err) {
          setError(err instanceof Error ? err.message : "Eroare la încărcare.");
        } finally {
          setLoading(false);
          inflight.current.delete(per);
        }
      })();
      inflight.current.set(per, p);
      return p;
    },
    [],
  );

  useEffect(() => {
    if (!period) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- inițializare / resetare declanșată de schimbarea dependențelor (nu se poate deriva în randare)
    setEntry(memo.get(period) ?? null);
    setMonths((m) => memo.get(period)?.months ?? m);
    setError(null);
    void (async () => {
      const cur = memo.get(period);
      if (cur && Date.now() - cur.at <= FRESH_MS) return;
      if (!cur) {
        const stored = await idbGet<Stored>(`onec-v1-${period}`);
        if (!alive) return;
        if (stored?.rows?.length) {
          const e = apply(period, stored.rows, stored.months ?? [], stored.at, stored.etag);
          setEntry(e);
          rememberVersion(period, stored.etag);
          if (Date.now() - stored.at <= FRESH_MS) return;
        }
      }
      if (alive) await refresh(period);
    })();
    return () => {
      alive = false;
    };
  }, [period, apply, refresh]);

  return { rows: entry?.rows ?? null, months, loading, error, refresh: () => (period ? refresh(period) : Promise.resolve()) };
}
