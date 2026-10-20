import "server-only";
import { prisma } from "../prisma";
import { normalizePhone } from "../payer-notify";

/**
 * Procesarea mesajelor PBX (Moldcell). Pentru un apel vin mai multe mesaje cu același `callid` (ex. cmd "history" cu
 * rezultatul final: status, durată). Fiecare mesaj se păstrează brut (PbxEvent), iar rezumatul apelului (PbxCall) se
 * actualizează: câmpurile primite (nevide) le înlocuiesc pe cele vechi, deci mesajele pot sosi în orice ordine.
 */

export type PbxPayload = Record<string, unknown>;

const text = (v: unknown, max = 200): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

/** "20261019T153553Z" (sau ISO) → Date; altfel null. */
export function parsePbxDate(v: unknown): Date | null {
  const s = text(v, 40);
  if (!s) return null;
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Caută un client după ultimele 8 cifre ale telefonului (formatele diferă: 069…, +373 69…, 37369…). */
async function matchClient(phoneE164: string | null): Promise<{ id: string; name: string } | null> {
  if (!phoneE164) return null;
  const last8 = phoneE164.replace(/\D/g, "").slice(-8);
  if (last8.length < 8) return null;
  return prisma.client.findFirst({ where: { phone: { contains: last8 } }, select: { id: true, name: true } });
}

export async function ingestPbxPayload(payload: PbxPayload): Promise<{ callId: string }> {
  const phone = text(payload.phone, 40);
  const startAt = parsePbxDate(payload.start);
  // Fără callid (nu ar trebui) ținem totuși mesajul, legat de telefon + moment.
  const callId = text(payload.callid, 80) ?? `nocallid-${phone ?? "?"}-${startAt?.getTime() ?? Date.now()}`;
  const cmd = text(payload.cmd, 40);

  await prisma.pbxEvent.create({ data: { callId, cmd, payload: payload as object } });

  const phoneE164 = phone ? normalizePhone(phone.startsWith("+") || phone.startsWith("00") ? phone : `+${phone}`) : null;
  const durationRaw = Number(payload.duration);
  // „history" trimite direcția în `type` ("in"/"out"); mesajele „event" trimit starea în `type` (INCOMING/ACCEPTED/COMPLETED)
  // și direcția în `direction`.
  const typeLc = text(payload.type, 20)?.toLowerCase() ?? null;
  const direction = text(payload.direction, 10)?.toLowerCase() ?? (typeLc === "in" || typeLc === "out" ? typeLc : null);
  const state = cmd === "event" && typeLc && typeLc !== "in" && typeLc !== "out" ? typeLc.toUpperCase() : null;
  const waitRaw = Number(payload.wait);
  const link = text(payload.link, 500);
  const ratingRaw = Number(payload.rating);

  const existing = await prisma.pbxCall.findUnique({ where: { callId }, select: { clientId: true } });
  const client = existing?.clientId ? null : await matchClient(phoneE164);

  // Doar valorile primite (nevide) suprascriu ce știm deja.
  const set = {
    ...(direction ? { direction } : {}),
    ...(phone ? { phone, phoneE164 } : {}),
    ...(text(payload.diversion ?? payload.telnum, 40) ? { diversion: text(payload.diversion ?? payload.telnum, 40) } : {}),
    ...(text(payload.ext, 20) ? { ext: text(payload.ext, 20) } : {}),
    ...(text(payload.groupRealName, 120) ? { groupName: text(payload.groupRealName, 120) } : {}),
    ...(text(payload.telnum_name, 120) ? { lineName: text(payload.telnum_name, 120) } : {}),
    ...(text(payload.second_callid, 80) ? { transferredTo: text(payload.second_callid, 80) } : {}),
    ...(cmd === "rating" && Number.isFinite(ratingRaw) ? { rating: Math.round(ratingRaw) } : {}),
    ...(cmd !== "rating" && payload.rating != null && Number.isFinite(ratingRaw) ? { rating: Math.round(ratingRaw) } : {}),
    ...(state ? { state } : {}),
    ...(link && /^https?:\/\//i.test(link) ? { recordingUrl: link } : {}),
    ...(Number.isFinite(waitRaw) && payload.wait !== "" && payload.wait != null ? { waitSec: Math.max(0, Math.round(waitRaw)) } : {}),
    ...(text(payload.user, 80) ? { pbxUser: text(payload.user, 80) } : {}),
    ...(text(payload.status, 40) ? { status: text(payload.status, 40)!.toLowerCase() } : {}),
    ...(Number.isFinite(durationRaw) && payload.duration !== "" && payload.duration != null ? { durationSec: Math.max(0, Math.round(durationRaw)) } : {}),
    ...(startAt ? { startAt } : {}),
    ...(cmd ? { lastCmd: cmd } : {}),
    ...(client ? { clientId: client.id, clientName: client.name } : {}),
  };

  await prisma.pbxCall.upsert({
    where: { callId },
    create: { callId, ...set, eventCount: 1 },
    update: { ...set, eventCount: { increment: 1 } },
  });
  return { callId };
}

export type CallerContext = {
  clientId: string;
  name: string;
  /** Plătitor Apă-Canal (are cont personal sau nr. de contract 1C) — are fișă la /platitori/<id>. */
  isPayer: boolean;
  account: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  /** „De achitat" pe ultima factură + statusul ei (din rezumatul Client.lastInvoice*). */
  debt: number | null;
  invoiceStatus: string | null;
  openTickets: { id: string; seq: number | null; title: string; status: string }[];
  openTicketCount: number;
  lastNote: { body: string; userName: string; createdAt: string } | null;
};

/** Ce știm acum despre cel care sună: date de bază, datoria curentă, tichetele deschise, ultima notiță. */
export async function getCallerContext(clientId: string): Promise<CallerContext | null> {
  const c = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true, name: true, phone: true, email: true, meterSeries: true, apaCanalContract: true, consumAddress: true,
      lastInvoiceGrandTotal: true, lastInvoiceStatus: true,
    },
  });
  if (!c) return null;
  const openWhere = { clientId, type: "TICKET" as const, status: { notIn: ["DONE", "CANCELLED"] as ("DONE" | "CANCELLED")[] } };
  const [tickets, openTicketCount, note] = await Promise.all([
    prisma.task.findMany({ where: openWhere, orderBy: { createdAt: "desc" }, take: 3, select: { id: true, seq: true, title: true, status: true } }),
    prisma.task.count({ where: openWhere }),
    prisma.payerNote.findFirst({ where: { clientId }, orderBy: { createdAt: "desc" }, select: { body: true, userName: true, createdAt: true } }),
  ]);
  return {
    clientId: c.id,
    name: c.name,
    isPayer: !!(c.meterSeries || c.apaCanalContract),
    account: c.meterSeries ?? c.apaCanalContract,
    address: c.consumAddress,
    email: c.email,
    phone: c.phone,
    debt: c.lastInvoiceGrandTotal,
    invoiceStatus: c.lastInvoiceStatus,
    openTickets: tickets,
    openTicketCount,
    lastNote: note ? { body: note.body, userName: note.userName, createdAt: note.createdAt.toISOString() } : null,
  };
}
