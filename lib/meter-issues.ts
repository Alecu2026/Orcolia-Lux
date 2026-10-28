// Starea contorului și neregulile: ce poate raporta cititorul în teren + indicatorii deduși din datele 1C (cod partajat server / browser).

export const ISSUE_KINDS = ["DEFECT", "REVERSE", "FRAUD", "SEAL", "LEAK", "UNREADABLE", "INACCESSIBLE", "OTHER"] as const;
export type IssueKind = (typeof ISSUE_KINDS)[number];

/** Etichetele (cheile de traducere) — „Normal” nu e o neregulă și nu se salvează. */
export const ISSUE_LABELS: Record<IssueKind, string> = {
  DEFECT: "Contor defect",
  REVERSE: "Curgere inversă",
  FRAUD: "Suspiciune de fraudă / intervenție",
  SEAL: "Sigiliu rupt sau lipsă",
  LEAK: "Scurgere la contor / branșament",
  UNREADABLE: "Index ilizibil (geam aburit, murdar, spart)",
  INACCESSIBLE: "Contor inaccesibil (nu l-am putut citi)",
  OTHER: "Altă problemă",
};

/** Neregulile care apar ca avertisment roșu (restul sunt informative). */
export const SERIOUS_ISSUES: IssueKind[] = ["FRAUD", "REVERSE", "DEFECT", "LEAK"];

export const MAX_ISSUE_NOTE = 500;

export const isIssueKind = (v: unknown): v is IssueKind => typeof v === "string" && (ISSUE_KINDS as readonly string[]).includes(v);

export type IssueDto = {
  id: string;
  meterId: string;
  contor: string;
  kind: IssueKind;
  note: string | null;
  period: string;
  reportedAt: string;
  userName: string;
  resolvedAt: string | null;
  resolvedName: string | null;
  resolvedNote: string | null;
};

/** Un indicator dedus din datele 1C (nu e o neregulă confirmată — semnalează ce merită verificat). */
export type OneCIndicator = { code: "NEGATIVE" | "ZERO" | "ESTIMATED" | "HIGH" | "NO_SEAL" | "REMOVED"; label: string; detail: string; serious: boolean };

type MonthLike = { month: string; prev: number | null; curr: number | null; consum: number | null; sursa: string | null };

const nf = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",");

/**
 * Indicatorii din datele 1C ale contorului (lunile cele mai noi primele): index mai mic decât cel anterior / consum negativ (curgere inversă sau contor înlocuit),
 * consum zero luni la rând (contor blocat sau casă nelocuită), consum estimat în loc de citire, consum mult peste media lunilor anterioare, sigiliu lipsă, contor scos.
 * `label` și `detail` sunt chei de traducere cu {param}; textul final se compune în interfață.
 */
export function onecIndicators(d: { months: MonthLike[]; sigiliu: string | null; removedAt: string | null }): OneCIndicator[] {
  const out: OneCIndicator[] = [];
  const m = d.months.filter((x) => x.curr != null);
  const last = m[0];
  if (last) {
    const neg = (last.consum != null && last.consum < 0) || (last.prev != null && last.curr != null && last.curr < last.prev);
    if (neg) {
      out.push({
        code: "NEGATIVE",
        label: "Index mai mic decât cel anterior (curgere inversă sau contor înlocuit)",
        detail: `${last.month}: ${last.prev != null ? nf(last.prev) : "—"} → ${last.curr != null ? nf(last.curr) : "—"} m³`,
        serious: true,
      });
    }
    let zeros = 0;
    for (const x of m) {
      if (x.consum === 0) zeros++;
      else break;
    }
    if (zeros >= 3) out.push({ code: "ZERO", label: "Consum zero {n} luni la rând (contor blocat sau imobil nelocuit)", detail: String(zeros), serious: false });
    if (last.sursa && /расч/i.test(last.sursa)) out.push({ code: "ESTIMATED", label: "Ultimul consum e calculat (estimat), nu citit", detail: last.month, serious: false });
    const prevMonths = m.slice(1, 13).map((x) => x.consum).filter((c): c is number => c != null && c >= 0);
    if (last.consum != null && last.consum > 0 && prevMonths.length >= 3) {
      const avg = prevMonths.reduce((s, c) => s + c, 0) / prevMonths.length;
      if (avg > 0 && last.consum > Math.max(5, avg * 3)) {
        out.push({ code: "HIGH", label: "Consum de {x}× peste media lunilor anterioare", detail: `${last.month}: ${nf(last.consum)} m³ (media ${nf(avg)} m³)`, serious: true });
      }
    }
  }
  if (d.removedAt) out.push({ code: "REMOVED", label: "Contor scos din uz la {date}", detail: d.removedAt, serious: false });
  else if (!d.sigiliu) out.push({ code: "NO_SEAL", label: "Fără sigiliu înregistrat în 1C", detail: "", serious: false });
  return out;
}

/** Raportul consum / medie, rotunjit, pentru eticheta „{x}×”. */
export function highRatio(detail: string): string {
  const cm = /([\d,.]+) m³ \(media ([\d,.]+)/.exec(detail);
  if (!cm) return "";
  const c = Number(cm[1].replace(",", "."));
  const a = Number(cm[2].replace(",", "."));
  return a > 0 ? String(Math.round((c / a) * 10) / 10).replace(".", ",") : "";
}
