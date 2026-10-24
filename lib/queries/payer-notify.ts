import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import type { PayerTemplate } from "../payer-notify";
import type { InvoiceStatus } from "@prisma/client";
import { notifyCriterion, type NotifyCriterion, type NotifyFilters } from "../payer-notify";
import type { ListPayersOpts } from "./payers";
import { dayBoundsUtc } from "../date";

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
    minDebt: f.minDebt ? Number(f.minDebt) : undefined,
    maxDebt: f.maxDebt ? Number(f.maxDebt) : undefined,
    contact: f.contact || undefined,
    kind: f.kind || undefined,
    notified: f.notified || undefined,
    installedFrom: f.installedFrom || undefined,
    needsNameFix: f.nameFix === "1" || undefined,
    noInvoices: f.invoices === "none" || undefined,
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
  if (!crit) return opts;
  const ids = await notifiedClientIds(crit);
  return crit.negate ? { ...opts, idsNotIn: ids } : { ...opts, idsIn: ids };
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
