import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import type { PayerTemplate } from "../payer-notify";
import type { InvoiceStatus } from "@prisma/client";
import { notifyCriterion, type NotifyCriterion, type NotifyFilters } from "../payer-notify";
import type { ListPayersOpts } from "./payers";
import { dayBoundsUtc } from "../date";
import { addressLocality, parseSectorFilter } from "../sector-filter";

/** Filtrele curățate (vezi sanitizeFilters) → opțiunile interogării de plătitori. */
export function filtersToListOpts(f: NotifyFilters): ListPayersOpts {
  return {
    search: f.q || undefined,
    street: f.street || undefined,
    month: f.month || undefined,
    status: f.account || undefined,
    sector: f.sector || undefined,
    invoiceStatus: (f.invoiceStatus || undefined) as InvoiceStatus | undefined,
    debt: f.debt || undefined,
    bal: f.bal || undefined,
    minDebt: f.minDebt ? Number(f.minDebt) : undefined,
    maxDebt: f.maxDebt ? Number(f.maxDebt) : undefined,
    contact: f.contact || undefined,
    kind: f.kind || undefined,
    notified: f.notified || undefined,
    installedFrom: f.installedFrom || undefined,
    needsNameFix: f.nameFix === "1" || undefined,
    noInvoices: f.invoices === "none" || undefined,
    estimated: f.estimated || undefined,
    lorawan: f.lorawan || undefined,
    contractExp: f.contractExp || undefined,
    metrologyExp: f.metrologyExp || undefined,
    meterIssues: f.meterIssues || undefined,
    sort: f.sort || "name",
  };
}

const NOTIFY_TZ = "Europe/Bucharest";
const idsCache = new Map<string, { at: number; p: Promise<string[]> }>();
const IDS_TTL_MS = 10_000;

/**
 * Plătitorii cărora li s-a TRIMIS (status SENT) cel puțin o notificare pe canalul ales, în perioada aleasă (zile calendaristice, ora României,
 * ambele capete incluse). Din jurnalul de trimiteri, grupat în baza de date; memorat 10 s (single-flight), ca schimbările rapide de filtru să nu
 * repete interogarea.
 */
export function notifiedClientIds(c: NotifyCriterion): Promise<string[]> {
  const key = `${c.channel ?? "ANY"}|${c.from}|${c.to}`;
  const hit = idsCache.get(key);
  if (hit && Date.now() - hit.at < IDS_TTL_MS) return hit.p;
  const match: Record<string, unknown> = { status: "SENT" };
  if (c.channel) match.channel = c.channel;
  const range: Record<string, unknown> = {};
  if (c.from) range.$gte = { $date: dayBoundsUtc(c.from, NOTIFY_TZ).start.toISOString() };
  if (c.to) range.$lt = { $date: dayBoundsUtc(c.to, NOTIFY_TZ).end.toISOString() };
  if (Object.keys(range).length) match.createdAt = range;
  const p = (
    prisma.payerNotificationLog.aggregateRaw({
      pipeline: [{ $match: match }, { $group: { _id: "$clientId" } }] as never,
      options: { allowDiskUse: true },
    }) as unknown as Promise<{ _id: { $oid?: string } | string }[]>
  ).then((rows) => rows.map((r) => (typeof r._id === "string" ? r._id : r._id?.$oid)).filter((x): x is string => !!x));
  p.catch(() => idsCache.delete(key));
  idsCache.set(key, { at: Date.now(), p });
  if (idsCache.size > 30) idsCache.delete(idsCache.keys().next().value as string);
  return p;
}

/** Opțiunile interogării + restricția „canal + perioadă" (dacă filtrele o cer), pentru căile care citesc direct din baza de date. */
export async function filtersToListOptsAsync(f: NotifyFilters): Promise<ListPayersOpts> {
  const opts = filtersToListOpts(f);
  const crit = notifyCriterion(f);
  // sectoarele / localitățile alese: id-urile plătitorilor care se potrivesc, din lista din memorie (aceeași regulă ca în browser). Dacă lista nu poate fi citită, eroarea
  // se propagă (mai bine nicio trimitere decât una către toți plătitorii).
  const uSectors = parseSectorFilter(f.usector);
  const uLocs = parseSectorFilter(f.uloc);
  let sectorIds: string[] | null = null;
  if (uSectors || uLocs) {
    const { getPayerSnap } = await import("../services/payer-cache");
    const snap = await getPayerSnap();
    sectorIds = [];
    for (const r of snap.rows) {
      if (uSectors && !(r.uch && uSectors.has(r.uch))) continue;
      if (uLocs && !uLocs.has(addressLocality(r.consumAddress))) continue;
      sectorIds.push(r.id);
    }
  }
  // consumatori noi (adăugați în CRM de la data aleasă) și locuri de consum noi (începutul consumului din 1C): id-urile care se potrivesc, intersectate cu sectorul / localitatea
  const restrict = async (ids: string[] | null, next: Promise<string[]> | null): Promise<string[] | null> => {
    if (!next) return ids;
    const set = new Set(await next);
    return ids ? ids.filter((id) => set.has(id)) : [...set];
  };
  sectorIds = await restrict(
    await restrict(
      sectorIds,
      f.newFrom
        ? prisma.client.findMany({ where: { createdAt: { gte: dayBoundsUtc(f.newFrom, NOTIFY_TZ).start } }, select: { id: true } }).then((rows) => rows.map((r) => r.id))
        : null,
    ),
    f.placeFrom
      ? prisma.oneCRecord.findMany({ where: { clientId: { not: null }, inceputConsum: { gte: f.placeFrom } }, select: { clientId: true } }).then((rows) => [...new Set(rows.map((r) => r.clientId).filter((x): x is string => !!x))])
      : null,
  );
  // serviciul (apă / canalizare / ambele) și „fără factură în luna aleasă”: id-urile din lista din memorie (aceeași regulă ca în browser), intersectate cu restul. Fără asta, o trimitere
  // sau un export cu aceste filtre active ar ajunge la TOȚI plătitorii care se potrivesc celorlalte filtre.
  if (f.service || f.noInvoice) {
    const { getPayerSnap, getMonthSlice } = await import("../services/payer-cache");
    const snap = await getPayerSnap();
    const want = f.service === "water" ? 1 : f.service === "sewer" ? 2 : f.service === "both" ? 3 : 0;
    const month = f.noInvoice ? f.month || snap.months[0]?.month || "" : "";
    const withInvoice = month ? (await getMonthSlice(month)).map : null;
    const ids: string[] = [];
    for (const r of snap.rows) {
      if (want && r.service !== want) continue;
      if (withInvoice && withInvoice.has(r.id)) continue;
      ids.push(r.id);
    }
    sectorIds = await restrict(sectorIds, Promise.resolve(ids));
    if (f.noInvoice) opts.month = undefined; // luna a servit doar la excludere: nu se mai cer plătitorii CU factură în ea
  }
  // datorie pe vechime: id-urile din raportul de datorii (aceeași regulă ca în browser), intersectate cu restul
  if (f.aging) {
    const { agingIds } = await import("../services/debt-aging");
    sectorIds = await restrict(sectorIds, agingIds(f.aging));
  }
  if (!crit) return sectorIds ? { ...opts, idsIn: sectorIds } : opts;
  const ids = await notifiedClientIds(crit);
  if (!sectorIds) return crit.negate ? { ...opts, idsNotIn: ids } : { ...opts, idsIn: ids };
  const notified = new Set(ids);
  return { ...opts, idsIn: sectorIds.filter((id) => notified.has(id) !== crit.negate) };
}

/** Șabloanele salvate, cele mai noi primele. */
export async function listPayerTemplates(): Promise<PayerTemplate[]> {
  if (DEMO) return [];
  const rows = await prisma.payerNotifyTemplate.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, name: true, subject: true, email: true, sms: true, call: true, voice: true },
  });
  return rows.map((r) => ({ ...r, call: r.call ?? "", voice: r.voice ?? "" }));
}

import type { PayerNoteItem } from "../payer-notify";

/** Notițele unui plătitor, cele mai noi primele. */
export async function listPayerNotes(clientId: string, take = 100): Promise<PayerNoteItem[]> {
  if (DEMO) return [];
  const rows = await prisma.payerNote.findMany({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, body: true, userId: true, userName: true, createdAt: true, updatedAt: true },
  });
  return rows.map((n) => ({ ...n, createdAt: n.createdAt.toISOString(), updatedAt: n.updatedAt.toISOString() }));
}
