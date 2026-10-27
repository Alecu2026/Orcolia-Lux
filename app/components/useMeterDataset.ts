"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { decodeMeters, type MeterRow, type MeterTuple } from "@/lib/meters";
import { METERS_V_COOKIE } from "@/lib/payer-prefs";
import { idbGet, idbSet } from "./usePayerDataset";

const IDB_KEY = "meters-v1";
const FRESH_MS = 20_000; // sub 20 s de la ultima verificare nu mai întrebăm serverul (altfel o cerere condiționată: 304 dacă nu s-a schimbat nimic)
const STALE_REFRESH_MS = 5 * 60_000; // la revenirea în filă, dacă datele sunt mai vechi de 5 minute, le reîmprospătăm discret

type Stored = { at: number; etag: string | null; rows: MeterTuple[] };

/** Anunță serverul ce versiune a listei avem local (cookie): dacă e cea curentă, pagina nu mai cere descărcarea ei. */
function rememberVersion(etag: string | null) {
  if (!etag) return;
  try {
    document.cookie = `${METERS_V_COOKIE}=${etag.replace(/[^0-9a-zA-Z]/g, "")}; path=/; max-age=31536000; samesite=lax`;
  } catch {}
}

/**
 * Toate contoarele în memoria browserului. Prima dată vin de pe server într-o singură cerere (compactă, gzip), apoi rămân în IndexedDB:
 * la următoarea deschidere apar instant și se reîmprospătează în fundal (cerere condiționată: 304 = nimic nou). Filtrarea/sortarea/paginarea
 * se fac în JS pe acest set (vezi filterMeters) — nicio interogare în baza de date la fiecare filtru.
 */
export function useMeterDataset(enabled: boolean) {
  const [rows, setRows] = useState<MeterRow[] | null>(null);
  const [version, setVersion] = useState(0); // crește la fiecare set nou
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const loadedAtRef = useRef<number | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const etagRef = useRef<string | null>(null);

  const apply = useCallback((tuples: MeterTuple[], at: number) => {
    setRows(decodeMeters(tuples, true));
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
        const res = await fetch("/api/contoare/snapshot", { headers: etagRef.current ? { "If-None-Match": etagRef.current } : undefined });
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
        apply(j.rows as MeterTuple[], at);
        void idbSet(IDB_KEY, { at, etag, rows: j.rows } satisfies Stored).then(() => rememberVersion(etag));
      } catch (e) {
        // Dacă avem deja date (din cache-ul local) le păstrăm; altfel pagina cade pe lista de pe server.
        setError(e instanceof Error ? e.message : "Eroare la încărcare.");
      } finally {
        setLoading(false);
        inflight.current = null;
      }
    })();
    inflight.current = p;
    return p;
  }, [apply]);

  // Pornire: întâi cache-ul local (instant), apoi, dacă e mai vechi de 20 s, versiunea proaspătă de pe server (304 dacă nu s-a schimbat nimic).
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
    }, 0); // după hidratare, fără pauză artificială
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [enabled, apply, fetchFresh]);

  // La revenirea în filă după mult timp, reîmprospătare discretă.
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === "visible" && loadedAtRef.current && Date.now() - loadedAtRef.current > STALE_REFRESH_MS) void fetchFresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, fetchFresh]);

  return { rows, version, loading, error, loadedAt, refresh: fetchFresh };
}

/**
 * Aduce lista în IndexedDB în fundal, înainte să deschidă cineva /contoare (apelată din layout, după ce pagina curentă s-a liniștit):
 * la deschidere lista e deja locală, deci „Toate" e instant chiar și prima dată. Cerere condiționată (304 = ~1 KB).
 */
export async function prefetchMeterDataset(): Promise<void> {
  try {
    const stored = await idbGet<Stored>(IDB_KEY);
    if (stored && Date.now() - stored.at < 10 * 60_000) return;
    const res = await fetch("/api/contoare/snapshot", { headers: stored?.etag ? { "If-None-Match": stored.etag } : undefined });
    if (res.status === 304 && stored) {
      await idbSet(IDB_KEY, { ...stored, at: Date.now() } satisfies Stored);
      rememberVersion(stored.etag);
      return;
    }
    if (!res.ok) return;
    const j = await res.json();
    const etag = res.headers.get("etag");
    await idbSet(IDB_KEY, { at: Date.now(), etag, rows: j.rows } satisfies Stored);
    rememberVersion(etag);
  } catch {
    // fără rețea / IndexedDB: nu e grav, pagina o aduce la deschidere
  }
}
