"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PBX_DATASET_MAX, type PbxKind, type PbxPayload } from "@/lib/pbx-data";
import { idbName } from "@/lib/cache-scope";

const IDB_NAME = "payers-cache"; // aceeași bază IndexedDB (un singur depozit „kv"), alte chei
const POLL_MS = 20_000;
const MAX_STORED_AGE_MS = 7 * 24 * 3600_000; // un set mai vechi de o săptămână nu se mai completează cu diferența: se ia din nou întreg

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

type Tuple = [string, ...unknown[]];
type Stored = { cursor: number; savedAt: number; rows: Tuple[] };
type Mem = { tuples: Map<string, Tuple>; cursor: number; count: number };
const memo: Partial<Record<PbxKind, Mem>> = {}; // în această sesiune de pagină: revenirea pe /pbx nu cere nimic înainte de diferență

/**
 * Lista completă a apelurilor (sau a cozii de apeluri) în browser: din memorie / IndexedDB, completată la fiecare ~20 s cu DOAR rândurile modificate de la ultima sincronizare.
 * `head` = primele rânduri primite odată cu pagina (se afișează până sosește lista). Dacă numărul de rânduri din bază nu mai corespunde (ștergeri făcute în altă parte) sau sunt prea multe
 * schimbări, se cere lista completă.
 */
export function usePbxDataset<T extends { id: string }>(kind: PbxKind, head: T[], decode: (t: never) => T) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const api = useRef<{ sync: (full?: boolean) => Promise<void>; remove: (id: string) => void }>({ sync: async () => {}, remove: () => {} });
  const decodeRef = useRef(decode);
  useEffect(() => {
    decodeRef.current = decode;
  });

  useEffect(() => {
    let alive = true;
    let busy: Promise<void> | null = null;
    let again: { full: boolean } | null = null;
    let lastFull = 0;
    let loadedOnce = false;
    let changed = false; // s-a schimbat ceva de la ultima publicare (altfel tabelul nu se recalculează degeaba)
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const key = `pbx-${kind}-v1`;
    const rowMap = new Map<string, T>();
    let m: Mem = memo[kind] ?? { tuples: new Map(), cursor: 0, count: -1 };
    const dec = (t: Tuple) => (decodeRef.current as unknown as (t: Tuple) => T)(t);

    const publish = () => {
      if (alive) setRows(Array.from(rowMap.values()));
    };
    const persist = () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        void idbSet(key, { cursor: m.cursor, savedAt: Date.now(), rows: Array.from(m.tuples.values()) } satisfies Stored);
      }, 4000);
    };
    const load = (p: PbxPayload<Tuple>) => {
      m = { tuples: new Map(p.rows.map((t) => [t[0], t] as const)), cursor: p.cursor, count: p.count };
      memo[kind] = m;
      rowMap.clear();
      for (const t of p.rows) rowMap.set(t[0], dec(t));
    };

    async function fetchFull(fresh: boolean) {
      const res = await fetch(`/api/pbx/calls?kind=${kind}${fresh ? "&fresh=1" : ""}`, fresh ? { cache: "reload" } : undefined);
      if (!res.ok) throw new Error(String(res.status));
      // răspunsul poate veni din cache-ul HTTP al browserului (max-age scurt): nu contează, diferența de după el corectează
      const p = (await res.json()) as PbxPayload<Tuple>;
      load(p);
      lastFull = Date.now();
      persist();
      changed = true;
    }

    async function run(full: boolean) {
      if (full || !m.cursor) await fetchFull(full);
      // diferența: câteva rânduri, nu lista; și imediat după lista completă (poate fi mai veche de câteva minute pe server)
      const res = await fetch(`/api/pbx/calls?kind=${kind}&since=${m.cursor}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as PbxPayload<Tuple>;
      if (d.reset) {
        await fetchFull(true);
        return;
      }
      for (const t of d.rows) {
        m.tuples.set(t[0], t);
        rowMap.set(t[0], dec(t));
      }
      m.cursor = d.cursor;
      m.count = d.count;
      if (d.rows.length > 0) {
        persist();
        changed = true;
      }
      // numărul din bază nu corespunde (rânduri șterse în altă parte): lista completă, cel mult o dată pe minut
      if (d.count >= 0 && d.count <= PBX_DATASET_MAX && m.tuples.size !== d.count && Date.now() - lastFull > 60_000) {
        await fetchFull(true);
        return;
      }
    }

    function sync(full = false): Promise<void> {
      if (busy) {
        again = { full: full || !!again?.full };
        return busy;
      }
      busy = run(full)
        .then(() => {
          if (alive) {
            if (changed || !loadedOnce) publish();
            loadedOnce = true;
            changed = false;
            setLoading(false);
            setError(null);
          }
        })
        .catch(() => {
          if (alive) {
            setLoading(false);
            setError("Nu am putut actualiza lista de apeluri.");
          }
        })
        .finally(() => {
          busy = null;
          const next = again;
          again = null;
          if (alive && next) void sync(next.full);
        });
      return busy;
    }

    api.current = {
      sync,
      remove: (id) => {
        m.tuples.delete(id);
        rowMap.delete(id);
        if (m.count > 0) m.count -= 1;
        publish();
        persist();
      },
    };

    (async () => {
      if (memo[kind]) {
        // revenire pe pagină în aceeași sesiune: lista din memorie apare imediat
        m = memo[kind]!;
        for (const t of m.tuples.values()) rowMap.set(t[0], dec(t));
        publish();
        setLoading(false);
      } else {
        const st = await idbGet<Stored>(key);
        if (!alive) return;
        if (st?.rows && Date.now() - st.savedAt < MAX_STORED_AGE_MS) {
          m = { tuples: new Map(st.rows.map((t) => [t[0], t] as const)), cursor: st.cursor, count: -1 };
          memo[kind] = m;
          for (const t of st.rows) rowMap.set(t[0], dec(t));
          publish();
          setLoading(false);
        }
      }
      await sync();
    })();

    const tick = () => {
      if (document.visibilityState === "visible") void sync();
    };
    const iv = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      alive = false;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", tick);
      if (saveTimer) clearTimeout(saveTimer);
    };
  }, [kind]);

  const refresh = useCallback((full = false) => api.current.sync(full), []);
  const remove = useCallback((id: string) => api.current.remove(id), []);
  return { rows: rows ?? head, ready: rows !== null, loading, error, refresh, remove };
}
