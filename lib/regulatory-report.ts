import { deadlineState } from "./task-deadline";

/**
 * Raportul „Petiții și reclamații cu privire la furnizarea serviciului” din exportul de cereri / sarcini (foaia „Raport”): aceleași coloane ca în formularul de raportare —
 * Nr.ord., Indicatori, Unitate de măsură, apă, canalizare, apă și canalizare, total pe întreprindere — plus o coloană „din total: tip serviciu nespecificat”
 * (totalul include și cererile fără tip de serviciu) și rândurile suplimentare din CRM (în lucru, expirate, casnic / non casnic, timp mediu, feedback).
 * Funcție pură (fără baza de date): primește rândurile exportate și, pentru fiecare, originea / șablonul calculate de export.
 */
export type ReportItem = {
  id: string;
  status: string;
  dueAt: Date | null;
  closedAt: Date | null;
  executedOn: string | null;
  serviceType: string | null;
  consumerType: string | null;
  resolutionMinutes: number | null;
  feedbackRating: number | null;
};

export type ReportMeta = {
  /** Pentru fiecare id: de unde vine și din ce șablon (portal / intern). */
  byId: Map<string, { origin: "PORTAL" | "INTERNAL" | "EMAIL"; portalTplId: string | null; internalTplId: string | null }>;
  portalTemplates: { id: string; name: string }[];
  /** Șabloanele interne (și cele șterse între timp, cu numele salvat la creare). */
  internalTemplates: { id: string; name: string }[];
};

export type ReportSheet = { name: string; rows: (string | number)[][]; widths: number[]; merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] };

const SVC_IDX: Record<string, number> = { WATER: 0, SEWER: 1, BOTH: 2 };
const UNIT = "unități";

export function buildRegulatoryReport(items: ReportItem[], meta: ReportMeta, kind: "tickets" | "tasks"): ReportSheet {
  const noun = kind === "tickets" ? "cereri" : "sarcini";
  const info = (id: string) => meta.byId.get(id) ?? { origin: "INTERNAL" as const, portalTplId: null, internalTplId: null };

  /** [apă, canalizare, apă + canalizare, total, din total: nespecificat] pentru rândurile care trec testul. */
  const count = (pred: (t: ReportItem) => boolean): number[] => {
    const c = [0, 0, 0, 0, 0];
    for (const t of items) {
      if (!pred(t)) continue;
      c[3]++;
      const i = SVC_IDX[t.serviceType ?? ""];
      if (i == null) c[4]++;
      else c[i]++;
    }
    return c;
  };
  /** Media unei valori (rotunjită la o zecimală) pe fiecare coloană; „–” unde nu există date. */
  const avg = (pred: (t: ReportItem) => boolean, val: (t: ReportItem) => number | null): (string | number)[] => {
    const sum = [0, 0, 0, 0, 0], n = [0, 0, 0, 0, 0];
    for (const t of items) {
      const v = pred(t) ? val(t) : null;
      if (v == null) continue;
      const i = SVC_IDX[t.serviceType ?? ""];
      for (const k of [i == null ? 4 : i, 3]) { sum[k] += v; n[k]++; }
    }
    return sum.map((s, k) => (n[k] ? Math.round((s / n[k]) * 10) / 10 : "–"));
  };

  const rows: (string | number)[][] = [];
  const add = (nr: string | number, label: string, unit: string, vals: (string | number)[]) => rows.push([nr, label, unit, ...vals]);
  const state = (t: ReportItem) => deadlineState(t);
  const done = (t: ReportItem) => t.status === "DONE";

  // 1. numărul total, pe tipuri / șabloane
  add(1, `Numărul total de ${noun} cu privire la:`, UNIT, count(() => true));
  if (kind === "tickets") {
    for (const p of meta.portalTemplates) add("", p.name, UNIT, count((t) => info(t.id).origin === "PORTAL" && info(t.id).portalTplId === p.id));
    add("", "Altă cerere din portal (fără șablon)", UNIT, count((t) => info(t.id).origin === "PORTAL" && !info(t.id).portalTplId));
    const email = count((t) => info(t.id).origin === "EMAIL");
    if (email[3]) add("", "Primite pe email", UNIT, email);
  }
  for (const s of meta.internalTemplates) {
    add("", kind === "tickets" ? `Create de noi: ${s.name}` : s.name, UNIT, count((t) => info(t.id).origin === "INTERNAL" && info(t.id).internalTplId === s.id));
  }
  add("", kind === "tickets" ? "Create de noi, fără șablon intern" : "Fără șablon", UNIT, count((t) => info(t.id).origin === "INTERNAL" && !info(t.id).internalTplId));

  // 2. răspunsuri emise = rezolvate, în termen / peste termen
  add(2, `Numărul total de răspunsuri emise cu privire la examinarea și soluționarea ${kind === "tickets" ? "cererilor" : "sarcinilor"} (rezolvate)`, UNIT, count(done));
  add("", `număr de răspunsuri emise în termen`, UNIT, count((t) => state(t) === "done_on_time"));
  add("", `număr de răspunsuri emise peste termen`, UNIT, count((t) => state(t) === "done_late"));
  add("", `rezolvate fără termen stabilit sau cu data rezolvării necunoscută`, UNIT, count((t) => state(t) === "done_no_due" || state(t) === "done_unknown"));

  // 3. informații suplimentare din CRM
  add(3, "Informații suplimentare (din CRM)", UNIT, count(() => true));
  add("", `${noun} în lucru, în termen sau fără termen`, UNIT, count((t) => state(t) === "open_on_time" || state(t) === "open_no_due"));
  add("", `${noun} expirate (nerezolvate, termen depășit)`, UNIT, count((t) => state(t) === "expired"));
  add("", `${noun} anulate`, UNIT, count((t) => state(t) === "cancelled"));
  add("", "consumatori casnici", UNIT, count((t) => t.consumerType === "HOUSEHOLD"));
  add("", "consumatori non casnici", UNIT, count((t) => t.consumerType === "NON_HOUSEHOLD"));
  add("", "tip consumator nespecificat", UNIT, count((t) => t.consumerType !== "HOUSEHOLD" && t.consumerType !== "NON_HOUSEHOLD"));
  add("", "timp mediu de rezolvare (cele cu timpul înregistrat)", "ore", avg(done, (t) => (t.resolutionMinutes != null && t.resolutionMinutes >= 0 ? t.resolutionMinutes / 60 : null)));
  add("", "nota medie dată de client (1–5)", "puncte", avg(() => true, (t) => (t.feedbackRating != null ? t.feedbackRating : null)));

  const title = kind === "tickets" ? "Petiții și reclamații cu privire la furnizarea serviciului" : "Sarcini cu privire la furnizarea serviciului";
  const head = ["Nr.ord.", "Indicatori", "Unitate de măsură", "Serviciul public de alimentare cu apă", "Serviciul public de canalizare", "Serviciul public de alimentare cu apă și de canalizare", "Total pe întreprindere", "Din total: tip serviciu nespecificat"];
  return {
    name: "Raport",
    widths: [9, 68, 16, 22, 22, 26, 18, 22],
    merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }, { s: { r: rows.length + 5, c: 0 }, e: { r: rows.length + 5, c: 7 } }],
    rows: [
      [title],
      [],
      head,
      [1, 2, 3, 4, 5, 6, 7, 8],
      ...rows,
      [],
      ["Totalul pe întreprindere include și rândurile cu tipul de serviciu nespecificat (coloana 8); coloanele 4–6 numără doar cele cu tipul de serviciu ales."],
    ],
  };
}
