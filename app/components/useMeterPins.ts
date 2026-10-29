"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decodePins, type MeterPin, type MeterPinsResponse } from "@/lib/map-meters";
import { idbGet, idbSet } from "./usePayerDataset";

const IDB_KEY = "map-meters-v1";
const FRESH_MS = 15_000;
const POLL_MS = 60_000;

type Stored = { at: number; etag: string | null; data: MeterPinsResponse };
let memo: { at: number; etag: string | null; data: MeterPinsResponse } | null = null;

/**
 * Contoarele cu locație pentru hartă, pe 3 straturi (ca „Citiri teren”): memorie → IndexedDB (instant la redeschidere) → server (ETag → 304). Se cer abia când stratul „Contoare”
 * e activ; cât pagina e vizibilă se reîmprospătează la un minut (citirile noi schimbă culoarea punctelor).
 */
export function useMeterPins(enabled: boolean) {
  const [data, setData] = useState<MeterPinsResponse | null>(() => memo?.data ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"memory" | "idb" | "server" | null>(() => (memo ? "memory" : null));
  const inflight = useRef<Promise<void> | null>(null);

  const fetchFresh = useCallback(async () => {
    if (inflight.current) return inflight.current;
    const p = (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/harta/contoare", { headers: memo?.etag ? { "If-None-Match": memo.etag } : undefined });
        if (res.status === 304 && memo) {
          memo = { ...memo, at: Date.now() };
          return;
        }
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Eroare la încărcare.");
        const j = (await res.json()) as MeterPinsResponse;
        const at = Date.now();
        const etag = res.headers.get("etag");
        memo = { at, etag, data: j };
        setData(j);
        setSource("server");
        void idbSet(IDB_KEY, { at, etag, data: j } satisfies Stored);
      } catch (e) {
        if (typeof navigator === "undefined" || navigator.onLine) setError(e instanceof Error ? e.message : "Eroare la încărcare.");
      } finally {
        setLoading(false);
        inflight.current = null;
      }
    })();
    inflight.current = p;
    return p;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void (async () => {
      if (memo) {
        if (Date.now() - memo.at > FRESH_MS) await fetchFresh();
        return;
      }
      const stored = await idbGet<Stored>(IDB_KEY);
      if (!alive) return;
      if (stored?.data) {
        memo = { at: stored.at, etag: stored.etag, data: stored.data };
        setData(stored.data);
        setSource("idb");
        if (Date.now() - stored.at <= FRESH_MS) return;
      }
      await fetchFresh();
    })();
    const id = setInterval(() => { if (document.visibilityState === "visible") void fetchFresh(); }, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [enabled, fetchFresh]);

  const pins: MeterPin[] = useMemo(() => (data ? decodePins(data.pins) : []), [data]);
  return { data, pins, loading, error, source, refresh: fetchFresh };
}
