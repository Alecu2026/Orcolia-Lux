// Starea contorului și neregulile: ce poate raporta cititorul în teren + indicatorii deduși din datele 1C (cod partajat server / browser).

import { isEstimatedSource } from "./meters";

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

/** Cine trebuie să remedieze neregula. Lipsa (null) = de stabilit de personal. */
export type IssueResponsible = "CLIENT" | "COMPANY";
export const RESPONSIBLE_LABELS: Record<IssueResponsible, string> = { CLIENT: "Clientul", COMPANY: "Compania" };
export const isResponsible = (v: unknown): v is IssueResponsible => v === "CLIENT" || v === "COMPANY";

/** Regula unui tip de neregulă: cine remediază (gol = de stabilit), în câte zile de la raportare și ce secție (echipă) răspunde (gol = fără secție). */
export type IssueRule = { responsible: IssueResponsible | ""; days: number; teamId: string };
export type IssueRules = Record<IssueKind, IssueRule>;
export const ISSUE_DAYS_MAX = 365;

/** Valorile implicite: clientul răspunde de ce ține de el (sigiliu, fraudă, acces, citire), compania de defecte; scurgerea și „altele” se stabilesc la fața locului. */
export const DEFAULT_ISSUE_RULES: IssueRules = {
  DEFECT: { responsible: "COMPANY", days: 14, teamId: "" },
  REVERSE: { responsible: "COMPANY", days: 14, teamId: "" },
  FRAUD: { responsible: "CLIENT", days: 10, teamId: "" },
  SEAL: { responsible: "CLIENT", days: 10, teamId: "" },
  LEAK: { responsible: "", days: 7, teamId: "" },
  UNREADABLE: { responsible: "CLIENT", days: 10, teamId: "" },
  INACCESSIBLE: { responsible: "CLIENT", days: 10, teamId: "" },
  OTHER: { responsible: "", days: 10, teamId: "" },
};

/** Regulile din setări (JSON) aduse la forma validă: ce lipsește sau e invalid revine la valoarea implicită. */
export function sanitizeIssueRules(raw: unknown): IssueRules {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = {} as IssueRules;
  for (const k of ISSUE_KINDS) {
    const d = DEFAULT_ISSUE_RULES[k];
    const r = src[k] && typeof src[k] === "object" ? (src[k] as Record<string, unknown>) : {};
    const days = typeof r.days === "number" && Number.isInteger(r.days) && r.days >= 1 && r.days <= ISSUE_DAYS_MAX ? r.days : d.days;
    out[k] = {
      responsible: r.responsible === "" || isResponsible(r.responsible) ? (r.responsible as IssueResponsible | "") : d.responsible,
      days,
      teamId: typeof r.teamId === "string" && /^[0-9a-f]{24}$/i.test(r.teamId) ? r.teamId : "",
    };
  }
  return out;
}

/** Denumirile tipurilor în rusă (pentru emailurile către clienți, bilingve). */
export const ISSUE_LABELS_RU: Record<IssueKind, string> = {
  DEFECT: "Неисправный счётчик",
  REVERSE: "Обратный ход счётчика",
  FRAUD: "Подозрение на вмешательство",
  SEAL: "Пломба сорвана или отсутствует",
  LEAK: "Утечка у счётчика / на вводе",
  UNREADABLE: "Показания не читаются",
  INACCESSIBLE: "Нет доступа к счётчику",
  OTHER: "Другая проблема",
};

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
  /** Cine remediază (null = de stabilit), secția responsabilă și termenul de remediere („YYYY-MM-DD”). */
  responsible: IssueResponsible | null;
  teamId: string | null;
  teamName: string | null;
  dueAt: string | null;
};

/** Un rând din registrul de nereguli: neregula + datele contorului / abonatului. */
export type IssueRegisterRow = IssueDto & {
  name: string;
  account: string | null;
  contract: string | null;
  address: string | null;
  phone: string | null;
  clientId: string | null;
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
    if (isEstimatedSource(last.sursa)) out.push({ code: "ESTIMATED", label: "Ultimul consum e calculat (estimat), nu citit", detail: last.month, serious: false });
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
