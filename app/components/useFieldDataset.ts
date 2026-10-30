"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { currentPeriod, dayOf, decodeField, fieldConsum, type FieldRow, type FieldTuple } from "@/lib/meter-readings";
import type { RouteDto } from "@/lib/meter-routes";
import { idbGet, idbSet } from "./usePayerDataset";

const IDB_KEY = "field-v1";
const FRESH_MS = 15_000; // sub 15 s de la ultima verificare nu mai întrebăm serverul
const POLL_MS = 2 * 60_000; // cât timp pagina e vizibilă, la 2 minute vedem ce au mai citit colegii (cerere condiționată: 304 dacă nu s-a schimbat nimic)

type Stored = { at: number; etag: string | null; period: string; rows: FieldTuple[]; routes?: RouteDto[] };
type Memo = { rows: FieldRow[]; tuples: FieldTuple[]; period: string; at: number; etag: string | null; routes: RouteDto[] };

/** Lista decodată, păstrată cât timp aplicația rămâne deschisă: la întoarcerea în pagină apare din prima randare, fără IndexedDB și fără decodare. */
let memo: Memo | null = null;

/** Ce se schimbă pe un rând când se salvează o citire. */
export type FieldPatch = { value: number; readAt: number; photo: boolean; by?: string | null; portal?: boolean; distanceM?: number | null; geo?: boolean; issue?: string | null; address?: string | null; lat?: number | null; lng?: number | null; addrField?: boolean; locAcc?: number | null; avg?: number | null };

/**
 * Lista „Citiri teren” în memoria browserului: întâi din IndexedDB (instant, doar dacă e din luna curentă), apoi reîmprospătată de pe server în fundal
 * (ETag → 304 când nu s-a citit nimic nou). Filtrarea, sortarea și paginarea se fac în JS pe această listă — nicio interogare la fiecare filtru.
 */
export function useFieldDataset() {
  const [data, setData] = useState<{ period: string; rows: FieldRow[] } | null>(() => (memo ? { period: memo.period, rows: memo.rows } : null));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(() => memo?.at ?? null);
  const [routes, setRoutes] = useState<RouteDto[]>(() => memo?.routes ?? []);
  const inflight = useRef<Promise<void> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = useCallback((tuples: FieldTuple[], period: string, at: number, etag: string | null, rt: RouteDto[]) => {
    const rows = decodeField(tuples);
    memo = { rows, tuples, period, at, etag, routes: rt };
    setData({ period, rows });
    setRoutes(rt);
    setLoadedAt(at);
  }, []);

  const fetchFresh = useCallback(async () => {
    if (inflight.current) return inflight.current;
    const p = (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/contoare/teren", { headers: memo?.etag ? { "If-None-Match": memo.etag } : undefined });
        if (res.status === 304 && memo) {
          const at = Date.now();
          memo = { ...memo, at };
          setLoadedAt(at);
          return;
        }
        const j = (await res.json()) as { period?: string; rows?: FieldTuple[]; routes?: RouteDto[]; error?: string };
        if (!res.ok || !j.rows || !j.period) throw new Error(j.error ?? "Eroare la încărcare.");
        const at = Date.now();
        const etag = res.headers.get("etag");
        apply(j.rows, j.period, at, etag, j.routes ?? []);
        void idbSet(IDB_KEY, { at, etag, period: j.period, rows: j.rows, routes: j.routes ?? [] } satisfies Stored);
      } catch (e) {
        // Dacă avem deja date (din memorie / cache-ul local) le păstrăm. Fără internet nu e o eroare: lucrăm cu lista descărcată (banner „Fără internet”).
        if (typeof navigator === "undefined" || navigator.onLine) setError(e instanceof Error ? e.message : "Eroare la încărcare.");
      } finally {
        setLoading(false);
        inflight.current = null;
      }
    })();
    inflight.current = p;
    return p;
  }, [apply]);

  // Pornire: memoria paginii → IndexedDB (doar luna curentă) → server.
  useEffect(() => {
    let alive = true;
    void (async () => {
      if (memo) {
        if (Date.now() - memo.at > FRESH_MS) await fetchFresh();
        return;
      }
      const stored = await idbGet<Stored>(IDB_KEY);
      if (!alive) return;
      if (stored?.rows?.length && stored.period === currentPeriod()) {
        apply(stored.rows, stored.period, stored.at, stored.etag, stored.routes ?? []);
        if (Date.now() - stored.at <= FRESH_MS) return;
      }
      await fetchFresh();
    })();
    return () => {
      alive = false;
    };
  }, [apply, fetchFresh]);

  // Colegii citesc în același timp: la revenirea în filă și la fiecare 2 minute cât pagina e vizibilă, lista se reîmprospătează discret.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible" && memo && Date.now() - memo.at > FRESH_MS) void fetchFresh();
    };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [fetchFresh]);

  /** După o citire salvată: rândul se actualizează pe loc (și în memorie / IndexedDB), fără să se reia lista. */
  const patchRow = useCallback((id: string, patch: Partial<FieldPatch>) => {
    if (!memo) return;
    const i = memo.rows.findIndex((r) => r.id === id);
    if (i < 0) return;
    const old = memo.rows[i];
    const value = patch.value ?? old.value;
    const next: FieldRow = {
      ...old,
      value,
      readAt: patch.readAt ?? old.readAt,
      photo: patch.photo ?? old.photo,
      by: patch.by !== undefined ? patch.by : old.by,
      portal: patch.portal !== undefined ? patch.portal : old.portal,
      distanceM: patch.distanceM !== undefined ? patch.distanceM : old.distanceM,
      consum: fieldConsum(value, old.lastIndex),
      avg: patch.avg !== undefined ? patch.avg : old.avg,
      geo: patch.geo ?? old.geo,
      issue: patch.issue !== undefined ? patch.issue : old.issue,
      address: patch.address !== undefined ? patch.address : old.address,
      lat: patch.lat !== undefined ? patch.lat : old.lat,
      lng: patch.lng !== undefined ? patch.lng : old.lng,
      addrField: patch.addrField ?? old.addrField,
      locAcc: patch.locAcc !== undefined ? patch.locAcc : old.locAcc,
      _day: (patch.readAt ?? old.readAt) != null ? dayOf((patch.readAt ?? old.readAt) as number) : null,
    };
    const rows = memo.rows.slice();
    rows[i] = next;
    const tuples = memo.tuples.slice();
    const tu = tuples[i].slice() as FieldTuple;
    tu[6] = next.value;
    tu[7] = next.readAt;
    tu[8] = next.photo ? 1 : 0;
    tu[9] = next.by;
    tu[10] = next.distanceM;
    tu[11] = next.geo ? 1 : 0;
    tu[3] = next.address;
    tu[12] = next.lat;
    tu[13] = next.lng;
    tu[14] = next.addrField ? 1 : 0;
    tu[15] = next.locAcc;
    tu[17] = next.issue;
    tu[19] = next.avg;
    tuples[i] = tu;
    // ETag-ul vechi nu mai descrie lista locală: la următoarea verificare serverul trimite lista întreagă (sigur corectă).
    memo = { ...memo, rows, tuples, etag: null };
    setData({ period: memo.period, rows });
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (memo) void idbSet(IDB_KEY, { at: memo.at, etag: null, period: memo.period, rows: memo.tuples, routes: memo.routes } satisfies Stored);
    }, 600);
  }, []);

  return { data, routes, loading, error, loadedAt, refresh: fetchFresh, patchRow };
}
