"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { decodeProjects, withCounts, type ProjectCountsPayload, type ProjectItem, type ProjectPayload } from "@/lib/projects-snapshot";
import { idbName } from "@/lib/cache-scope";

const IDB_NAME = "payers-cache"; // aceeași bază IndexedDB (un singur depozit „kv"), altă cheie
const IDB_KEY = "projects-v1";
const COUNTS_POLL_MS = 60_000;

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
    return await new Promise<T | undefined>((resolve) => {
      const r = db.transaction("kv").objectStore("kv").get(key);
      r.onsuccess = () => resolve(r.result as T | undefined);
      r.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
}
async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // fără IndexedDB: merge și fără cache local
  }
}

type Stored = { etag: string; payload: ProjectPayload };
let memo: { etag: string; rows: ProjectItem[] } | null = null; // lista decodată în această sesiune
let countsMemo: Map<string, number> | null = null;

/**
 * Toate proiectele în memoria browserului (când sunt multe și pagina a primit doar primele rânduri). `version` = versiunea curentă a listei de pe server (vine odată cu pagina): dacă lista din
 * memoria sesiunii / IndexedDB are aceeași versiune, NU se cere nimic; altfel se cere condiționat (ETag) și se salvează. Numărul de sarcini al fiecărui proiect vine separat (hartă mică,
 * validată cu ETag) și se reînnoiește la ~1 minut, ca lista mare să nu se descarce din nou la fiecare sarcină nouă.
 */
export function useProjectDataset(version: string | null): { rows: ProjectItem[] | null; loading: boolean; error: string | null } {
  const [base, setBase] = useState<ProjectItem[] | null>(() => (version && memo?.etag === version ? memo.rows : null));
  const [counts, setCounts] = useState<Map<string, number> | null>(() => countsMemo);
  const [loading, setLoading] = useState(!!version && !(memo?.etag === version));
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!version) return;
    const my = ++seq.current;
    (async () => {
      if (memo?.etag === version) { setBase(memo.rows); setLoading(false); return; }
      setLoading(true);
      setError(null);
      const st = await idbGet<Stored>(IDB_KEY);
      if (my !== seq.current) return;
      if (st?.payload?.rows && st.etag === version) {
        const dec = decodeProjects(st.payload.rows);
        memo = { etag: version, rows: dec };
        setBase(dec);
        setLoading(false);
        return;
      }
      // o versiune mai veche din IndexedDB se arată cât timp vine cea nouă
      if (st?.payload?.rows) setBase(decodeProjects(st.payload.rows));
      try {
        let res = await fetch("/api/projects/snapshot");
        // răspunsul poate veni din cache-ul HTTP al browserului (max-age scurt) și să fie mai vechi decât versiunea din pagină → o singură cerere forțată
        if (res.ok && (res.headers.get("etag") ?? "").replace(/"/g, "") !== version) res = await fetch("/api/projects/snapshot", { cache: "reload" });
        if (my !== seq.current) return;
        if (res.status === 304 && st?.payload?.rows) {
          const dec = decodeProjects(st.payload.rows);
          memo = { etag: st.etag, rows: dec };
          setBase(dec);
        } else if (res.ok) {
          const payload = (await res.json()) as ProjectPayload;
          const etag = (res.headers.get("etag") ?? "").replace(/"/g, "");
          const dec = decodeProjects(payload.rows);
          memo = { etag, rows: dec };
          setBase(dec);
          void idbSet(IDB_KEY, { etag, payload } satisfies Stored);
        } else throw new Error(String(res.status));
      } catch {
        if (my === seq.current) setError("Nu am putut încărca toate proiectele.");
      } finally {
        if (my === seq.current) setLoading(false);
      }
    })();
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- contor intern, nu un nod React
      seq.current++;
    };
  }, [version]);

  // numărul de sarcini: la fiecare vizită și apoi la ~1 minut cât fila e vizibilă (validare cu ETag → 304 când nu s-a schimbat nimic)
  useEffect(() => {
    if (!version) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/projects/counts", { cache: "no-cache" });
        if (!res.ok || !alive) return;
        const p = (await res.json()) as ProjectCountsPayload;
        const map = new Map(p.counts);
        countsMemo = map;
        setCounts(map);
      } catch {
        // rămân numerele vechi
      }
    };
    void load();
    const tick = () => { if (document.visibilityState === "visible") void load(); };
    const iv = setInterval(tick, COUNTS_POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      alive = false;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [version]);

  const rows = useMemo(() => (base ? (counts ? withCounts(base, counts) : base) : null), [base, counts]);
  return { rows, loading, error };
}
