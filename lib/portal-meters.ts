// Contoarele plătitorului în portal: tipuri + regulile partajate între server și formular (fără server-only).

import type { IssueKind } from "./meter-issues";

/** Neregulile pe care le poate raporta un plătitor (fraudă / contor inaccesibil sunt constatări ale personalului, nu ale plătitorului). */
export const PORTAL_ISSUE_KINDS: IssueKind[] = ["DEFECT", "LEAK", "SEAL", "UNREADABLE", "REVERSE", "OTHER"];

export type PortalReadingDto = {
  id: string;
  period: string;
  value: number;
  /** Consumul față de indexul anterior (m³), dacă se cunoaște. */
  consum: number | null;
  readAt: string;
  photoUrl: string | null;
  /** „PORTAL” = trimisă de plătitor; „FIELD” = citită de cititor. */
  source: "PORTAL" | "FIELD";
};

export type PortalMeterDto = {
  id: string;
  contor: string;
  address: string | null;
  /** Ultimul index cunoscut (1C sau o citire anterioară) și data lui. */
  lastIndex: number | null;
  lastDate: string | null;
  /** Citirea lunii curente, dacă există (a plătitorului sau a cititorului). */
  thisMonth: PortalReadingDto | null;
  /** Neregulile deschise (încă nerezolvate de personal). */
  openIssues: { kind: IssueKind; note: string | null; reportedAt: string }[];
  /** Citirile ultimelor luni (cele mai noi primele), fără luna curentă. */
  history: PortalReadingDto[];
};

export type PortalReadingResult =
  | { ok: true; readingId: string; value: number; consum: number | null; issueSaved: boolean; issueError?: string }
  | { ok: false; error: string; confirm?: "lower" | "high" };
