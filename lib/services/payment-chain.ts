import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { deriveChain, type ChainInvoice } from "../payment-chain";

/**
 * Recalcularea plăților din lanțul de facturi al fiecărui plătitor (regulile: lib/payment-chain.ts): statusul fiecărei facturi (achitată / restantă / trimisă), cât s-a achitat din ea
 * (`paidAmount`) și cât s-a plătit între factura anterioară și ea (`prevPaid`). Se scrie direct pe facturi, ca listele, filtrele și decontarea să le citească fără calcule.
 *
 *  – se procesează doar plătitorii cu facturi „murdare”: create sau modificate după ultimul calcul (`updatedAt` > `chainAt`, sau `chainAt` lipsește) — deci după fiecare import / sincronizare 1C și zilnic (cron)
 *    costă doar ce s-a schimbat, iar istoricul complet (toate facturile încă fără `chainAt`) se procesează treptat, în limita timpului, sau dintr-un foc cu /api/admin/payment-chain.
 * Se actualizează doar facturile la care ceva s-a schimbat (scrieri în lot, 500 deodată); instantaneul `Client.lastInvoiceStatus` se aliniază pentru cele care au ultima factură schimbată.
 */

const BATCH_CLIENTS = 200;
const WRITE_CHUNK = 500;
const EPS = 0.005;

type Opts = {
  /** Plătitorii cu cel puțin o factură nouă / modificată după ultimul calcul (sau încă neprocesată), cel mult `limitClients` o dată. */
  limitClients?: number;
  /** Timpul maxim al rulării (ms); la depășire se oprește după lotul curent și restul rămâne pentru rularea următoare. */
  budgetMs?: number;
  reason?: string;
};
export type ChainStats = { clients: number; invoices: number; changed: number; skipped?: boolean };

const g = globalThis as unknown as { __payChainRunning?: boolean };

const oidOf = (v: unknown): string => (typeof v === "string" ? v : String((v as { $oid?: string })?.$oid ?? ""));

const MARKER_ID = "chain:last";
/** Ultima rulare completă (cât timp lanțurile tuturor facturilor modificate până atunci au fost procesate): de aici se caută facturile modificate, cu index pe `updatedAt`. */
async function readMarker(): Promise<Date> {
  const r = await prisma.payerCacheEntry.findUnique({ where: { id: MARKER_ID }, select: { builtAt: true } }).catch(() => null);
  return r?.builtAt ?? new Date(0);
}
async function writeMarker(at: Date): Promise<void> {
  const data = { version: "chain", builtAt: at, rows: 0, gz: new Uint8Array(0) };
  const upd = await prisma.payerCacheEntry.updateMany({ where: { id: MARKER_ID }, data });
  if (upd.count === 0) await prisma.payerCacheEntry.create({ data: { id: MARKER_ID, ...data } });
}

let indexesEnsured = false;
/** Indexuri pe `chainAt` și `updatedAt` (aceleași nume ca în schema Prisma, deci un `db push` ulterior nu le dublează); idempotent, în fundal, nu aruncă. */
function ensureChainIndexes(): void {
  if (indexesEnsured) return;
  indexesEnsured = true;
  void prisma
    .$runCommandRaw({ createIndexes: "Invoice", indexes: [{ key: { chainAt: 1 }, name: "Invoice_chainAt_idx" }, { key: { updatedAt: 1 }, name: "Invoice_updatedAt_idx" }] })
    .catch((e) => console.error("[payment-chain] nu am putut crea indexurile (merge și fără, mai lent):", e));
}

async function distinctClients(match: Record<string, unknown>, limit?: number): Promise<string[]> {
  const raw = (await prisma.invoice.aggregateRaw({
    pipeline: [
      { $match: { kind: "APA_CANAL", clientId: { $ne: null }, ...match } },
      { $group: { _id: "$clientId" } },
      ...(limit ? [{ $limit: limit }] : []),
    ] as never,
    options: { allowDiskUse: true },
  })) as unknown as { _id: unknown }[];
  return raw.map((r) => oidOf(r._id)).filter(Boolean);
}

/** Câte facturi Apă-Canal nu au fost încă procesate (pentru ecranul de administrare). */
export async function countPendingChains(): Promise<number> {
  if (DEMO) return 0;
  return prisma.invoice.count({ where: { kind: "APA_CANAL", chainAt: null } });
}

type RawUpdate = { q: Record<string, unknown>; u: Record<string, unknown> };
async function bulkUpdate(collection: "Invoice" | "Client", updates: RawUpdate[]): Promise<void> {
  for (let i = 0; i < updates.length; i += WRITE_CHUNK) {
    const res = (await prisma.$runCommandRaw({ update: collection, updates: updates.slice(i, i + WRITE_CHUNK) as never, ordered: false })) as { writeErrors?: unknown[] };
    if (res.writeErrors?.length) console.error(`[payment-chain] ${res.writeErrors.length} erori la scrierea în ${collection}:`, JSON.stringify(res.writeErrors[0]));
  }
}

export async function recomputePaymentChains(opts: Opts = {}): Promise<ChainStats> {
  const stats: ChainStats = { clients: 0, invoices: 0, changed: 0 };
  if (DEMO) return stats;
  if (g.__payChainRunning) return { ...stats, skipped: true }; // o singură rulare la un moment dat (altfel două rulări și-ar scrie peste ele)
  g.__payChainRunning = true;
  const t0 = Date.now();
  try {
    ensureChainIndexes();
    // „murdare”: fără calcul încă (index pe `chainAt`) sau modificate după ultima rulare completă (index pe `updatedAt`); scrierile mele brute nu ating `updatedAt`
    const since = new Date((await readMarker()).getTime() - 60_000);
    const list = await distinctClients({ $or: [{ chainAt: null }, { updatedAt: { $gte: { $date: since.toISOString() } } }] }, opts.limitClients);
    let cut = false;

    const touchedMonths = new Set<string>();
    for (let i = 0; i < list.length; i += BATCH_CLIENTS) {
      if (opts.budgetMs && Date.now() - t0 > opts.budgetMs) { cut = true; break; }
      const batch = list.slice(i, i + BATCH_CLIENTS);
      // marcajul se ia ÎNAINTE de citire: o modificare făcută în timpul calculului are `updatedAt` mai nou decât el, deci factura rămâne „murdară” și se recalculează data viitoare
      const stamp = { $date: new Date().toISOString() };
      const [invoices, clients] = await Promise.all([
        prisma.invoice.findMany({
          where: { clientId: { in: batch }, kind: "APA_CANAL" },
          orderBy: [{ issueDate: "asc" }, { createdAt: "asc" }],
          select: { id: true, clientId: true, issueDate: true, dueDate: true, status: true, datoriiAvans: true, grandTotal: true, paidAt: true, paidAmount: true, prevPaid: true, chainAt: true, updatedAt: true },
        }),
        prisma.client.findMany({ where: { id: { in: batch } }, select: { id: true, lastInvoiceStatus: true, lastInvoiceIssueDate: true } }),
      ]);
      const byClient = new Map<string, typeof invoices>();
      for (const inv of invoices) {
        if (!inv.clientId) continue;
        const a = byClient.get(inv.clientId);
        if (a) a.push(inv);
        else byClient.set(inv.clientId, [inv]);
      }
      const clientById = new Map(clients.map((c) => [c.id, c]));
      const invUpdates: RawUpdate[] = [];
      const clientUpdates: RawUpdate[] = [];

      for (const [clientId, invs] of byClient) {
        const chain: ChainInvoice[] = invs.map((x) => ({ id: x.id, issueMs: x.issueDate.getTime(), dueMs: x.dueDate ? x.dueDate.getTime() : null, status: x.status, debt: x.datoriiAvans, total: x.grandTotal }));
        const res = deriveChain(chain);
        stats.invoices += invs.length;
        res.forEach((r, k) => {
          const inv = invs[k];
          const sameNum = (a: number | null, b: number | null | undefined) => (a == null ? b == null : b != null && Math.abs(a - b) < EPS);
          const needsPaidAt = r.status === "PAID" && !inv.paidAt && r.paidOnMs != null;
          const changed = r.status !== inv.status || !sameNum(r.paidAmount, inv.paidAmount) || !sameNum(r.prevPaid, inv.prevPaid) || needsPaidAt;
          // „murdară” = fără calcul sau modificată după el; chiar dacă rezultatul e neschimbat, se marchează calculată (altfel ar fi reluată la fiecare rulare)
          const dirty = !inv.chainAt || inv.updatedAt > inv.chainAt;
          if (!changed && !dirty) return;
          const set: Record<string, unknown> = { paidAmount: r.paidAmount, prevPaid: r.prevPaid, chainAt: stamp };
          if (r.status !== inv.status) {
            set.status = r.status;
            if (r.status !== "PAID" && inv.paidAt) set.paidAt = null; // nu mai e achitată: data plății nu mai are sens
          }
          // achitată din lanț și fără dată: data estimată (emiterea facturii următoare / a ei, dacă avansul o acoperă); o dată pusă de un operator rămâne
          if (needsPaidAt) set.paidAt = { $date: new Date(r.paidOnMs as number).toISOString() };
          invUpdates.push({ q: { _id: { $oid: inv.id } }, u: { $set: set } });
          if (changed) {
            stats.changed++;
            touchedMonths.add(inv.issueDate.toISOString().slice(0, 7));
          }
        });
        // instantaneul plătitorului (filtrele din /platitori): doar dacă ultima factură a lui e cea schimbată
        const latest = invs[invs.length - 1];
        const lastRes = res[res.length - 1];
        const cl = clientById.get(clientId);
        if (cl && lastRes.status !== cl.lastInvoiceStatus && cl.lastInvoiceIssueDate && Math.abs(cl.lastInvoiceIssueDate.getTime() - latest.issueDate.getTime()) < 1000) {
          clientUpdates.push({ q: { _id: { $oid: clientId } }, u: { $set: { lastInvoiceStatus: lastRes.status } } });
        }
      }
      if (invUpdates.length) await bulkUpdate("Invoice", invUpdates);
      if (clientUpdates.length) await bulkUpdate("Client", clientUpdates);
      stats.clients += batch.length;
    }

    // lista a fost procesată integral (nu s-a oprit la limita de timp / de plătitori): următoarea rulare caută doar ce se modifică de acum
    if (!cut && !(opts.limitClients && list.length >= opts.limitClients)) await writeMarker(new Date(t0)).catch((e) => console.error("[payment-chain] marcajul ultimei rulări:", e));

    if (stats.changed > 0) {
      console.log(`[payment-chain] (${opts.reason ?? "rulare"}) ${stats.changed} facturi actualizate la ${stats.clients} plătitori, ${Date.now() - t0} ms`);
      const [{ invalidatePayers }, { invalidateInvoices }, { bumpPortalEpoch }] = await Promise.all([import("./payer-cache"), import("./invoice-cache"), import("../portal-cache")]);
      await Promise.allSettled([invalidatePayers(), touchedMonths.size > 0 && touchedMonths.size <= 36 ? invalidateInvoices({ months: [...touchedMonths] }) : invalidateInvoices()]);
      bumpPortalEpoch();
    }
    return stats;
  } finally {
    g.__payChainRunning = false;
  }
}

/** Apelul obișnuit după orice schimbare din 1C și din cron: plătitorii cu facturi noi / modificate (și, treptat, istoricul neprocesat), în cel mult ~20 s (rutele au limită de 60 s; restul rămâne pentru rularea următoare). */
export function syncPaymentChains(reason: string): Promise<ChainStats> {
  return recomputePaymentChains({ budgetMs: 20_000, reason });
}
