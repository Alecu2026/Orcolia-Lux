import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { listRoutes, toRouteDto } from "./meter-route-data";
import { logAudit } from "./audit";
import { getFieldList, type AuditUser } from "./meter-readings";
import { listIssues } from "./meter-issues";
import { auditUserOptions } from "../queries/audit";
import { localityOf } from "../meter-readings";
import {
  plannedByToday,
  prepareRoutes,
  routeOf,
  sanitizeRouteInput,
  todayInFirm,
  windowState,
  MAX_ROUTES,
  type ReaderStat,
  type RouteDto,
  type RouteOptions,
  type RouteReport,
  type RouteStat,
  type RoutesBundle,
} from "../meter-routes";

const actorOf = (u: AuditUser) => ({ id: u.id, name: u.name, role: u.role, isSuperAdmin: u.isSuperAdmin });

// ── Administrare ───────────────────────────────────────────────────────────────────────────────────────────────────────

export async function saveRoute(actor: AuditUser, raw: unknown): Promise<{ ok: true; route: RouteDto } | { ok: false; error: string }> {
  if (DEMO) return { ok: false, error: "Mod demo." };
  const v = sanitizeRouteInput(raw);
  if (!v.ok) return v;
  const d = v.value;
  if (d.readerId && !(await prisma.user.findUnique({ where: { id: d.readerId }, select: { id: true } }))) return { ok: false, error: "Cititorul ales nu mai există." };
  const data = { name: d.name, sectors: d.sectors, localities: d.localities, streets: d.streets, readerId: d.readerId, startDay: d.startDay, endDay: d.endDay, active: d.active };
  const rules = [d.sectors.length ? `sectoare: ${d.sectors.join(", ")}` : "", d.localities.length ? `localități: ${d.localities.join(", ")}` : "", d.streets.length ? `străzi: ${d.streets.join(", ")}` : ""].filter(Boolean).join(" · ");
  const extra = [{ label: "Reguli", value: rules }, { label: "Fereastra de citire", value: `zilele ${d.startDay}–${d.endDay}` }];

  if (d.id) {
    const old = await prisma.readingRoute.findUnique({ where: { id: d.id } });
    if (!old) return { ok: false, error: "Ruta nu mai există." };
    const row = await prisma.readingRoute.update({ where: { id: d.id }, data });
    invalidateRoutesBundle();
    await logAudit(actorOf(actor), { action: "meter.route_update", module: "Meters", objectId: null, objectName: row.name, details: { extra } });
    return { ok: true, route: toRouteDto(row) };
  }
  if ((await prisma.readingRoute.count()) >= MAX_ROUTES) return { ok: false, error: "Prea multe rute." };
  const last = await prisma.readingRoute.findFirst({ orderBy: { order: "desc" }, select: { order: true } });
  const row = await prisma.readingRoute.create({ data: { ...data, order: (last?.order ?? 0) + 1 } });
  invalidateRoutesBundle();
  await logAudit(actorOf(actor), { action: "meter.route_create", module: "Meters", objectId: null, objectName: row.name, details: { extra } });
  return { ok: true, route: toRouteDto(row) };
}

export async function deleteRoute(actor: AuditUser, id: string): Promise<{ ok: boolean; error?: string }> {
  if (DEMO) return { ok: false, error: "Mod demo." };
  const row = await prisma.readingRoute.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "Ruta nu mai există." };
  await prisma.readingRoute.delete({ where: { id } });
  invalidateRoutesBundle();
  await logAudit(actorOf(actor), { action: "meter.route_delete", module: "Meters", objectId: null, objectName: row.name });
  return { ok: true };
}

/** Mută ruta mai sus / mai jos: ordinea decide cărei rute îi aparține un contor potrivit cu mai multe. */
export async function moveRoute(id: string, dir: "up" | "down"): Promise<void> {
  if (DEMO) return;
  const all = await prisma.readingRoute.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }], select: { id: true } });
  const i = all.findIndex((r) => r.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= all.length) return;
  const ids = all.map((r) => r.id);
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await prisma.$transaction(ids.map((rid, n) => prisma.readingRoute.update({ where: { id: rid }, data: { order: n + 1 } })));
  invalidateRoutesBundle();
}

/** Valorile din care se alege la reguli: sectoarele din 1C, localitățile și străzile din adresele contoarelor active. */
let optionsMemo: { at: number; value: RouteOptions } | null = null;
const OPTIONS_TTL_MS = 60_000;

export async function getRouteOptions(): Promise<RouteOptions> {
  if (optionsMemo && Date.now() - optionsMemo.at < OPTIONS_TTL_MS) return optionsMemo.value;
  const { rows } = await getFieldList();
  const sectors = new Map<string, number>();
  const localities = new Map<string, number>();
  const streets = new Set<string>();
  // direct din tupluri (id, contor, abonat, adresă, …, sector la poziția 16): fără a crea obiecte pentru toate contoarele
  for (const r of rows) {
    const sector = r[16];
    const address = r[3];
    const locality = localityOf(address);
    if (sector) sectors.set(sector, (sectors.get(sector) ?? 0) + 1);
    if (locality) localities.set(locality, (localities.get(locality) ?? 0) + 1);
    if (address) {
      const parts = address.split(",").map((x) => x.trim());
      const st = parts.slice(1).find((x) => /^(str\.|strada|bd\.|bdul|bulevardul|aleea|al\.|piața|fundătura|fnd\.|șos\.|sos\.|drumul)/i.test(x));
      if (st) streets.add(st);
    }
  }
  const list = (m: Map<string, number>) => [...m].map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value, "ro", { numeric: true }));
  const value = { sectors: list(sectors), localities: list(localities), streets: [...streets].sort((a, b) => a.localeCompare(b, "ro", { numeric: true })).slice(0, 3000) };
  optionsMemo = { at: Date.now(), value };
  return value;
}

// ── Planificat vs citit ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Raportul lunii curente: pentru fiecare rută câte contoare sunt planificate, câte au fost citite de cititorul rutei și de alții, câte au rămas, câte
 * ar fi trebuit citite până azi; apoi totalurile pe cititor. Un contor aparține primei rute (după ordine) ale cărei reguli i se potrivesc.
 */
export async function getRouteReport(listPromise?: ReturnType<typeof getFieldList>, routesPromise?: ReturnType<typeof listRoutes>): Promise<RouteReport> {
  const today = todayInFirm();
  const [list, routes, issues, readings] = await Promise.all([
    listPromise ?? getFieldList(),
    routesPromise ?? listRoutes(),
    prisma.meterIssue.findMany({ where: { resolvedAt: null }, select: { meterId: true } }),
    prisma.meterReading.findMany({ where: { period: todayInFirm().period }, select: { meterId: true, userId: true, userName: true, readAt: true } }),
  ]);
  const rows = list.rows; // tupluri: [0]=id, [3]=adresă, [16]=sector
  const prepared = prepareRoutes(routes);
  const byMeter = new Map(readings.map((r) => [r.meterId, r]));
  const issueMeters = new Set(issues.map((i) => i.meterId));
  const routeById = new Map(routes.map((r) => [r.id, r]));

  type Acc = { planned: number; byReader: number; byOthers: number; issues: number; lastAt: number | null };
  const acc = new Map<string, Acc>();
  for (const r of routes) acc.set(r.id, { planned: 0, byReader: 0, byOthers: 0, issues: 0, lastAt: null });
  const noRoute = { total: 0, read: 0 };
  // cine a citit în afara rutelor lui + primul / ultimul moment al lunii
  const elsewhere = new Map<string, number>();
  const span = new Map<string, { first: number; last: number; name: string; n: number }>();

  for (const row of rows) {
    const rid = routeOf({ sector: row[16], address: row[3] }, prepared);
    const rd = byMeter.get(row[0]);
    if (rd) {
      // citirile trimise de plătitori din portal (fără utilizator) nu intră în „cine a citit” / durata lucrului
      const s = rd.userId ? span.get(rd.userId) : undefined;
      const t = rd.readAt.getTime();
      if (!rd.userId) { /* portal */ }
      else if (!s) span.set(rd.userId, { first: t, last: t, name: rd.userName, n: 1 });
      else {
        s.first = Math.min(s.first, t);
        s.last = Math.max(s.last, t);
        s.n++;
      }
    }
    if (!rid) {
      noRoute.total++;
      if (rd) {
        noRoute.read++;
        if (rd.userId) elsewhere.set(rd.userId, (elsewhere.get(rd.userId) ?? 0) + 1);
      }
      continue;
    }
    const a = acc.get(rid)!;
    a.planned++;
    if (issueMeters.has(row[0])) a.issues++;
    if (rd) {
      const at = rd.readAt.getTime();
      if (a.lastAt == null || at > a.lastAt) a.lastAt = at;
      if (rd.userId === routeById.get(rid)!.readerId) a.byReader++;
      else {
        a.byOthers++;
        if (rd.userId) elsewhere.set(rd.userId, (elsewhere.get(rd.userId) ?? 0) + 1);
      }
    }
  }

  const userIds = new Set<string>([...routes.map((r) => r.readerId).filter((x): x is string => !!x), ...span.keys()]);
  const users = await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  for (const [id, s] of span) if (!nameOf.has(id)) nameOf.set(id, s.name);

  const stats: RouteStat[] = routes
    .filter((r) => r.active)
    .map((r) => {
      const a = acc.get(r.id)!;
      const read = a.byReader + a.byOthers;
      return {
        routeId: r.id,
        name: r.name,
        readerId: r.readerId,
        readerName: r.readerId ? (nameOf.get(r.readerId) ?? null) : null,
        startDay: r.startDay,
        endDay: r.endDay,
        state: windowState(r, today.day),
        planned: a.planned,
        readByReader: a.byReader,
        readByOthers: a.byOthers,
        unread: a.planned - read,
        dueToday: plannedByToday(a.planned, r, today.day),
        issues: a.issues,
        lastAt: a.lastAt,
      };
    });

  const readers = new Map<string, ReaderStat>();
  for (const s of stats) {
    const k = s.readerId ?? "";
    const cur = readers.get(k) ?? { readerId: s.readerId, readerName: s.readerId ? (s.readerName ?? "—") : "", routes: 0, planned: 0, readByReader: 0, readByOthers: 0, unread: 0, dueToday: 0, readElsewhere: 0, firstAt: null, lastAt: null };
    cur.routes++;
    cur.planned += s.planned;
    cur.readByReader += s.readByReader;
    cur.readByOthers += s.readByOthers;
    cur.unread += s.unread;
    cur.dueToday += s.dueToday;
    readers.set(k, cur);
  }
  // cine a citit fără să aibă vreo rută
  for (const [id, s] of span) {
    if (!readers.has(id)) readers.set(id, { readerId: id, readerName: nameOf.get(id) ?? s.name, routes: 0, planned: 0, readByReader: 0, readByOthers: 0, unread: 0, dueToday: 0, readElsewhere: 0, firstAt: null, lastAt: null });
  }
  for (const [id, r] of readers) {
    if (!id) continue;
    r.readElsewhere = elsewhere.get(id) ?? 0;
    const s = span.get(id);
    r.firstAt = s?.first ?? null;
    r.lastAt = s?.last ?? null;
  }
  return {
    period: today.period,
    day: today.day,
    daysInMonth: today.daysInMonth,
    routes: stats,
    readers: [...readers.values()].sort((a, b) => (a.readerName || "￿").localeCompare(b.readerName || "￿", "ro")),
    noRoute,
    totalMeters: rows.length,
  };
}

// ── Pachetul paginii „Rute de citire” ─────────────────────────────────────────────────────────────────────────────────

let bundleMemo: { at: number; value: RoutesBundle } | null = null;
let bundleInflight: Promise<RoutesBundle> | null = null;
/** Câte secunde e „proaspăt” pachetul: mai mulți administratori / reîmprospătări în aceeași clipă primesc același rezultat, fără a reface calculul pe 25.000 de contoare. */
const BUNDLE_TTL_MS = 15_000;

/** Se apelează după orice modificare a rutelor sau a neregulilor (următoarea afișare reface calculul). */
export function invalidateRoutesBundle(): void {
  bundleMemo = null;
  optionsMemo = null;
}

/**
 * Tot ce arată pagina „Rute de citire”, calculat dintr-o singură trecere: lista de teren (o singură dată, nu de două ori), rutele (toate, și inactive), raportul,
 * neregulile (până la 1000, filtrate apoi în browser) și cititorii. Memorat 15 s; `fresh` ocolește memoria („Reîmprospătează”).
 */
export async function getRoutesBundle(opts: { fresh?: boolean } = {}): Promise<RoutesBundle> {
  if (!opts.fresh && bundleMemo && Date.now() - bundleMemo.at < BUNDLE_TTL_MS) return bundleMemo.value;
  if (bundleInflight) return bundleInflight;
  bundleInflight = (async () => {
    const listP = getFieldList();
    const routesP = listRoutes();
    const [report, routes, issues, users] = await Promise.all([getRouteReport(listP, routesP), routesP, listIssues({ open: false, limit: 1000 }), auditUserOptions()]);
    const value: RoutesBundle = { report, routes, issues, users, at: Date.now() };
    bundleMemo = { at: value.at, value };
    return value;
  })().finally(() => {
    bundleInflight = null;
  });
  return bundleInflight;
}

