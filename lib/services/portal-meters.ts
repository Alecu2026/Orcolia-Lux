import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { getMeterSnap } from "./meter-cache";
import { getReading, saveReading } from "./meter-readings";
import { reportIssue } from "./meter-issues";
import { uploadReadingPhoto } from "./meter-photo";
import { filteredAdminRecipients, notifyUsers, observerRecipients } from "./notifications";
import { currentPeriod, shiftPeriod, type PhotoResult } from "../meter-readings";
import { ISSUE_LABELS, isIssueKind } from "../meter-issues";
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
  source: r.source === "PORTAL" ? "PORTAL" : "FIELD",
});

/** Contoarele plătitorului cu ultimul index, citirea lunii curente, neregulile deschise și istoricul. */
export async function listPortalMeters(clientId: string): Promise<{ period: string; meters: PortalMeterDto[] }> {
  const period = currentPeriod();
  if (DEMO) return { period, meters: [] };
  const rows = await ownedRows(clientId);
  if (rows.length === 0) return { period, meters: [] };
  const ids = rows.map((r) => r.id);
  const [readings, issues] = await Promise.all([
    prisma.meterReading.findMany({
      where: { meterId: { in: ids }, period: { gte: shiftPeriod(period, HISTORY_MONTHS) } },
      select: { id: true, meterId: true, period: true, value: true, prevValue: true, readAt: true, photoUrl: true, source: true },
      orderBy: { period: "desc" },
    }),
    prisma.meterIssue.findMany({ where: { meterId: { in: ids }, resolvedAt: null }, select: { meterId: true, kind: true, note: true, reportedAt: true }, orderBy: { reportedAt: "desc" } }),
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
        lastIndex: useField ? fb.value : r.curr,
        lastDate: useField ? fbDate : r.currDate,
        thisMonth: cur ? dto(cur) : null,
        openIssues: issues
          .filter((i) => i.meterId === r.id)
          .map((i) => ({ kind: isIssueKind(i.kind) ? i.kind : "OTHER", note: i.note, reportedAt: i.reportedAt.toISOString() })),
        history: before.map(dto),
      };
    })
    .sort((a, b) => a.contor.localeCompare(b.contor, "ro", { numeric: true }));
  return { period, meters };
}

export type PortalReadingInput = { meterId: string; value: number; confirmed: boolean; issueKind: string; issueNote: string };

/** Salvează citirea trimisă de plătitor (+ starea contorului, dacă nu e „Normal”). */
export async function submitPortalReading(client: Client, input: PortalReadingInput): Promise<PortalReadingResult> {
  if (DEMO) return { ok: false, error: "Mod demo." };
  const rows = await ownedRows(client.id);
  const row = rows.find((r) => r.id === input.meterId);
  if (!row) return { ok: false, error: "Contor invalid." };
  const kind = input.issueKind;
  if (kind && !(PORTAL_ISSUE_KINDS as string[]).includes(kind)) return { ok: false, error: "Stare invalidă." };
  if (kind === "OTHER" && !input.issueNote.trim()) return { ok: false, error: "Descrie problema." };

  const actor = { id: null, name: `${client.name} · portal` };
  const res = await saveReading(actor, { meterId: input.meterId, value: input.value, lat: null, lng: null, accuracy: null, confirmed: input.confirmed, source: "PORTAL" });
  if (!res.ok) return { ok: false, error: res.error, ...(res.confirm ? { confirm: res.confirm } : {}) };
  const r = res.reading;
  const consum = r.prevValue != null ? Math.round((r.value - r.prevValue) * 1000) / 1000 : null;

  let issueSaved = false;
  let issueError: string | undefined;
  if (kind && isIssueKind(kind)) {
    const iss = await reportIssue({ id: null, name: actor.name, source: "PORTAL" }, { meterId: input.meterId, kind, note: input.issueNote, readingId: r.id });
    if (iss.ok) {
      issueSaved = true;
      if (!iss.existing) {
        try {
          const ids = [...new Set([...(await filteredAdminRecipients({ eventKeys: ["meter.portal"] })), ...(await observerRecipients("meter.portal"))])];
          if (ids.length) {
            await notifyUsers(ids, { title: `🔧 Contor ${row.contor}: ${ISSUE_LABELS[kind]}`, body: `${client.name}${input.issueNote.trim() ? ` — ${input.issueNote.trim().slice(0, 200)}` : ""}`, url: "/contoare/citiri" }, { telegram: true });
          }
        } catch (e) {
          console.error("[portal-meters] notificarea neregulii:", e);
        }
      }
    } else issueError = iss.error;
  }
  return { ok: true, readingId: r.id, value: r.value, consum, issueSaved, ...(issueError ? { issueError } : {}) };
}

/** Poza pentru o citire trimisă din portal (doar a plătitorului, doar pentru citirea lui din portal). */
export async function uploadPortalPhoto(client: Client, readingId: string, file: File): Promise<PhotoResult> {
  if (DEMO) return { ok: false, error: "Mod demo." };
  const reading = await getReading(readingId);
  if (!reading || reading.source !== "PORTAL") return { ok: false, error: "Citirea nu există. Salvează întâi indexul." };
  const rows = await ownedRows(client.id);
  if (!rows.some((r) => r.id === reading.meterId)) return { ok: false, error: "Citirea nu există. Salvează întâi indexul." };
  return uploadReadingPhoto(reading.id, file);
}
