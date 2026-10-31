"use client";

import { useEffect, useRef, useState } from "react";
import { decodeClients, type ClientPayload, type ClientRow } from "@/lib/clients-snapshot";
import { CLIENTS_V_COOKIE } from "@/lib/payer-prefs";
import { idbName } from "@/lib/cache-scope";

const IDB_NAME = "payers-cache"; // aceeași bază IndexedDB (un singur depozit „kv"), altă cheie
const IDB_KEY = "clients-v1";

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

type Stored = { etag: string; payload: ClientPayload };
let memo: { etag: string; rows: ClientRow[] } | null = null; // lista decodată în această sesiune

function rememberVersion(etag: string) {
  try {
    document.cookie = `${CLIENTS_V_COOKIE}=${etag.replace(/[^0-9a-zA-Z]/g, "")}; path=/; max-age=31536000; samesite=lax`;
  } catch {}
}

/**
 * Toți clienții CRM în memoria browserului (când sunt mulți și pagina a primit doar primele rânduri). `version` = versiunea curentă de pe server (vine odată cu pagina): dacă
 * lista din memoria sesiunii / IndexedDB are aceeași versiune, NU se cere nimic; altfel se cere condiționat (ETag) și se salvează.
 */
export function useClientDataset(version: string | null): { rows: ClientRow[] | null; loading: boolean; error: string | null } {
  const [rows, setRows] = useState<ClientRow[] | null>(() => (version && memo?.etag === version ? memo.rows : null));
  const [loading, setLoading] = useState(!!version && !(memo?.etag === version));
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!version) return;
    const my = ++seq.current;
    (async () => {
      if (memo?.etag === version) { setRows(memo.rows); setLoading(false); return; }
      setLoading(true);
      setError(null);
      const st = await idbGet<Stored>(IDB_KEY);
      if (my !== seq.current) return;
      if (st?.payload?.rows && st.etag === version) {
        const dec = decodeClients(st.payload.rows);
        memo = { etag: version, rows: dec };
        setRows(dec);
        setLoading(false);
        rememberVersion(version);
        return;
      }
      // o versiune mai veche din IndexedDB se arată cât timp vine cea nouă (mai bine decât doar primele rânduri)
      if (st?.payload?.rows) setRows(decodeClients(st.payload.rows));
      try {
        // versiunea din pagină e cea curentă, iar cea din IndexedDB e alta → serverul oricum răspunde 200; cererea fără antet condiționat e identică cu preîncărcarea din HTML (o refolosește, nu descarcă a doua oară)
        let res = await fetch("/api/clients/snapshot");
        // răspunsul poate veni din cache-ul HTTP al browserului (max-age scurt) și să fie mai vechi decât versiunea din pagină → o singură cerere forțată
        if (res.ok && (res.headers.get("etag") ?? "").replace(/"/g, "") !== version) res = await fetch("/api/clients/snapshot", { cache: "reload" });
        if (my !== seq.current) return;
        if (res.status === 304 && st?.payload?.rows) {
          const dec = decodeClients(st.payload.rows);
          memo = { etag: st.etag, rows: dec };
          setRows(dec);
          rememberVersion(st.etag);
        } else if (res.ok) {
          const payload = (await res.json()) as ClientPayload;
          const etag = (res.headers.get("etag") ?? "").replace(/"/g, "");
          const dec = decodeClients(payload.rows);
          memo = { etag, rows: dec };
          setRows(dec);
          void idbSet(IDB_KEY, { etag, payload } satisfies Stored).then(() => rememberVersion(etag));
        } else throw new Error(String(res.status));
      } catch {
        if (my === seq.current) setError("Nu am putut încărca toți clienții.");
      } finally {
        if (my === seq.current) setLoading(false);
      }
    })();
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- contor intern, nu un nod React
      seq.current++;
    };
  }, [version]);

  return { rows, loading, error };
}
