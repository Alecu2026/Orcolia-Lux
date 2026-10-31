/**
 * Programările unui utilizator, împărțite pe LUNA datei (dateKey) — vezi lib/services/appointment-cache.ts. Tuplul compact și inversul lui (cod partajat server / browser, fără dependențe de server).
 * Numele celor care au creat / pentru care e programarea nu se repetă în fiecare rând: payload-ul are o hartă id → nume, doar pentru ids-urile din lună.
 */
import type { ApptStatus, ApptVM } from "@/app/components/types";

export const APPT_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Luna din manifest: câte programări are și versiunea (se schimbă dacă se adaugă / șterge / modifică ceva în luna aceea). */
export type ApptMonth = { month: string; count: number; version: string };

export type ApptTuple = [
  id: string, clientId: string, clientName: string, title: string, status: ApptStatus, dateKey: string, time: string, endTime: string,
  categoryName: string | null, categoryColor: string | null, color: string | null, remEmail: 0 | 1, remTelegram: 0 | 1,
  address: string, lat: number | null, lng: number | null, mapUrl: string, creatorId: string, assigneeId: string | null, categoryId: string | null,
  durationMinutes: number, remSchedule: string, remInterval: number, remOffsets: string[], message: string,
];

export type ApptPayload = { v: 1; month: string; names: Record<string, string>; rows: ApptTuple[] };

export function encodeAppt(a: ApptVM): ApptTuple {
  return [
    a.id, a.clientId, a.clientName, a.title, a.status, a.dateKey, a.time, a.endTime, a.categoryName, a.categoryColor, a.color, a.remEmail ? 1 : 0, a.remTelegram ? 1 : 0,
    a.address, a.lat, a.lng, a.mapUrl, a.creatorId, a.assigneeId, a.categoryId, a.durationMinutes, a.remSchedule, a.remInterval, a.remOffsets, a.message,
  ];
}

export function decodeAppt(t: ApptTuple, names: Record<string, string>): ApptVM {
  return {
    id: t[0], clientId: t[1], clientName: t[2], title: t[3], status: t[4], dateKey: t[5], time: t[6], endTime: t[7],
    categoryName: t[8], categoryColor: t[9], color: t[10], remEmail: t[11] === 1, remTelegram: t[12] === 1,
    address: t[13], lat: t[14], lng: t[15], mapUrl: t[16], creatorId: t[17], creatorName: (t[17] && names[t[17]]) || "",
    assigneeId: t[18], assigneeName: (t[18] && names[t[18]]) || null, categoryId: t[19], durationMinutes: t[20],
    remSchedule: t[21], remInterval: t[22], remOffsets: t[23], message: t[24],
  };
}
