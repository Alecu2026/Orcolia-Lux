"use client";

import { useEffect, useRef, useState } from "react";
import { decodeTasks, type DecodedTask, type TaskDatasetPayload } from "@/lib/task-dataset";

const IDB_NAME = "tasks-cache";
const REFRESH_AFTER_MS = 60_000; // la revenirea în filă, dacă ultima verificare e mai veche, întrebăm serverul (304 = ieftin)

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
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
    // fără IndexedDB (mod privat etc.): merge și fără cache local
  }
}

type Stored = { etag: string | null; data: TaskDatasetPayload };

/**
 * Lista COMPLETĂ de task-uri / tichete din „scope", în memoria browserului (doar când pagina a primit din HTML doar primele rânduri).
 * Prima dată vine într-o singură cerere compactă (gzip), apoi stă în IndexedDB: la următoarea deschidere serverul doar confirmă (ETag → 304,
 * fără descărcare) și lista se decodifică din cache-ul local. Nu se arată NICIODATĂ lista veche înainte de confirmare (altfel o modificare
 * făcută între timp ar apărea o clipă cu valorile vechi). Cât timp nu e gata, `rows` e null și tabelul arată rândurile din HTML.
 */
export function useTaskDataset(opts: { enabled: boolean; kind: "TASK" | "TICKET"; scope: string; userId?: string }) {
  const { enabled, kind, scope, userId } = opts;
  const keyNow = `${kind}:${scope}:${userId ?? ""}`;
  // Rândurile păstrează cheia lor (tip + scop + utilizator): la schimbarea tab-ului „Ale mele / Toate" lista veche nu se mai întoarce.
  const [data, setData] = useState<{ key: string; rows: DecodedTask[] } | null>(null);
  const [errKey, setErrKey] = useState<string | null>(null);
  const rows = data?.key === keyNow ? data.rows : null;
  const error = errKey === keyNow;
  const etagRef = useRef<string | null>(null);
  const checkedAt = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    etagRef.current = null; // altă cheie (scop / tip) = altă listă: nu trimitem ETag-ul celei vechi
    checkedAt.current = 0;
    const idbKey = keyNow;
    const url = `/api/tasks/dataset?kind=${kind === "TICKET" ? "ticket" : "task"}&scope=${encodeURIComponent(scope)}`;

    let local: Stored | undefined;

    async function fetchFresh() {
      try {
        const res = await fetch(url, { headers: etagRef.current ? { "If-None-Match": etagRef.current } : undefined });
        checkedAt.current = Date.now();
        if (res.status === 304) {
          // Aceeași versiune ca în IndexedDB: o decodificăm acum (o singură dată).
          if (local && alive) {
            const decoded = decodeTasks(local.data.rows, local.data.names);
            local = undefined;
            setData({ key: idbKey, rows: decoded });
            setErrKey(null);
          }
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as TaskDatasetPayload;
        const etag = res.headers.get("etag");
        etagRef.current = etag;
        if (!alive) return;
        setData({ key: idbKey, rows: decodeTasks(data.rows, data.names) });
        setErrKey(null);
        void idbSet(idbKey, { etag, data } satisfies Stored);
      } catch {
        // Fără rețea / server căzut: folosim lista din cache-ul local (poate fi veche, dar mai bună decât doar primele rânduri).
        if (alive && local) {
          setData({ key: idbKey, rows: decodeTasks(local.data.rows, local.data.names) });
          local = undefined;
        } else if (alive && etagRef.current === null) setErrKey(idbKey);
      }
    }

    (async () => {
      const stored = await idbGet<Stored>(idbKey);
      if (!alive) return;
      if (stored?.data?.v === 1 && stored.etag) {
        local = stored;
        etagRef.current = stored.etag;
      }
      await fetchFresh();
    })();

    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - checkedAt.current > REFRESH_AFTER_MS) void fetchFresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, kind, scope, userId, keyNow]);

  return { rows, error };
}
