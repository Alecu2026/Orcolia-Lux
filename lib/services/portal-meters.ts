import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { getMeterSnap } from "./meter-cache";
import { checkReading, saveReading, setReadingPhoto, LORAWAN_LOCKED_ERROR } from "./meter-readings";
import { queuePendingConfirmation, validEmail } from "./reading-verify";
import { invalidatePortalClient } from "../portal-cache";
import { isRateLimited } from "../rate-limit";
import { deleteStored } from "../storage";
import { PENDING_TTL_DAYS, verifyPendingToken } from "../reading-verify-token";
import { getLorawanMap } from "./lorawan-map";
import { reportIssue } from "./meter-issues";
import { storePendingPhoto } from "./meter-photo";
import { filteredAdminRecipients, notifyUsers, observerRecipients } from "./notifications";
import { currentPeriod, shiftPeriod } from "../meter-readings";
import { ISSUE_LABELS, isIssueKind, type IssueKind } from "../meter-issues";
import { PORTAL_ISSUE_KINDS, type PortalMeterDto, type PortalReadingDto, type PortalReadingResult } from "../portal-meters";

/**
 * Citirile trimise de plătitori din portal. Un plătitor vede DOAR contoarele lui (după legătura abonat → contor din 1C), trimite indexul (m³), poza și starea
 * contorului; citirea se salvează în același model ca citirile din teren (MeterReading, marcată „PORTAL”), deci apare și la personal, în „Citiri teren”.
 * Reguli: o citire pe contor și lună; plătitorul își poate corecta citirea din portal, dar nu suprascrie una făcută de cititor.
 */

type Client = { id: string; name: string };

const HISTORY_MONTHS = 6;

async function ownedRows(clientId: string) {
  const snap = await getMeterSnap();
  // doar contoarele ACTIVE din 1C ale acestui abonat (rândurile „doar Axioma” nu au contor; cele scoase nu se citesc)
  return snap.rows.filter((r) => r.clientId === clientId && !r.removedAt && r.source === "1c");
}

const dto = (r: { id: string; period: string; value: number; prevValue: number | null; readAt: Date; photoUrl: string | null; source: string | null }): PortalReadingDto => ({
  id: r.id,
  period: r.period,
  value: r.value,
  consum: r.prevValue != null ? Math.round((r.value - r.prevValue) * 1000) / 1000 : null,
  readAt: r.readAt.toISOString(),
  photoUrl: r.photoUrl,
  source: r.source === "PORTAL" ? "PORTAL" : r.source === "LORAWAN" ? "LORAWAN" : "FIELD",
});

/** Contoarele plătitorului cu ultimul index, citirea lunii curente, neregulile deschise și istoricul. */
export async function listPortalMeters(clientId: string): Promise<{ period: string; meters: PortalMeterDto[] }> {
  const period = currentPeriod();
  if (DEMO) return { period, meters: [] };
  const rows = await ownedRows(clientId);
  if (rows.length === 0) return { period, meters: [] };
  const ids = rows.map((r) => r.id);
  await sweepExpiredPending(clientId);
  const [lw, readings, issues, pendings] = await Promise.all([
    getLorawanMap(),
    prisma.meterReading.findMany({
      where: { meterId: { in: ids }, period: { gte: shiftPeriod(period, HISTORY_MONTHS) } },
      select: { id: true, meterId: true, period: true, value: true, prevValue: true, readAt: true, photoUrl: true, source: true },
      orderBy: { period: "desc" },
    }),
    prisma.meterIssue.findMany({ where: { meterId: { in: ids }, resolvedAt: null }, select: { meterId: true, kind: true, note: true, reportedAt: true }, orderBy: { reportedAt: "desc" } }),
    prisma.portalReadingPending.findMany({ where: { clientId, meterId: { in: ids } }, select: { meterId: true, value: true, submittedAt: true, expiresAt: true, emailsSent: true } }),
  ]);
  const meters = rows
    .map((r): PortalMeterDto => {
      const mine = readings.filter((x) => x.meterId === r.id);
      const cur = mine.find((x) => x.period === period) ?? null;
      const before = mine.filter((x) => x.period !== period).sort((a, b) => b.readAt.getTime() - a.readAt.getTime());
      // ultimul index cunoscut: cel mai recent între 1C și o citire din teren / portal
      const fb = before[0];
      const fbDate = fb ? fb.readAt.toISOString().slice(0, 10) : null;
      const useField = fb && (!r.currDate || (fbDate ?? "") > r.currDate);
      return {
        id: r.id,
        contor: r.contor,
        address: r.address,
        consumer: r.consumator,
        lastIndex: useField ? fb.value : r.curr,
        lastDate: useField ? fbDate : r.currDate,
        thisMonth: cur ? dto(cur) : null,
        openIssues: issues
          .filter((i) => i.meterId === r.id)
          .map((i) => ({ kind: isIssueKind(i.kind) ? i.kind : "OTHER", note: i.note, reportedAt: i.reportedAt.toISOString() })),
        history: before.map(dto),
        auto: lw.map.has(r.id),
        pending: (() => {
          const p = pendings.find((x) => x.meterId === r.id);
          return p ? { value: p.value, submittedAt: p.submittedAt.toISOString(), expiresAt: p.expiresAt.toISOString(), emailsSent: p.emailsSent } : null;
        })(),
        metroDue: r.metroDue,
      };
    })
    .sort((a, b) => a.contor.localeCompare(b.contor, "ro", { numeric: true }));
  return { period, meters };
}

/** Citirile în așteptare expirate ale plătitorului (și pozele lor) se șterg; se rulează la listare, deci nu e nevoie de o sarcină programată. */
async function sweepExpiredPending(clientId: string): Promise<void> {
  try {
    const old = await prisma.portalReadingPending.findMany({ where: { clientId, expiresAt: { lt: new Date() } }, select: { id: true, photoUrl: true } });
    if (old.length === 0) return;
    await prisma.portalReadingPending.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    await Promise.all(old.map((o) => deleteStored(o.photoUrl).catch(() => {})));
  } catch (e) {
    console.error("[portal-meters] curățarea citirilor în așteptare:", e);
  }
}

export type PortalReadingInput = {
  meterId: string;
  value: number;
  confirmed: boolean;
  issueKind: string;
  issueNote: string;
  /** Poza contorului — OBLIGATORIE: fără ea citirea nu se trimite. */
  photo: File | null;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
};

const PENDING_ERR_NO_EMAIL = "Ca să trimiți citirea ai nevoie de o adresă de email în cont: o confirmi din email. Contactează-ne ca s-o adăugăm.";

/**
 * Citirea trimisă de plătitor din portal NU se înregistrează pe loc: se verifică (aceleași reguli ca la salvare), se păstrează împreună cu poza și locația ca „în așteptare”
 * și pleacă un email de confirmare. Citirea (+ poza + starea contorului) devine reală abia când plătitorul o confirmă din email — vezi `confirmPendingReading`.
 * Poza e obligatorie. Locația (dacă telefonul o dă) se păstrează pentru verificarea distanței față de ultima citire.
 */
export async function submitPortalReading(client: Client, input: PortalReadingInput): Promise<PortalReadingResult> {
  if (DEMO) return { ok: false, error: "Mod demo." };
  const rows = await ownedRows(client.id);
  const row = rows.find((r) => r.id === input.meterId);
  if (!row) return { ok: false, error: "Contor invalid." };
  if ((await getLorawanMap()).map.has(row.id)) return { ok: false, error: LORAWAN_LOCKED_ERROR };
  const kind = input.issueKind;
  if (kind && !(PORTAL_ISSUE_KINDS as string[]).includes(kind)) return { ok: false, error: "Stare invalidă." };
  if (kind === "OTHER" && !input.issueNote.trim()) return { ok: false, error: "Descrie problema." };
  if (!input.photo || !input.photo.size) return { ok: false, error: "Poza contorului este obligatorie." };

  const owner = await prisma.client.findUnique({ where: { id: client.id }, select: { email: true } });
  if (!validEmail(owner?.email)) return { ok: false, error: PENDING_ERR_NO_EMAIL };

  const actor = { id: null, name: `${client.name} · portal` };
  const chk = await checkReading(actor, { meterId: input.meterId, value: input.value, lat: input.lat, lng: input.lng, accuracy: input.accuracy, confirmed: input.confirmed, source: "PORTAL" });
  if (!chk.ok) return { ok: false, error: chk.error, ...(chk.confirm && chk.confirm !== "low" ? { confirm: chk.confirm, ...(chk.avg ? { avg: chk.avg } : {}), ...(chk.pct != null ? { pct: chk.pct } : {}) } : {}) };

  if (isRateLimited(`reading-confirm:${client.id}`, 10, 3_600_000)) return { ok: false, error: "Prea multe încercări într-o oră. Încearcă din nou mai târziu." };

  const submittedAt = new Date();
  const period = currentPeriod(submittedAt);
  const photo = await storePendingPhoto(row.contor, period, input.photo);
  if (!photo.ok) return { ok: false, error: photo.error };

  const okGeo = input.lat != null && input.lng != null && Math.abs(input.lat) <= 90 && Math.abs(input.lng) <= 180;
  const previous = await prisma.portalReadingPending.findMany({ where: { clientId: client.id, meterId: input.meterId }, select: { id: true, photoUrl: true } });
  const created = await prisma.portalReadingPending.create({
    data: {
      clientId: client.id,
      meterId: input.meterId,
      contor: row.contor,
      period,
      value: input.value,
      confirmed: input.confirmed,
      issueKind: kind || null,
      issueNote: kind ? input.issueNote.trim().slice(0, 500) || null : null,
      photoUrl: photo.url,
      photoName: photo.name,
      lat: okGeo ? input.lat : null,
      lng: okGeo ? input.lng : null,
      accuracy: okGeo && input.accuracy != null && input.accuracy >= 0 ? Math.round(input.accuracy) : null,
      submittedAt,
      expiresAt: new Date(submittedAt.getTime() + PENDING_TTL_DAYS * 86_400_000),
    },
  });
  // o trimitere nouă o înlocuiește pe cea veche (cu poza ei)
  if (previous.length) {
    await prisma.portalReadingPending.deleteMany({ where: { id: { in: previous.map((x) => x.id) } } });
    await Promise.all(previous.map((x) => deleteStored(x.photoUrl).catch(() => {})));
  }
  // starea contorului (defect, scurgere…) e o raportare în sine: ajunge la personal imediat, fără să aștepte confirmarea indexului din email
  const issue = kind && isIssueKind(kind) ? await applyPortalIssue(client, row, input.meterId, kind, input.issueNote, null) : null;
  const to = await queuePendingConfirmation({ pendingId: created.id, clientId: client.id, contor: row.contor, address: row.address, period, value: input.value, submittedAt });
  invalidatePortalClient(client.id);
  return { ok: true, pending: true, value: input.value, verifyEmail: to ?? "", ...(issue ? (issue.ok ? { issueSaved: true } : { issueError: issue.error }) : {}) };
}

/** Retrimite emailul de confirmare al unei citiri în așteptare (cel mult 5 în total pe citire). */
export async function resendPortalConfirmation(client: Client, meterId: string): Promise<{ ok: true; verifyEmail: string } | { ok: false; error: string }> {
  if (DEMO) return { ok: false, error: "Mod demo." };
  const p = await prisma.portalReadingPending.findFirst({ where: { clientId: client.id, meterId } });
  if (!p || p.expiresAt.getTime() < Date.now()) return { ok: false, error: "Nu există nicio citire în așteptare pentru acest contor." };
  if (p.emailsSent >= 5) return { ok: false, error: "Ai cerut deja de prea multe ori emailul. Verifică și dosarul Spam sau trimite citirea din nou." };
  if (isRateLimited(`reading-confirm:${client.id}`, 10, 3_600_000)) return { ok: false, error: "Prea multe încercări într-o oră. Încearcă din nou mai târziu." };
  const rows = await ownedRows(client.id);
  const row = rows.find((r) => r.id === meterId);
  const to = await queuePendingConfirmation({ pendingId: p.id, clientId: client.id, contor: p.contor, address: row?.address ?? null, period: p.period, value: p.value, submittedAt: p.submittedAt });
  if (!to) return { ok: false, error: PENDING_ERR_NO_EMAIL };
  await prisma.portalReadingPending.update({ where: { id: p.id }, data: { emailsSent: { increment: 1 } } });
  invalidatePortalClient(client.id);
  return { ok: true, verifyEmail: to };
}

/** Datele afișate pe pagina publică de confirmare (fără cont): citirea în așteptare + poza. Null dacă linkul e invalid / expirat / citirea nu mai e în așteptare. */
export async function getPendingForConfirm(token: string): Promise<{ contor: string; period: string; value: number; submittedAt: Date; photoUrl: string; clientName: string } | { error: string }> {
  const id = verifyPendingToken(token);
  if (!id) return { error: "Linkul nu este valid sau a expirat." };
  const p = await prisma.portalReadingPending.findUnique({ where: { id } }).catch(() => null);
  if (!p) return { error: "Această citire a fost deja confirmată sau a fost înlocuită cu una nouă." };
  if (p.expiresAt.getTime() < Date.now()) return { error: "Linkul a expirat. Trimite din nou citirea din portal." };
  const c = await prisma.client.findUnique({ where: { id: p.clientId }, select: { name: true } });
  return { contor: p.contor, period: p.period, value: p.value, submittedAt: p.submittedAt, photoUrl: p.photoUrl, clientName: c?.name ?? "" };
}

/**
 * Plătitorul a confirmat citirea din email: abia acum se înregistrează (sursa „PORTAL”, marcată verificată), cu poza, locația și starea contorului trimise. Ora citirii = momentul trimiterii,
 * deci luna rămâne cea a trimiterii chiar dacă se confirmă după schimbarea lunii. Dacă între timp un cititor a înregistrat citirea lunii, aceasta nu se mai aplică.
 */
export async function confirmPendingReading(token: string): Promise<{ ok: true; contor: string; value: number; period: string } | { ok: false; error: string }> {
  if (DEMO) return { ok: false, error: "Mod demo." };
  const id = verifyPendingToken(token);
  if (!id) return { ok: false, error: "Linkul nu este valid sau a expirat." };
  const p = await prisma.portalReadingPending.findUnique({ where: { id } }).catch(() => null);
  if (!p) return { ok: false, error: "Această citire a fost deja confirmată sau a fost înlocuită cu una nouă." };
  const drop = async () => {
    await prisma.portalReadingPending.deleteMany({ where: { id: p.id } });
    await deleteStored(p.photoUrl).catch(() => {});
  };
  if (p.expiresAt.getTime() < Date.now()) {
    await drop();
    return { ok: false, error: "Linkul a expirat. Trimite din nou citirea din portal." };
  }
  const client = await prisma.client.findUnique({ where: { id: p.clientId }, select: { id: true, name: true } });
  if (!client) {
    await drop();
    return { ok: false, error: "Contul nu mai există." };
  }
  // contorul trebuie să fie încă al plătitorului și să nu fi trecut pe LoRaWAN între timp
  const row = (await ownedRows(client.id)).find((r) => r.id === p.meterId);
  if (!row || (await getLorawanMap()).map.has(row.id)) {
    await drop();
    return { ok: false, error: "Contorul nu mai poate fi citit din portal." };
  }
  const actor = { id: null, name: `${client.name} · portal` };
  const res = await saveReading(actor, { meterId: p.meterId, value: p.value, lat: p.lat, lng: p.lng, accuracy: p.accuracy, confirmed: true, source: "PORTAL", verified: true, readAt: p.submittedAt });
  if (!res.ok) {
    // citirea lunii a fost făcută între timp de cititor: nu mai are rost s-o păstrăm
    if (/deja înregistrată de cititor/.test(res.error)) await drop();
    return { ok: false, error: res.error };
  }
  const r = res.reading;
  const set = await setReadingPhoto(r.id, p.photoUrl, p.photoName || "poza.jpg").catch(() => null);
  if (set?.oldUrl && set.oldUrl !== p.photoUrl) await deleteStored(set.oldUrl).catch(() => {});
  await prisma.portalReadingPending.deleteMany({ where: { id: p.id } });
  invalidatePortalClient(client.id);
  return { ok: true, contor: p.contor, value: p.value, period: p.period };
}

/** Starea contorului raportată odată cu citirea: se înregistrează la trimitere, iar personalul e anunțat (o singură dată per neregulă — o neregulă deschisă de același tip nu se dublează). */
async function applyPortalIssue(client: Client, row: { contor: string }, meterId: string, kind: IssueKind, note: string, readingId: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const iss = await reportIssue({ id: null, name: `${client.name} · portal`, source: "PORTAL" }, { meterId, kind, note, readingId });
    if (!iss.ok) return { ok: false, error: iss.error };
    if (!iss.existing) {
      const ids = [...new Set([...(await filteredAdminRecipients({ eventKeys: ["meter.portal"] })), ...(await observerRecipients("meter.portal"))])];
      if (ids.length) {
        await notifyUsers(ids, { title: `🔧 Contor ${row.contor}: ${ISSUE_LABELS[kind]}`, body: `${client.name}${note.trim() ? ` — ${note.trim().slice(0, 200)}` : ""}`, url: "/contoare/citiri" }, { telegram: true });
      }
    }
    invalidatePortalClient(client.id);
    return { ok: true };
  } catch (e) {
    console.error("[portal-meters] starea contorului raportată din portal:", e);
    return { ok: false, error: "Starea contorului nu s-a putut salva." };
  }
}
