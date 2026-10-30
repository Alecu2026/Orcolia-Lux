"use client";

import { useEffect, useRef, useState } from "react";
import { decodeTasks, type DecodedTask, type TaskDatasetPayload } from "@/lib/task-dataset";

import { idbName } from "@/lib/cache-scope";

const IDB_NAME = "tasks-cache";
const REFRESH_AFTER_MS = 60_000; // la revenirea în filă, dacă ultima verificare e mai veche, întrebăm serverul (304 = ieftin)

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
    // fără IndexedDB (mod privat etc.): merge și fără cache local
  }
}

type Stored = { etag: string | null; data: TaskDatasetPayload };

/**
 * Stratul 3: lista deja decodificată, păstrată în memoria paginii cât timp aplicația rămâne deschisă (la întoarcerea în Kanban / Sarcini nu se mai citește IndexedDB și
 * nu se mai decodifică zeci de mii de rânduri). Se folosește DOAR după ce serverul confirmă (ETag → 304), ca și lista din IndexedDB: nu se arată niciodată una veche.
 */
const memo = new Map<string, { etag: string; rows: DecodedTask[] }>();
const MEMO_MAX = 6;
function remember(key: string, etag: string | null, rows: DecodedTask[]) {
  if (!etag) return;
  memo.delete(key);
  memo.set(key, { etag, rows });
  while (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value as string);
}

/**
 * Lista COMPLETĂ de task-uri / tichete din „scope", în memoria browserului (doar când pagina a primit din HTML doar primele rânduri).
 * Prima dată vine într-o singură cerere compactă (gzip), apoi stă în IndexedDB: la următoarea deschidere serverul doar confirmă (ETag → 304,
 * fără descărcare) și lista se decodifică din cache-ul local. Nu se arată NICIODATĂ lista veche înainte de confirmare (altfel o modificare
 * făcută între timp ar apărea o clipă cu valorile vechi). Cât timp nu e gata, `rows` e null și tabelul arată rândurile din HTML.
 */
export function useTaskDataset(opts: { enabled: boolean; kind: "TASK" | "TICKET" | "KANBAN"; scope: string; userId?: string }) {
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
    const url = `/api/tasks/dataset?kind=${kind === "TICKET" ? "ticket" : kind === "KANBAN" ? "kanban" : "task"}&scope=${encodeURIComponent(scope)}`;

    let local: Stored | undefined;
    const mem = memo.get(idbKey);

    /** true = lista a fost pusă (304 confirmat sau listă nouă); false = nu (eroare / fără listă locală încă). */
    async function fetchFresh(): Promise<boolean> {
      try {
        const res = await fetch(url, { headers: etagRef.current ? { "If-None-Match": etagRef.current } : undefined });
        checkedAt.current = Date.now();
        if (res.status === 304) {
          // Aceeași versiune ca în memoria paginii: o refolosim direct (fără IndexedDB, fără decodificare).
          if (mem && etagRef.current === mem.etag && alive) {
            setData({ key: idbKey, rows: mem.rows });
            setErrKey(null);
            return true;
          }
          // Aceeași versiune ca în IndexedDB: o decodificăm acum (o singură dată).
          if (local && alive) {
            const decoded = decodeTasks(local.data.rows, local.data.names);
            local = undefined;
            remember(idbKey, etagRef.current, decoded);
            setData({ key: idbKey, rows: decoded });
            setErrKey(null);
            return true;
          }
          return false;
        }
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as TaskDatasetPayload;
        const etag = res.headers.get("etag");
        etagRef.current = etag;
        if (!alive) return false;
        const decoded = decodeTasks(data.rows, data.names);
        remember(idbKey, etag, decoded);
        setData({ key: idbKey, rows: decoded });
        setErrKey(null);
        void idbSet(idbKey, { etag, data } satisfies Stored);
        return true;
      } catch {
        // Fără rețea / server căzut: folosim lista din cache-ul local (poate fi veche, dar mai bună decât doar primele rânduri).
        if (alive && mem && !local) {
          setData({ key: idbKey, rows: mem.rows });
          return true;
        }
        if (alive && local) {
          setData({ key: idbKey, rows: decodeTasks(local.data.rows, local.data.names) });
          local = undefined;
          return true;
        } else if (alive && etagRef.current === null) setErrKey(idbKey);
      }
      return false;
    }

    (async () => {
      if (mem) {
        // lista din memorie: întrebăm serverul cu ETag-ul ei; la 304 apare imediat
        etagRef.current = mem.etag;
        if ((await fetchFresh()) || !alive) return;
        etagRef.current = null;
      }
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
