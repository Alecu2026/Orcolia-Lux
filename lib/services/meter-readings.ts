import "server-only";
import type { MeterReading } from "@prisma/client";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { getMeterSnap } from "./meter-cache";
import {
  FAR_METERS,
  JUMP_CONFIRM_M3,
  MAX_INDEX,
  currentPeriod,
  distanceMeters,
  shiftPeriod,
  type FieldTuple,
  type ReadingDto,
  type SaveReadingResult,
} from "../meter-readings";

/**
 * Citirile lunare din teren (model MeterReading). O citire pe contor și lună; indexul se poate corecta în aceeași lună. Nu modifică facturile
 * sau datele din 1C — se păstrează doar în baza de date, cu locația și (opțional) poza contorului.
 */

export type Actor = { id: string; name: string };

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const collator = new Intl.Collator("ro", { numeric: true });

export function toReadingDto(r: MeterReading): ReadingDto {
  return {
    id: r.id,
    meterId: r.meterId,
    contor: r.contor,
    period: r.period,
    value: r.value,
    prevValue: r.prevValue,
    readAt: r.readAt.toISOString(),
    lat: r.lat,
    lng: r.lng,
    accuracy: r.accuracy,
    distanceM: r.distanceM,
    photoUrl: r.photoUrl,
    userName: r.userName,
  };
}

/** Citirile din teren ale unui contor (cele mai noi primele). */
export async function listMeterReadings(meterId: string, limit = 36): Promise<ReadingDto[]> {
  if (DEMO) return [];
  const rows = await prisma.meterReading.findMany({ where: { meterId }, orderBy: { period: "desc" }, take: limit });
  return rows.map(toReadingDto);
}

/**
 * Lista pentru persoana care face citirile: contoarele ACTIVE, în ordinea adreselor (ca să se poată merge pe stradă), cu ultimul index cunoscut și
 * cu citirea de luna aceasta (dacă există). Din lista din memorie + citirile din teren (puține), fără interogări grele.
 */
export async function getFieldList(): Promise<{ period: string; rows: FieldTuple[] }> {
  const period = currentPeriod();
  if (DEMO) return { period, rows: [] };
  const [snap, recent] = await Promise.all([
    getMeterSnap(),
    // luna aceasta + cele două dinainte: citirile din teren mai noi decât indexul din 1C
    prisma.meterReading.findMany({
      where: { period: { gte: shiftPeriod(period, 2) } },
      select: { meterId: true, period: true, value: true, readAt: true, photoUrl: true },
    }),
  ]);
  const thisMonth = new Map<string, (typeof recent)[number]>();
  const lastBefore = new Map<string, (typeof recent)[number]>();
  for (const r of recent) {
    if (r.period === period) thisMonth.set(r.meterId, r);
    else {
      const prev = lastBefore.get(r.meterId);
      if (!prev || r.readAt > prev.readAt) lastBefore.set(r.meterId, r);
    }
  }
  const active = snap.rows.filter((r) => !r.removedAt);
  active.sort((a, b) => collator.compare(a._a, b._a) || collator.compare(a.contor, b.contor));
  const rows = active.map((r): FieldTuple => {
    const cur = thisMonth.get(r.id);
    const fb = lastBefore.get(r.id);
    // ultimul index cunoscut: cel mai recent între 1C și o citire din teren
    const fbDate = fb ? fb.readAt.toISOString().slice(0, 10) : null;
    const useField = fb && (!r.currDate || (fbDate ?? "") > r.currDate);
    return [
      r.id, r.contor, r.name, r.address,
      useField ? fb.value : r.curr, useField ? fbDate : r.currDate,
      cur ? cur.value : null, cur ? cur.readAt.getTime() : null, cur?.photoUrl ? 1 : 0,
    ];
  });
  return { period, rows };
}

export type SaveInput = {
  meterId: string;
  value: number;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  /** Utilizatorul a confirmat o citire care pare greșită (mai mică decât cea anterioară / salt mare). */
  confirmed: boolean;
};

/** Salvează (sau corectează) citirea de luna aceasta a unui contor. */
export async function saveReading(actor: Actor, input: SaveInput): Promise<SaveReadingResult> {
  if (DEMO) return { ok: false, error: "Mod demo." };
  const { value } = input;
  if (!Number.isFinite(value) || value < 0 || value > MAX_INDEX) return { ok: false, error: "Index invalid." };
  const snap = await getMeterSnap();
  const row = snap.rows.find((r) => r.id === input.meterId);
  if (!row) return { ok: false, error: "Contorul nu există în lista curentă." };
  if (row.removedAt) return { ok: false, error: "Contorul este scos din uz." };

  const period = currentPeriod();
  // Indexul anterior: cel mai recent între 1C și o citire din teren dintr-o lună anterioară.
  const lastField = await prisma.meterReading.findFirst({
    where: { meterId: input.meterId, period: { not: period } },
    orderBy: { readAt: "desc" },
    select: { value: true, readAt: true },
  });
  let prev: number | null = row.curr;
  let prevDate = row.currDate;
  if (lastField) {
    const fd = lastField.readAt.toISOString().slice(0, 10);
    if (!prevDate || fd > prevDate) {
      prev = lastField.value;
      prevDate = fd;
    }
  }
  const v = round3(value);
  if (!input.confirmed && prev != null) {
    if (v < prev) return { ok: false, error: "Indexul este mai mic decât cel anterior.", confirm: "lower" };
    if (v - prev > JUMP_CONFIRM_M3) return { ok: false, error: "Consum neobișnuit de mare.", confirm: "high" };
  }

  const okGeo = input.lat != null && input.lng != null && Math.abs(input.lat) <= 90 && Math.abs(input.lng) <= 180;
  const lat = okGeo ? input.lat : null;
  const lng = okGeo ? input.lng : null;
  const accuracy = okGeo && input.accuracy != null && input.accuracy >= 0 ? Math.round(input.accuracy) : null;
  let distanceM: number | null = null;
  if (lat != null && lng != null) {
    const lastLoc = await prisma.meterReading.findFirst({
      where: { meterId: input.meterId, period: { not: period }, lat: { not: null }, lng: { not: null } },
      orderBy: { readAt: "desc" },
      select: { lat: true, lng: true },
    });
    if (lastLoc?.lat != null && lastLoc.lng != null) distanceM = Math.round(distanceMeters(lat, lng, lastLoc.lat, lastLoc.lng));
  }

  const data = {
    contor: row.contor,
    clientId: row.clientId,
    value: v,
    prevValue: prev,
    readAt: new Date(),
    lat,
    lng,
    accuracy,
    distanceM,
    userId: actor.id,
    userName: actor.name,
  };
  const saved = await prisma.meterReading.upsert({
    where: { meterId_period: { meterId: input.meterId, period } },
    create: { meterId: input.meterId, period, ...data },
    update: data,
  });
  return { ok: true, reading: toReadingDto(saved) };
}

/** Pune poza unei citiri; întoarce poza veche (de șters din stocare), sau null dacă citirea nu există. */
export async function setReadingPhoto(readingId: string, url: string, name: string): Promise<{ oldUrl: string | null } | null> {
  if (!OBJECT_ID.test(readingId)) return null;
  const cur = await prisma.meterReading.findUnique({ where: { id: readingId }, select: { photoUrl: true } });
  if (!cur) return null;
  await prisma.meterReading.update({ where: { id: readingId }, data: { photoUrl: url, photoName: name } });
  return { oldUrl: cur.photoUrl };
}

/** Citirea cu id-ul dat (pentru verificări înainte de încărcarea pozei). */
export async function getReading(readingId: string): Promise<MeterReading | null> {
  if (!OBJECT_ID.test(readingId)) return null;
  return prisma.meterReading.findUnique({ where: { id: readingId } });
}

export { FAR_METERS };
