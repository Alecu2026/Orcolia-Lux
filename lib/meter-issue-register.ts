// Registrul de nereguli de contor: filtre, sortare și câmpuri pre-calculate (cod partajat server / browser). Ca la Plătitori și Contoare, lista completă stă în browser,
// iar fiecare schimbare de filtru e o singură trecere prin rânduri, cu comparații pe câmpuri calculate o dată.

import { daysUntil } from "./contract-expiry";
import { addDaysToKey } from "./date";
import { DEFAULT_TZ, todayKey } from "./date";
import { ISSUE_KINDS, type IssueKind, type IssueRegisterRow } from "./meter-issues";

export type IssueSort = "dueAsc" | "reportedDesc" | "contor";

export type IssueFilters = {
  /** Căutare text (toate cuvintele): nr. contor, abonat, cont, contract, adresă, telefon. */
  q: string;
  /** Implicit „deschise”; "all" = și rezolvate. */
  status: "open" | "resolved" | "all";
  /** Termenul de remediere: depășit / în următoarele 7 zile / fără termen. */
  due: "" | "overdue" | "7d" | "none";
  /** Cine remediază; "none" = de stabilit. */
  resp: "" | "CLIENT" | "COMPANY" | "none";
  /** Secția (id echipă); "none" = fără secție; "mine" = secția / secțiile utilizatorului; "all" = toate (ales explicit, ca să nu revină la „mine”). */
  team: string;
  kind: "" | IssueKind;
  sort: IssueSort;
};

export const EMPTY_ISSUE_FILTERS: IssueFilters = { q: "", status: "open", due: "", resp: "", team: "", kind: "", sort: "dueAsc" };

const ONE_OF = <T extends string>(v: unknown, allowed: readonly T[]): T | "" => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : "");
type Source = URLSearchParams | Record<string, unknown>;
const get = (src: Source, k: string): unknown => (src instanceof URLSearchParams ? src.get(k) : src[k]);

/** Orice sursă (URL, sessionStorage) adusă la filtre valide; ce e necunoscut revine la implicit. */
export function sanitizeIssueFilters(src: Source): IssueFilters {
  const team = get(src, "team");
  return {
    q: typeof get(src, "q") === "string" ? String(get(src, "q")).trim().slice(0, 120) : "",
    status: ONE_OF(get(src, "status"), ["open", "resolved", "all"] as const) || "open",
    due: ONE_OF(get(src, "due"), ["overdue", "7d", "none"] as const),
    resp: ONE_OF(get(src, "resp"), ["CLIENT", "COMPANY", "none"] as const),
    team: typeof team === "string" && (team === "none" || team === "mine" || team === "all" || /^[0-9a-f]{24}$/i.test(team)) ? team : "",
    kind: ONE_OF(get(src, "kind"), ISSUE_KINDS),
    sort: ONE_OF(get(src, "sort"), ["dueAsc", "reportedDesc", "contor"] as const) || "dueAsc",
  };
}

/** Câte filtre diferă de cele implicite (sortarea nu se numără). */
export function countActiveIssueFilters(f: IssueFilters): number {
  return (f.q ? 1 : 0) + (f.status !== "open" ? 1 : 0) + (f.due ? 1 : 0) + (f.resp ? 1 : 0) + (f.team ? 1 : 0) + (f.kind ? 1 : 0);
}

/** Rândul cu câmpurile de lucru: _h = text de căutare, _d = zile până la termen (NaN = fără termen; negativ = depășit), _o = deschisă. */
export type IssueRow = IssueRegisterRow & { _h: string; _d: number; _o: boolean };

export function decodeIssueRows(rows: IssueRegisterRow[], today: string = todayKey(DEFAULT_TZ)): IssueRow[] {
  return rows.map((r) => ({
    ...r,
    _h: [r.contor, r.name, r.account, r.contract, r.address, r.phone, r.note].filter(Boolean).join("\n").toLowerCase(),
    _d: r.dueAt ? daysUntil(r.dueAt, today) : NaN,
    _o: !r.resolvedAt,
  }));
}

export function filterIssues(all: IssueRow[], f: IssueFilters, ownTeamIds: string[] = []): IssueRow[] {
  const tokens = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  const out: IssueRow[] = [];
  for (let i = 0, n = all.length; i < n; i++) {
    const r = all[i];
    if (f.status === "open" ? !r._o : f.status === "resolved" ? r._o : false) continue;
    if (tokens.length) {
      let ok = true;
      for (const tk of tokens) if (!r._h.includes(tk)) { ok = false; break; }
      if (!ok) continue;
    }
    if (f.kind && r.kind !== f.kind) continue;
    if (f.resp === "none" ? r.responsible !== null : f.resp ? r.responsible !== f.resp : false) continue;
    if (f.team === "none" ? r.teamId !== null : f.team === "mine" ? !(r.teamId && ownTeamIds.includes(r.teamId)) : f.team && f.team !== "all" ? r.teamId !== f.team : false) continue;
    if (f.due === "none" ? r.dueAt !== null : f.due === "overdue" ? !(r._o && r._d < 0) : f.due === "7d" ? !(r._o && r._d >= 0 && r._d <= 7) : false) continue;
    out.push(r);
  }
  if (f.sort === "reportedDesc") out.sort((a, b) => (a.reportedAt < b.reportedAt ? 1 : a.reportedAt > b.reportedAt ? -1 : 0));
  else if (f.sort === "contor") out.sort((a, b) => a.contor.localeCompare(b.contor, "ro", { numeric: true }));
  else {
    // termenul cel mai apropiat (și cel depășit) primul; fără termen la final
    out.sort((a, b) => {
      const x = a._d, y = b._d;
      const xn = Number.isNaN(x), yn = Number.isNaN(y);
      if (xn && yn) return a.reportedAt < b.reportedAt ? 1 : -1;
      if (xn) return 1;
      if (yn) return -1;
      return x - y || (a.reportedAt < b.reportedAt ? 1 : -1);
    });
  }
  return out;
}

export type IssueCounts = { open: number; overdue: number; soon: number; client: number; company: number };
export function countIssues(all: IssueRow[]): IssueCounts {
  const c: IssueCounts = { open: 0, overdue: 0, soon: 0, client: 0, company: 0 };
  for (const r of all) {
    if (!r._o) continue;
    c.open++;
    if (r._d < 0) c.overdue++;
    else if (r._d <= 7) c.soon++;
    if (r.responsible === "CLIENT") c.client++;
    else if (r.responsible === "COMPANY") c.company++;
  }
  return c;
}

// ── Filtrul „Nereguli contoare” din listele de plătitori (Plătitori, Notificări plătitori) ──

/** Neregulile de contor ale plătitorului: cu neregulă deschisă / termen depășit / expiră în 7 zile / fără nereguli. */
export type PayerIssueFilter = "" | "open" | "overdue" | "7d" | "none";
export const PAYER_ISSUE_FILTER_VALUES = ["open", "overdue", "7d", "none"] as const;
export const PAYER_ISSUE_OPTIONS: { value: Exclude<PayerIssueFilter, "">; label: string }[] = [
  { value: "open", label: "Cu neregulă de contor deschisă" },
  { value: "overdue", label: "Nereguli: termen depășit" },
  { value: "7d", label: "Nereguli: termen în 7 zile" },
  { value: "none", label: "Fără nereguli de contor" },
];

export function matchesPayerIssueFilter(open: number, dueKey: string | null | undefined, f: PayerIssueFilter, today: string): boolean {
  if (!f) return true;
  if (f === "none") return !open;
  if (!open) return false;
  if (f === "open") return true;
  if (!dueKey) return false;
  const d = daysUntil(dueKey, today);
  return f === "overdue" ? d < 0 : d >= 0 && d <= 7;
}

/** Limitele „YYYY-MM-DD” ale filtrului pe termen, pentru interogarea în baza de date. */
export function payerIssueBounds(f: PayerIssueFilter, today: string = todayKey(DEFAULT_TZ)): { gte?: string; lte?: string; lt?: string } | null {
  if (f === "overdue") return { lt: today };
  if (f === "7d") return { gte: today, lte: addDaysToKey(today, 7) };
  return null;
}
