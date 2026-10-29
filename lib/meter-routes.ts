// Rutele de citire: reguli (după datele din 1C), potrivirea contoarelor cu rutele, fereastra din lună, raportul planificat / citit (cod partajat server / browser).
import { addressKey } from "./meters";
import { localityOf, type FieldTuple } from "./meter-readings";

export const MAX_ROUTES = 200;
export const MAX_RULE_VALUES = 300;
export const MAX_ROUTE_NAME = 80;

export type RouteDto = {
  id: string;
  name: string;
  /** valorile „Участок” (sector) din 1C */
  sectors: string[];
  localities: string[];
  /** fragmente de adresă / stradă */
  streets: string[];
  readerId: string | null;
  startDay: number;
  endDay: number;
  order: number;
  active: boolean;
};

export type RouteInput = Omit<RouteDto, "id" | "order"> & { id?: string };

/** Ce trebuie să aibă un contor ca să poată fi potrivit cu o rută. */
export type RouteMeter = { sector: string | null; address: string | null };

const key = (s: string) => addressKey(s);
const clean = (a: unknown): string[] => {
  if (!Array.isArray(a)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of a) {
    const s = String(v ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
    if (!s || seen.has(key(s))) continue;
    seen.add(key(s));
    out.push(s);
    if (out.length >= MAX_RULE_VALUES) break;
  }
  return out;
};

/** Validează / curăță datele unei rute venite din formular. */
export function sanitizeRouteInput(raw: unknown): { ok: true; value: RouteInput } | { ok: false; error: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const name = String(r.name ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_ROUTE_NAME);
  if (!name) return { ok: false, error: "Scrie un nume pentru rută." };
  const sectors = clean(r.sectors);
  const localities = clean(r.localities);
  const streets = clean(r.streets);
  if (sectors.length + localities.length + streets.length === 0) return { ok: false, error: "Alege cel puțin o regulă: sector, localitate sau stradă." };
  const startDay = Math.round(Number(r.startDay));
  const endDay = Math.round(Number(r.endDay));
  if (!Number.isFinite(startDay) || !Number.isFinite(endDay) || startDay < 1 || endDay > 31 || startDay > endDay) return { ok: false, error: "Fereastra de citire: zile între 1 și 31, începutul înainte de sfârșit." };
  const readerId = typeof r.readerId === "string" && /^[0-9a-f]{24}$/i.test(r.readerId) ? r.readerId : null;
  return { ok: true, value: { id: typeof r.id === "string" ? r.id : undefined, name, sectors, localities, streets, readerId, startDay, endDay, active: r.active !== false } };
}

type Prepared = { id: string; sectors: Set<string>; localities: Set<string>; streets: string[] };

/** Regulile pregătite o singură dată (fără diacritice / majuscule) ca potrivirea a mii de contoare să fie rapidă. */
export function prepareRoutes(routes: RouteDto[]): Prepared[] {
  return routes
    .filter((r) => r.active)
    .sort((a, b) => a.order - b.order)
    .map((r) => ({ id: r.id, sectors: new Set(r.sectors.map(key)), localities: new Set(r.localities.map(key)), streets: r.streets.map(key).filter(Boolean) }));
}

/** Id-ul rutei căreia îi aparține contorul (prima potrivită, după ordine) sau null. Regulile de tipuri diferite se combină cu „ȘI”, valorile aceluiași tip cu „SAU”. */
export function routeOf(m: RouteMeter, prepared: Prepared[]): string | null {
  const sec = m.sector ? key(m.sector) : "";
  const loc = m.address ? key(localityOf(m.address)) : "";
  const addr = m.address ? key(m.address) : "";
  for (const r of prepared) {
    if (r.sectors.size && !r.sectors.has(sec)) continue;
    if (r.localities.size && !r.localities.has(loc)) continue;
    if (r.streets.length && !r.streets.some((s) => addr.includes(s))) continue;
    return r.id;
  }
  return null;
}

/** Ziua curentă din lună în fusul firmei (1–31) și luna („YYYY-MM”). */
export function todayInFirm(now: Date = new Date()): { day: number; period: string; daysInMonth: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const y = g("year");
  const m = g("month");
  return { day: g("day"), period: `${y}-${String(m).padStart(2, "0")}`, daysInMonth: new Date(Date.UTC(y, m, 0)).getUTCDate() };
}

export type WindowState = "before" | "open" | "late";
/** Unde ne aflăm față de fereastra rutei: înainte de ea, în ea, sau după (termenul a trecut). */
export function windowState(r: Pick<RouteDto, "startDay" | "endDay">, day: number): WindowState {
  return day < r.startDay ? "before" : day <= r.endDay ? "open" : "late";
}

/** Câte contoare ar trebui citite până azi dacă ritmul e uniform în fereastră (pentru „planificat până azi”). */
export function plannedByToday(total: number, r: Pick<RouteDto, "startDay" | "endDay">, day: number): number {
  if (day < r.startDay) return 0;
  if (day >= r.endDay) return total;
  const span = r.endDay - r.startDay + 1;
  return Math.min(total, Math.ceil((total * (day - r.startDay + 1)) / span));
}

// ── Raportul planificat / citit ────────────────────────────────────────────────────────────────

export type RouteStat = {
  routeId: string;
  name: string;
  readerId: string | null;
  readerName: string | null;
  startDay: number;
  endDay: number;
  state: WindowState;
  planned: number;
  /** citite de cititorul rutei */
  readByReader: number;
  /** citite de altcineva */
  readByOthers: number;
  unread: number;
  /** câte ar fi trebuit citite până azi (ritm uniform în fereastră) */
  dueToday: number;
  /** contoare cu neregulă deschisă pe rută */
  issues: number;
  /** momentul ultimei citiri din lună pe această rută (ms), sau null */
  lastAt: number | null;
};

export type ReaderStat = {
  readerId: string | null;
  readerName: string;
  routes: number;
  planned: number;
  readByReader: number;
  readByOthers: number;
  unread: number;
  dueToday: number;
  /** citiri făcute de el în afara rutelor lui (sau fără rută) */
  readElsewhere: number;
  /** cele mai noi / cele mai vechi citiri din lună, ms */
  firstAt: number | null;
  lastAt: number | null;
};

export type RouteReport = {
  period: string;
  day: number;
  daysInMonth: number;
  routes: RouteStat[];
  readers: ReaderStat[];
  /** contoare active fără rută */
  noRoute: { total: number; read: number };
  totalMeters: number;
};

export type RouteOptions = {
  sectors: { value: string; count: number }[];
  localities: { value: string; count: number }[];
  streets: string[];
};

/** Tot ce are nevoie pagina „Rute de citire”: raportul, toate rutele (și cele inactive), neregulile și utilizatorii (cititori). Se aduce dintr-o singură trecere pe server. */
export type RoutesBundle = {
  report: RouteReport;
  routes: RouteDto[];
  issues: import("./meter-issues").IssueDto[];
  users: { id: string; name: string }[];
  /** momentul calculării (ms) */
  at: number;
};

/** Ce primește pagina „Citiri teren”: lista contoarelor + rutele active (pentru „Ruta mea”). */
export type FieldList = { period: string; rows: FieldTuple[]; routes: RouteDto[] };
