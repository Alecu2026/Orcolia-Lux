import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { SVC_SEWER, SVC_WATER, type OneCConsumer, type OneCLine, type OneCMeter, type OneCReading } from "../apa-canal-1c";
import type { MeterStatic } from "../meters";

/**
 * Contoarele din exportul 1C (colecția OneCRecord: un rând per abonat și lună, cu lista contoarelor, a citirilor și a liniilor de calcul).
 * Se ia ULTIMA înregistrare a fiecărui abonat și se desface în câte un rând per contor — inclusiv contoarele scoase (cu data scoaterii).
 * Contoarele din exportul Axioma (câmpurile de contor de pe Client) apar doar pentru abonații fără niciun contor în 1C.
 */

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export type RecForMeters = {
  id: string;
  clientId: string | null;
  nume: string | null;
  nrContract: string | null;
  contPersonal: string | null;
  oras: string | null;
  strada: string | null;
  casa: string | null;
  apartament: string | null;
  dataDoc: string | null;
  meters: unknown;
  readings: unknown;
  lines: unknown;
};

const REC_SELECT = {
  id: true, clientId: true, nume: true, nrContract: true, contPersonal: true, oras: true, strada: true, casa: true, apartament: true,
  dataDoc: true, meters: true, readings: true, lines: true,
} as const;

export type ExtractedMeter = {
  /** Poziția în lista contoarelor înregistrării (după eliminarea dublurilor) — face parte din id-ul rândului. */
  idx: number;
  meter: OneCMeter;
  /** Cea mai recentă citire a contorului din înregistrare. */
  reading: OneCReading | null;
  lines: OneCLine[];
  water: { vol: number; sum: number } | null;
  sewer: { vol: number; sum: number } | null;
};

function groupBy<T extends { contor: string }>(list: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of list) {
    const a = m.get(x.contor);
    if (a) a.push(x);
    else m.set(x.contor, [x]);
  }
  return m;
}

function sumLines(lines: OneCLine[], svc: string): { vol: number; sum: number } | null {
  const l = lines.filter((x) => x.serviciu === svc);
  return l.length ? { vol: round2(l.reduce((s, x) => s + x.volum, 0)), sum: round2(l.reduce((s, x) => s + x.suma, 0)) } : null;
}

/**
 * Contoarele unei înregistrări, fiecare cu citirea și liniile lui de calcul. Același contor trecut în mai multe perioade ale registrului 1C
 * (aceeași combinație contor + consumator + sub-contor) se păstrează o singură dată, cu cea mai recentă perioadă; contoarele diferite de la
 * aceeași adresă rămân toate. Rândurile fără număr de contor nu sunt contoare și se sar.
 */
export function extractMeters(rec: Pick<RecForMeters, "meters" | "readings" | "lines">): ExtractedMeter[] {
  const meters = arr<OneCMeter>(rec.meters);
  const readings = arr<OneCReading>(rec.readings);
  const lines = arr<OneCLine>(rec.lines);

  const seen = new Map<string, OneCMeter>();
  for (const m of meters) {
    const contor = (m.contor ?? "").trim();
    if (!contor) continue;
    const key = [contor, m.consumator ?? "", m.inn ?? "", m.subContor ?? "", m.subAbonat ?? ""].join("\u0001");
    const prev = seen.get(key);
    if (!prev || (m.perioada ?? "") >= (prev.perioada ?? "")) seen.set(key, { ...m, contor });
  }

  const readingsBy = groupBy(readings);
  const linesBy = groupBy(lines);
  const out: ExtractedMeter[] = [];
  let idx = 0;
  for (const meter of seen.values()) {
    // Citirile/liniile aceluiași consumator au prioritate; dacă n-au consumator potrivit, se iau cele ale contorului.
    const rAll = readingsBy.get(meter.contor) ?? [];
    const rSame = rAll.filter((r) => r.consumator === meter.consumator);
    const rPool = rSame.length ? rSame : rAll;
    let reading: OneCReading | null = null;
    for (const r of rPool) if (!reading || (r.dataCitire ?? "") >= (reading.dataCitire ?? "")) reading = r;
    const lAll = linesBy.get(meter.contor) ?? [];
    const lSame = lAll.filter((l) => l.consumator === meter.consumator);
    const own = lSame.length ? lSame : lAll;
    out.push({ idx: idx++, meter, reading, lines: own, water: sumLines(own, SVC_WATER), sewer: sumLines(own, SVC_SEWER) });
  }
  return out;
}

/** Adresa abonatului, în aceeași formă ca adresa de consum a plătitorului: „Oraș, str. X, nr. N, ap. M". */
function composeAddress(r: Pick<RecForMeters, "oras" | "strada" | "casa" | "apartament">): string | null {
  return [r.oras?.trim(), r.strada?.trim() ? `str. ${r.strada.trim()}` : "", r.casa?.trim() ? `nr. ${r.casa.trim()}` : "", r.apartament?.trim() ? `ap. ${r.apartament.trim()}` : ""]
    .filter(Boolean)
    .join(", ") || null;
}

/** Identitatea abonatului peste luni: cont personal; firmele/instituțiile (fără cont) — nr. de contract; altfel numele. */
const subscriberKey = (r: { contPersonal: string | null; nrContract: string | null; nume: string | null }) =>
  r.contPersonal ? `c:${r.contPersonal}` : r.nrContract ? `k:${r.nrContract}` : `n:${(r.nume ?? "").trim().toLowerCase()}`;

/** Id-ul public al unui contor 1C: stabil între sincronizări (id-ul înregistrării se schimbă la fiecare import). `k` = poziția între contoarele cu același număr. */
const meterId = (subKey: string, contor: string, k: number) => `${subKey}~${contor}~${k}`;

function nextK(seen: Map<string, number>, contor: string): number {
  const k = seen.get(contor) ?? 0;
  seen.set(contor, k + 1);
  return k;
}

function staticFromRecord(rec: RecForMeters, items: ExtractedMeter[]): MeterStatic[] {
  const address = composeAddress(rec);
  const subKey = subscriberKey(rec);
  const seen = new Map<string, number>();
  const active = items.reduce((n, it) => (it.meter.dataScoatere ? n : n + 1), 0);
  return items.map((it): MeterStatic => {
    const r = it.reading;
    return [
      meterId(subKey, it.meter.contor, nextK(seen, it.meter.contor)), rec.clientId, it.meter.contor, rec.nume ?? "", rec.contPersonal, rec.nrContract,
      address, it.meter.consumator || null, it.meter.inn || null, it.meter.dataInstalare, it.meter.dataScoatere, it.meter.sigiliu || null,
      r ? r.citirePrec : null, r?.dataPrec ?? null, r ? r.citire : null, r?.dataCitire ?? null, r ? r.consum : null,
      r?.sursa || null, it.water?.vol ?? null, it.water?.sum ?? null, it.sewer?.vol ?? null, it.sewer?.sum ?? null,
      rec.dataDoc, active, 0,
    ];
  });
}

/**
 * Partea statică a snapshot-ului: toate contoarele din ultima înregistrare 1C a fiecărui abonat + contoarele Axioma ale abonaților fără
 * contor în 1C. Nu depinde de plătitori (nume, contact, facturi) — acestea se alipesc la servire (vezi lib/services/meter-cache.ts).
 */
export async function buildMeterStatic(): Promise<MeterStatic[]> {
  if (DEMO) return [];
  // 1) Ultima înregistrare a fiecărui abonat — doar câmpuri mici (colecția are ~19.000 de rânduri pe lună importată).
  const index = await prisma.oneCRecord.findMany({ select: { id: true, contPersonal: true, nrContract: true, nume: true, dataDoc: true } });
  const best = new Map<string, { id: string; dataDoc: string }>();
  for (const r of index) {
    const k = subscriberKey(r);
    const d = r.dataDoc ?? "";
    const prev = best.get(k);
    if (!prev || d > prev.dataDoc) best.set(k, { id: r.id, dataDoc: d });
  }
  const ids = [...best.values()].map((b) => b.id);

  // 2) Conținutul lor, în loturi mici (un filtru `id: { in: [mii] }` e extrem de lent în MongoDB), câteva loturi în paralel.
  const CHUNK = 400;
  const PARALLEL = 3;
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
  const out: MeterStatic[] = [];
  const accounts = new Set<string>();
  const clientIds = new Set<string>();
  for (let i = 0; i < chunks.length; i += PARALLEL) {
    const parts = await Promise.all(
      chunks.slice(i, i + PARALLEL).map((c) => prisma.oneCRecord.findMany({ where: { id: { in: c } }, select: REC_SELECT })),
    );
    for (const docs of parts) {
      for (const rec of docs) {
        const items = extractMeters(rec);
        if (items.length === 0) continue;
        if (rec.contPersonal) accounts.add(rec.contPersonal);
        if (rec.clientId) clientIds.add(rec.clientId);
        for (const row of staticFromRecord(rec, items)) out.push(row);
      }
    }
  }

  // 3) Contoarele Axioma ale abonaților care n-au niciun contor în 1C.
  const axioma = await prisma.client.findMany({
    where: { meterNumber: { not: null } },
    select: { id: true, name: true, meterSeries: true, apaCanalContract: true, meterNumber: true, meterCurrReading: true, meterReadingEstimated: true, consumAddress: true },
  });
  for (const c of axioma) {
    const contor = (c.meterNumber ?? "").trim();
    if (!contor || clientIds.has(c.id) || (c.meterSeries && accounts.has(c.meterSeries))) continue;
    out.push([
      `a:${c.id}`, c.id, contor, c.name, c.meterSeries, c.apaCanalContract,
      c.consumAddress, null, null, null, null, null,
      null, null, c.meterCurrReading, null, null,
      c.meterReadingEstimated ? "Axioma (estimat)" : "Axioma", null, null, null, null,
      null, 1, 1,
    ]);
  }
  return out;
}

// ── Detaliile unui contor (pop-up și pagina contorului) ────────────────────────────────────────

export type MeterHistoryItem = {
  docDate: string | null;
  prev: number;
  prevDate: string | null;
  curr: number;
  currDate: string | null;
  consum: number;
  medie: number;
  sursa: string;
};

/** Datele contorului pe o lună (luna citirii; dacă n-are citire — luna documentului 1C): citirea și liniile de calcul din documentul 1C respectiv. */
export type MeterMonth = {
  /** „YYYY-MM” */
  month: string;
  docDate: string | null;
  prev: number | null;
  prevDate: string | null;
  curr: number | null;
  currDate: string | null;
  consum: number | null;
  medie: number | null;
  sursa: string | null;
  lines: OneCLine[];
};

export type MeterDetail = {
  /** Datele pe luni (cele mai noi primele). */
  months: MeterMonth[];
  /** Câmpurile brute din registrul de contoare 1C (perioadă, sub-abonat, sub-contract…). */
  meter: OneCMeter | null;
  reading: OneCReading | null;
  lines: OneCLine[];
  consumer: OneCConsumer | null;
  history: MeterHistoryItem[];
  subscriber: {
    nrContract: string | null;
    contPersonal: string | null;
    tipSector: string | null;
    telefon: string | null;
    dataDoc: string | null;
    calculat: number | null;
    datorieAvans: number | null;
    deAchitat: number | null;
  } | null;
};

/** Răspunsul rutei de detalii: detaliile contorului + referința facturii curente (pentru „Vezi” / „Editează”). */
export type MeterDetailResponse = MeterDetail & { invoice: { id: string; publicToken: string } | null };

const EMPTY_DETAIL: MeterDetail = { months: [], meter: null, reading: null, lines: [], consumer: null, history: [], subscriber: null };

/** Împarte id-ul `<cheie abonat>~<nr. contor>~<k>` (nr. contor și k sunt după ultimele două „~”). */
export function parseMeterId(id: string): { subKey: string; contor: string; k: number } | null {
  const last = id.lastIndexOf("~");
  if (last < 0) return null;
  const k = Number(id.slice(last + 1));
  const rest = id.slice(0, last);
  const mid = rest.lastIndexOf("~");
  if (mid < 0 || !Number.isInteger(k) || k < 0) return null;
  const subKey = rest.slice(0, mid);
  const contor = rest.slice(mid + 1);
  return subKey.length > 2 && contor ? { subKey, contor, k } : null;
}

/**
 * Detaliile unui contor după id: `a:<idClient>` (Axioma, fără detalii în plus) sau `<cheie abonat>~<nr. contor>~<k>` (1C). Se ia ULTIMA înregistrare
 * a abonatului; istoricul citirilor vine din toate lunile lui importate. Null = contorul nu mai există.
 */
export async function getMeterDetail(id: string, opts: { historyLimit?: number } = {}): Promise<MeterDetail | null> {
  if (DEMO) return null;
  if (id.startsWith("a:")) return OBJECT_ID.test(id.slice(2)) ? EMPTY_DETAIL : null;
  const p = parseMeterId(id);
  if (!p) return null;
  const sep = p.subKey.indexOf(":");
  const kind = p.subKey.slice(0, sep);
  const val = p.subKey.slice(sep + 1);
  if (!val) return null;
  const where =
    kind === "c" ? { contPersonal: val } : kind === "k" ? { nrContract: val } : kind === "n" ? { nume: { equals: val, mode: "insensitive" as const } } : null;
  if (!where) return null;
  const recs = await prisma.oneCRecord.findMany({
    where,
    select: { ...REC_SELECT, consumers: true, tipSector: true, telefon: true, calculat: true, datorieAvans: true, deAchitat: true },
    take: 120,
  });
  if (recs.length === 0) return null;
  let rec = recs[0];
  for (const x of recs) if ((x.dataDoc ?? "") > (rec.dataDoc ?? "")) rec = x;
  const it = extractMeters(rec).filter((x) => x.meter.contor === p.contor)[p.k];
  if (!it) return null;

  const consumers = arr<OneCConsumer>(rec.consumers);
  const consumer = consumers.find((c) => c.nume === it.meter.consumator && (!it.meter.inn || c.inn === it.meter.inn)) ?? consumers.find((c) => c.nume === it.meter.consumator) ?? null;

  const history: MeterHistoryItem[] = [];
  const seenRead = new Set<string>();
  const byMonth = new Map<string, MeterMonth>();
  for (const m of recs) {
    const mine = arr<OneCReading>(m.readings).filter((r) => r.contor === it.meter.contor && (!it.meter.consumator || r.consumator === it.meter.consumator));
    // luna: a citirii cea mai recentă din document; fără citire — luna documentului
    let top: OneCReading | null = null;
    for (const r of mine) if (!top || (r.dataCitire ?? "") >= (top.dataCitire ?? "")) top = r;
    const month = (top?.dataCitire ?? m.dataDoc ?? "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(month)) {
      const prevM = byMonth.get(month);
      if (!prevM || (m.dataDoc ?? "") > (prevM.docDate ?? "")) {
        byMonth.set(month, {
          month,
          docDate: m.dataDoc,
          prev: top ? top.citirePrec : null,
          prevDate: top?.dataPrec ?? null,
          curr: top ? top.citire : null,
          currDate: top?.dataCitire ?? null,
          consum: top ? top.consum : null,
          medie: top ? top.medie : null,
          sursa: top?.sursa || null,
          lines: arr<OneCLine>(m.lines).filter((l) => l.contor === it.meter.contor && (!it.meter.consumator || l.consumator === it.meter.consumator)),
        });
      }
    }
    for (const r of mine) {
      const key = `${r.dataCitire}|${r.citire}|${r.sursa}`;
      if (seenRead.has(key)) continue;
      seenRead.add(key);
      history.push({ docDate: m.dataDoc, prev: r.citirePrec, prevDate: r.dataPrec, curr: r.citire, currDate: r.dataCitire, consum: r.consum, medie: r.medie, sursa: r.sursa });
    }
  }
  history.sort((a, b) => (b.currDate ?? b.docDate ?? "").localeCompare(a.currDate ?? a.docDate ?? ""));

  return {
    months: [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month)),
    meter: it.meter,
    reading: it.reading,
    lines: it.lines,
    consumer,
    history: history.slice(0, opts.historyLimit ?? 36),
    subscriber: {
      nrContract: rec.nrContract,
      contPersonal: rec.contPersonal,
      tipSector: rec.tipSector,
      telefon: rec.telefon,
      dataDoc: rec.dataDoc,
      calculat: rec.calculat,
      datorieAvans: rec.datorieAvans,
      deAchitat: rec.deAchitat,
    },
  };
}
