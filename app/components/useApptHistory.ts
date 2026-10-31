"use client";

import { useEffect, useRef, useState } from "react";
import { decodeAppt, type ApptMonth, type ApptPayload, type ApptTuple } from "@/lib/appt-snapshot";
import { idbName } from "@/lib/cache-scope";
import type { ApptVM } from "./types";

const IDB_NAME = "payers-cache"; // aceeași bază IndexedDB (un singur depozit „kv"), alte chei
const keyOf = (month: string) => `appts-m-${month}`;
const PARALLEL = 4;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(idbName(IDB_NAME), 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGetMany<T>(keys: string[]): Promise<(T | undefined)[]> {
  try {
    const db = await openDb();
    return await Promise.all(
      keys.map(
        (k) =>
          new Promise<T | undefined>((resolve) => {
            const r = db.transaction("kv").objectStore("kv").get(k);
            r.onsuccess = () => resolve(r.result as T | undefined);
            r.onerror = () => resolve(undefined);
          }),
      ),
    );
  } catch {
    return keys.map(() => undefined);
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

type Stored = { version: string; payload: ApptPayload };
// luni deja decodate în această sesiune (revenirea pe pagină e instantanee)
const memo = new Map<string, { version: string; rows: ApptVM[] }>();

/**
 * Istoricul programărilor, lună cu lună (vezi lib/services/appointment-cache.ts): pentru fiecare lună din manifest, dacă versiunea din IndexedDB (sau din memoria sesiunii) e cea curentă
 * nu se cere NIMIC de la server; doar lunile noi sau modificate se descarcă (în paralel, câte `PARALLEL`). Prima pagină se desenează din fereastra primită odată cu HTML-ul;
 * istoricul se adaugă pe măsură ce sosește.
 */
export function useApptHistory(manifest: ApptMonth[]): { rows: ApptVM[]; loading: boolean; error: string | null } {
  const [rows, setRows] = useState<ApptVM[]>([]);
  const [loading, setLoading] = useState(manifest.length > 0);
  const [error, setError] = useState<string | null>(null);
  const key = manifest.map((m) => `${m.month}:${m.version}`).join(",");
  const seq = useRef(0);

  useEffect(() => {
    const my = ++seq.current;
    const months = key ? key.split(",").map((e) => { const i = e.indexOf(":"); return { month: e.slice(0, i), version: e.slice(i + 1) }; }) : [];
    const have = new Map<string, ApptVM[]>();
    let lastPublish = 0;
    const publish = (force = false) => {
      if (my !== seq.current) return;
      const now = Date.now();
      if (!force && now - lastPublish < 250) return;
      lastPublish = now;
      const out: ApptVM[] = [];
      for (const m of months) { const r = have.get(m.month); if (r) out.push(...r); }
      setRows(out);
    };
    (async () => {
      if (months.length === 0) { setRows([]); setLoading(false); return; }
      setLoading(true);
      setError(null);
      const missing: { month: string; version: string }[] = [];
      for (const m of months) {
        const mm = memo.get(m.month);
        if (mm && mm.version === m.version) have.set(m.month, mm.rows);
        else missing.push(m);
      }
      if (missing.length) {
        const stored = await idbGetMany<Stored>(missing.map((m) => keyOf(m.month)));
        const still: typeof missing = [];
        missing.forEach((m, i) => {
          const st = stored[i];
          if (st && st.version === m.version && st.payload?.rows) {
            const rowsDec = st.payload.rows.map((t: ApptTuple) => decodeAppt(t, st.payload.names));
            have.set(m.month, rowsDec);
            memo.set(m.month, { version: m.version, rows: rowsDec });
          } else still.push(m);
        });
        publish(true);
        let next = 0;
        let failed = false;
        const worker = async () => {
          while (my === seq.current) {
            const m = still[next++];
            if (!m) return;
            try {
              const res = await fetch(`/api/appointments/snapshot?month=${m.month}`);
              if (res.status === 404) { have.set(m.month, []); memo.set(m.month, { version: m.version, rows: [] }); continue; }
              if (!res.ok) throw new Error(String(res.status));
              const payload = (await res.json()) as ApptPayload;
              const dec = payload.rows.map((t) => decodeAppt(t, payload.names));
              // versiunea exactă primită (ETag) poate fi mai nouă decât cea din manifest; o reținem pe cea din manifest, ca la următoarea deschidere să nu mai cerem lunile neschimbate
              have.set(m.month, dec);
              memo.set(m.month, { version: m.version, rows: dec });
              void idbSet(keyOf(m.month), { version: m.version, payload } satisfies Stored);
              publish();
            } catch {
              failed = true;
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(PARALLEL, still.length) }, worker));
        if (failed && my === seq.current) setError("Nu am putut încărca tot istoricul programărilor.");
      }
      publish(true);
      if (my === seq.current) setLoading(false);
    })();
    return () => {
      // o schimbare de manifest (sau ieșirea din pagină) oprește încărcarea curentă
      // eslint-disable-next-line react-hooks/exhaustive-deps -- contor intern, nu un nod React
      if (seq.current === my) seq.current++;
    };
  }, [key]);

  return { rows, loading, error };
}
