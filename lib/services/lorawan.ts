import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { env } from "../env";
import { getMeterSnap } from "./meter-cache";
import { saveReading } from "./meter-readings";
import { invalidateLorawanMap } from "./lorawan-map";
import { invalidatePayers } from "./payer-cache";
import { currentPeriod, READING_TZ } from "../meter-readings";
import { LORAWAN_HOUR, LORAWAN_MINUTE, LORAWAN_SOURCE, normalizeMeterName, parseLorawan, stripLeadingZeros, type LorawanRow, type LorawanStats, type LorawanStatus } from "../lorawan";

/**
 * Extragerea contoarelor LoRaWAN: o dată pe zi, la 23:30 (ora firmei), se citește lista de la serverul de noduri (`[{ name, volume_m3, ts }]`). Pentru fiecare contor:
 *  1. numele fără „S” se caută între contoarele ACTIVE din CRM (exportul 1C); plătitorul vine odată cu contorul (același abonat ca în lista de contoare);
 *  2. dacă transmisia NU e din luna curentă (fusul firmei), contorul se ignoră (rămâne doar marcat LoRaWAN);
 *  3. altfel indexul se salvează ca citire a lunii (MeterReading, sursa „LORAWAN”): se actualizează zilnic, nu suprascrie o citire făcută de cititor și nu poate fi modificat manual.
 * Pornirea: temporizatorul serverului (instrumentation.ts), ruta /api/cron/lorawan (scheduler extern) sau butonul din pagina „LoRaWAN” (administrator).
 * Doar o extragere la un moment dat (blocaj în baza de date, valabil între instanțe); una eșuată se reia după 30 de minute.
 */

const STATE_ID = "main";
const EPOCH = new Date("1970-01-01T00:00:00.000Z");
const LOCK_MIN = 20;
const RETRY_MIN = 30;
const FETCH_TIMEOUT_MS = 90_000;
const SAVE_CONCURRENCY = 4;
const UNMATCHED_KEEP = 200;
/** Un contor care nu mai apare în lista LoRaWAN de atâtea zile nu mai e considerat LoRaWAN (iese din blocaj). */
const FORGET_AFTER_DAYS = 45;
const ACTOR = { id: null, name: "LoRaWAN" } as const;

/**
 * Plătitorii cu cel puțin un contor LoRaWAN primesc marcajul `meterLorawan` (filtrul „Contor LoRaWAN” din Plătitori / Notificări). Se scriu doar diferențele; dacă s-a schimbat ceva,
 * lista de plătitori din memorie se reface.
 */
async function syncPayerFlags(): Promise<void> {
  const [meters, flagged] = await Promise.all([prisma.lorawanMeter.findMany({ select: { clientId: true } }), prisma.client.findMany({ where: { meterLorawan: true }, select: { id: true } })]);
  const want = new Set(meters.map((m) => m.clientId).filter((x): x is string => !!x));
  const have = new Set(flagged.map((c) => c.id));
  const on = [...want].filter((id) => !have.has(id));
  const off = [...have].filter((id) => !want.has(id));
  const chunk = async (ids: string[], value: boolean) => {
    for (let i = 0; i < ids.length; i += 300) await prisma.client.updateMany({ where: { id: { in: ids.slice(i, i + 300) } }, data: { meterLorawan: value } });
  };
  await chunk(on, true);
  await chunk(off, false);
  if (on.length || off.length) await invalidatePayers();
}

export type Trigger = "timer" | "cron" | "manual";
export type LorawanRun = { ok: true; message: string; stats: LorawanStats } | { ok: false; error: string };

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: READING_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: READING_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayKey = (d: Date) => dayFmt.format(d);
/** Minutele scurse de la miezul nopții, în fusul firmei. */
const minuteOfDay = (d: Date) => {
  const [h, m] = timeFmt.format(d).split(":").map(Number);
  return h * 60 + m;
};

export const lorawanConfigured = () => !!env.lorawan.token;

async function fetchRows(): Promise<ReturnType<typeof parseLorawan>> {
  const res = await fetch(env.lorawan.url, { headers: { token: env.lorawan.token, accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Serverul LoRaWAN a răspuns ${res.status}.`);
  return parseLorawan(await res.json());
}

/** Rulează `fn` pe fiecare element, cel mult `n` deodată. */
async function pool<T>(items: T[], n: number, fn: (it: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

async function claim(): Promise<boolean> {
  await prisma.lorawanState.upsert({ where: { id: STATE_ID }, create: { id: STATE_ID }, update: {} });
  const now = new Date();
  const r = await prisma.lorawanState.updateMany({ where: { id: STATE_ID, lockUntil: { lt: now } }, data: { lockUntil: new Date(now.getTime() + LOCK_MIN * 60_000) } });
  return r.count === 1;
}

type CrmRow = Awaited<ReturnType<typeof getMeterSnap>>["rows"][number];

export async function runLorawanSync(trigger: Trigger): Promise<LorawanRun> {
  if (DEMO) return { ok: false, error: "Mod demo." };
  if (!lorawanConfigured()) return { ok: false, error: "Lipsește LORAWAN_TOKEN în configurația serverului." };
  if (!(await claim())) return { ok: false, error: "O extragere LoRaWAN rulează deja." };
  const t0 = Date.now();
  const now = new Date();
  const period = currentPeriod(now);
  const day = dayKey(now);
  const scheduled = trigger !== "manual";
  try {
    const parsed = await fetchRows();
    const snap = await getMeterSnap();
    // contoarele CRM după număr (exact, apoi fără zerourile din față); doar cele din exportul 1C, nu rândurile „doar Axioma”
    const exact = new Map<string, CrmRow[]>();
    const loose = new Map<string, CrmRow[]>();
    const removed = new Set<string>();
    for (const r of snap.rows) {
      if (r.source !== "1c") continue;
      const c = normalizeMeterName(r.contor);
      if (!c) continue;
      if (r.removedAt) {
        removed.add(c);
        removed.add(stripLeadingZeros(c));
        continue;
      }
      (exact.get(c) ?? exact.set(c, []).get(c)!).push(r);
      const z = stripLeadingZeros(c);
      (loose.get(z) ?? loose.set(z, []).get(z)!).push(r);
    }

    const stats: LorawanStats = { received: parsed.rows.length + parsed.invalid + parsed.duplicates, invalid: parsed.invalid, placeholders: 0, stale: 0, matched: 0, removed: 0, unmatched: 0, noPayer: 0, ambiguous: 0, saved: 0, unchanged: 0, skippedField: 0, lowerThanPrev: 0, errors: 0 };
    const unmatched: string[] = [];
    const known: { row: CrmRow; lw: LorawanRow; current: boolean }[] = [];
    for (const lw of parsed.rows) {
      // serverul de noduri listează și contoarele care n-au transmis încă niciodată: 0 m³ la o dată fixă dintr-o altă lună (ex. 01.01, ora 00:00) — nu sunt contoare active
      if (lw.volume === 0 && currentPeriod(lw.ts) !== period) {
        stats.placeholders++;
        continue;
      }
      const z = stripLeadingZeros(lw.name);
      // fără zerourile din față doar dacă toate rândurile potrivite au același număr (altfel ar fi o potrivire nesigură)
      const lz = loose.get(z);
      const hits = exact.get(lw.name) ?? (lz && new Set(lz.map((r) => r.contor.trim())).size === 1 ? lz : undefined);
      if (!hits?.length) {
        if (removed.has(lw.name) || removed.has(z)) stats.removed++;
        else {
          stats.unmatched++;
          if (unmatched.length < UNMATCHED_KEEP) unmatched.push(lw.name);
        }
        continue;
      }
      if (new Set(hits.map((r) => r.clientId ?? r.id)).size > 1) stats.ambiguous++;
      const current = currentPeriod(lw.ts) === period;
      if (!current) stats.stale++;
      else stats.matched++;
      // același număr de contor la mai multe rânduri (abonați / consumatori diferiți): toate se marchează LoRaWAN; citirea o primește fiecare rând
      for (const row of hits) {
        known.push({ row, lw, current });
        if (current && !row.clientId) stats.noPayer++;
      }
    }

    // ce există deja: contoarele marcate și citirile lunii (o singură interogare pe fiecare)
    const [marked, readings] = await Promise.all([
      prisma.lorawanMeter.findMany({ select: { id: true, volume: true, ts: true, period: true, status: true, updatedAt: true } }),
      prisma.meterReading.findMany({ where: { period }, select: { meterId: true, value: true, source: true } }),
    ]);
    const markedBy = new Map(marked.map((m) => [m.id, m]));
    const readBy = new Map(readings.map((r) => [r.meterId, r]));

    await pool(known, SAVE_CONCURRENCY, async ({ row, lw, current }) => {
      let savedPeriod: string | null = markedBy.get(row.id)?.period ?? null;
      try {
        if (current) {
          const ex = readBy.get(row.id);
          if (ex && ex.source == null) {
            stats.skippedField++;
          } else if (ex && ex.source === LORAWAN_SOURCE && ex.value === lw.volume) {
            stats.unchanged++;
            savedPeriod = period;
          } else {
            const res = await saveReading(ACTOR, { meterId: row.id, value: lw.volume, lat: null, lng: null, accuracy: null, confirmed: true, readAt: lw.ts, source: LORAWAN_SOURCE });
            if (res.ok) {
              stats.saved++;
              savedPeriod = period;
              if (res.reading.prevValue != null && res.reading.value < res.reading.prevValue) stats.lowerThanPrev++;
            } else {
              stats.errors++;
              if (stats.errors <= 5) console.error(`[lorawan] contor ${lw.name}: ${res.error}`);
            }
          }
        }
        const status = current ? "matched" : "stale";
        const cur = markedBy.get(row.id);
        if (!cur || cur.volume !== lw.volume || cur.ts.getTime() !== lw.ts.getTime() || cur.period !== savedPeriod || cur.status !== status) {
          const data = { contor: lw.name, clientId: row.clientId, volume: lw.volume, ts: lw.ts, period: savedPeriod, status } satisfies Prisma.LorawanMeterUncheckedUpdateInput;
          await prisma.lorawanMeter.upsert({ where: { id: row.id }, create: { id: row.id, ...data }, update: data });
        } else if (Date.now() - cur.updatedAt.getTime() > 7 * 86_400_000) {
          // neschimbat de mult: se reînnoiește „văzut”, ca să nu fie uitat după 45 de zile
          await prisma.lorawanMeter.update({ where: { id: row.id }, data: { updatedAt: new Date() } });
        }
      } catch (e) {
        stats.errors++;
        if (stats.errors <= 5) console.error(`[lorawan] contor ${lw.name}:`, e);
      }
    });

    await prisma.lorawanMeter.deleteMany({ where: { updatedAt: { lt: new Date(Date.now() - FORGET_AFTER_DAYS * 86_400_000) } } });
    invalidateLorawanMap();
    await syncPayerFlags().catch((e) => console.error("[lorawan] marcajul plătitorilor:", e));

    const message = `${stats.received} contoare primite: ${stats.saved} citiri salvate, ${stats.unchanged} neschimbate, ${stats.stale} ignorate (transmisie din altă lună), ${stats.placeholders} fără nicio transmisie, ${stats.unmatched} negăsite în CRM${stats.errors ? `, ${stats.errors} erori` : ""}.`;
    const durationMs = Date.now() - t0;
    await prisma.lorawanState.update({
      where: { id: STATE_ID },
      data: {
        lastRunAt: new Date(),
        lastOk: true,
        lastTrigger: trigger,
        message,
        durationMs,
        stats: stats as unknown as Prisma.InputJsonValue,
        unmatched,
        lockUntil: EPOCH,
        ...(scheduled ? { lastRunDay: day, retryAt: EPOCH } : {}),
      },
    });
    console.log(`[lorawan] ${message} (${durationMs} ms, ${trigger})`);
    return { ok: true, message, stats };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[lorawan] extragerea a eșuat:", error);
    await prisma.lorawanState
      .update({
        where: { id: STATE_ID },
        data: { lastRunAt: new Date(), lastOk: false, lastTrigger: trigger, message: error.slice(0, 300), durationMs: Date.now() - t0, lockUntil: EPOCH, ...(scheduled ? { retryAt: new Date(Date.now() + RETRY_MIN * 60_000) } : {}) },
      })
      .catch(() => {});
    return { ok: false, error };
  }
}

/** Apelată din temporizatorul serverului (în fiecare minut): după 23:30 (ora firmei) pornește extragerea zilei, o singură dată pe zi. */
export async function checkLorawanSchedule(now: Date = new Date()): Promise<void> {
  if (DEMO || !lorawanConfigured() || minuteOfDay(now) < LORAWAN_HOUR * 60 + LORAWAN_MINUTE) return;
  const st = await prisma.lorawanState.findUnique({ where: { id: STATE_ID }, select: { lastRunDay: true, retryAt: true, lockUntil: true } });
  if (st && (st.lastRunDay === dayKey(now) || st.retryAt > now || st.lockUntil > now)) return;
  await runLorawanSync("timer");
}

export async function getLorawanStatus(): Promise<LorawanStatus> {
  const empty: LorawanStatus = { configured: lorawanConfigured(), lastRunAt: null, lastOk: true, lastTrigger: "", message: "", durationMs: 0, running: false, stats: null, unmatched: [], known: 0 };
  if (DEMO) return empty;
  const [st, known] = await Promise.all([prisma.lorawanState.findUnique({ where: { id: STATE_ID } }), prisma.lorawanMeter.count()]);
  if (!st) return { ...empty, known };
  return {
    configured: lorawanConfigured(),
    lastRunAt: st.lastRunAt ? st.lastRunAt.toISOString() : null,
    lastOk: st.lastOk,
    lastTrigger: st.lastTrigger,
    message: st.message,
    durationMs: st.durationMs,
    running: st.lockUntil > new Date(),
    stats: (st.stats as unknown as LorawanStats | null) ?? null,
    unmatched: Array.isArray(st.unmatched) ? (st.unmatched as string[]) : [],
    known,
  };
}
