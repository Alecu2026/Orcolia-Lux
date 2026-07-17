import * as XLSX from "xlsx";

export type ParsedRow = Record<string, string>;

/**
 * Parsează un fișier Excel sau CSV și returnează rândurile ca obiecte.
 * Prima linie devine cheile obiectului (antet). Valorile sunt întotdeauna string.
 */
export function parseWorkbook(buffer: ArrayBuffer): ParsedRow[] {
  const wb = XLSX.read(buffer, { type: "array", cellText: true, cellDates: false, codepage: 65001 });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];

  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: "",
    raw: false,
  });

  return raw.map((row) => {
    const cleaned: ParsedRow = {};
    for (const [k, v] of Object.entries(row)) {
      // Strip BOM ﻿ that SheetJS includes in the first column when parsing BOM-prefixed CSV
      const key = String(k).replace(/^﻿/, "").trim();
      cleaned[key] = String(v ?? "").trim();
    }
    return cleaned;
  });
}

// ─── Reverse-maps: Romanian label → DB enum ────────────────────────────────

export const RO_TO_TASK_STATUS: Record<string, string> = {
  "Nou": "NEW",
  "Asignat": "ASSIGNED",
  "Citit": "READ",
  "În lucru": "IN_PROGRESS",
  "In lucru": "IN_PROGRESS",
  "În așteptare": "ON_HOLD",
  "In asteptare": "ON_HOLD",
  "Review": "REVIEW",
  "Finalizat": "DONE",
  "Anulat": "CANCELLED",
};

export const RO_TO_TASK_PRIORITY: Record<string, string> = {
  "Scăzută": "LOW",
  "Scazuta": "LOW",
  "Medie": "MEDIUM",
  "Ridicată": "HIGH",
  "Ridicata": "HIGH",
  "Urgentă": "URGENT",
  "Urgenta": "URGENT",
};

export const RO_TO_TASK_TYPE: Record<string, string> = {
  "Task": "TASK",
  "Tichet": "TICKET",
};

export const RO_TO_PROJECT_STATUS: Record<string, string> = {
  "Activ": "ACTIVE",
  "În așteptare": "ON_HOLD",
  "In asteptare": "ON_HOLD",
  "Finalizat": "DONE",
  "Arhivat": "ARCHIVED",
};

export const RO_TO_APPT_STATUS: Record<string, string> = {
  "Nou": "NEW",
  "Confirmat": "CONFIRMED",
  "În lucru": "IN_PROGRESS",
  "In lucru": "IN_PROGRESS",
  "Finalizat": "DONE",
  "Anulat": "CANCELLED",
  "Absent": "NO_SHOW",
};

/**
 * Parsează un string dată în format românesc "ZZ.LL.AAAA" sau ISO "AAAA-LL-ZZ".
 * Returnează dateKey "AAAA-LL-ZZ" sau null dacă formatul nu este recunoscut.
 */
export function parseRoDateKey(s: string): string | null {
  s = s.trim();
  // DD.MM.YYYY
  const ro = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (ro) {
    const [, d, m, y] = ro;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  return null;
}

/**
 * Parsează "HH:mm" sau "H:mm" și returnează același format normalizat sau null.
 */
export function parseTime(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = m[1].padStart(2, "0");
  const min = m[2];
  if (Number(h) > 23 || Number(min) > 59) return null;
  return `${h}:${min}`;
}

export type ImportResult = {
  imported: number;
  total: number;
  failed: { row: number; error: string }[];
};
