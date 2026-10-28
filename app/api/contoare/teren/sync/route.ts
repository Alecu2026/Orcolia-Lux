import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { currentPeriod, parseIndex } from "@/lib/meter-readings";
import { saveReadingLogged, toReadingDto } from "@/lib/services/meter-readings";
import { uploadReadingPhoto } from "@/lib/services/meter-photo";
import { reportIssue } from "@/lib/services/meter-issues";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const num = (v: FormDataEntryValue | null): number | null => {
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Sincronizarea cozii de citiri de pe telefon (citirile introduse fără internet): o citire pe cerere, cu poza ei și, dacă e cazul, cu neregula găsită la contor
 * (sau doar neregula, fără index — contor inaccesibil). Idempotent: aceeași citire trimisă de două ori (aceeași valoare și aceeași oră) nu creează nimic nou
 * și nu apare de două ori în Audit Logs; aceeași neregulă deja deschisă pentru contor nu se dublează.
 * Răspuns 200 cu { ok: false, error } = citirea a fost respinsă (nu se mai încearcă singură); 401/403/5xx = se reîncearcă mai târziu.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "meters.read")) return Response.json({ ok: false, error: "Fără permisiune." }, { status: 403 });
  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return Response.json({ ok: false, error: "Cerere invalidă." }, { status: 400 });
  }
  const meterId = String(fd.get("meterId") ?? "");
  if (!meterId || meterId.length > 300) return Response.json({ ok: false, error: "Contor invalid." });
  const issueKind = typeof fd.get("issueKind") === "string" ? String(fd.get("issueKind")) : "";
  const issueNote = typeof fd.get("issueNote") === "string" ? String(fd.get("issueNote")) : null;
  const valueRaw = String(fd.get("value") ?? "");
  const hasValue = valueRaw.trim() !== "";
  const value = hasValue ? parseIndex(valueRaw) : null;
  if (hasValue && value == null) return Response.json({ ok: false, error: "Index invalid." });
  if (!hasValue && !issueKind) return Response.json({ ok: false, error: "Index invalid." });
  const at = num(fd.get("readAt"));
  const readAt = at != null ? new Date(at) : null;
  const lat = num(fd.get("lat"));
  const lng = num(fd.get("lng"));
  const accuracy = num(fd.get("accuracy"));

  const issueFor = async (readingId: string | null) => {
    if (!issueKind) return { issue: null, issueError: null as string | null };
    const r = await reportIssue(user, { meterId, kind: issueKind, note: issueNote, readingId, reportedAt: readAt });
    return r.ok ? { issue: r.issue, issueError: null as string | null } : { issue: null, issueError: r.error };
  };

  try {
    // doar neregula (fără index): contor inaccesibil, defect găsit fără citire etc.
    if (!hasValue || value == null) {
      const r = await reportIssue(user, { meterId, kind: issueKind, note: issueNote, reportedAt: readAt });
      if (!r.ok) return Response.json({ ok: false, error: r.error });
      return Response.json({ ok: true, issueOnly: true, issue: r.issue, reading: null, location: null });
    }
    // deja trimisă (aceeași valoare, aceeași oră): nu repetăm scrierea și auditul; poza se atașează dacă încă lipsește
    if (readAt) {
      const period = currentPeriod(readAt);
      const existing = await prisma.meterReading.findUnique({ where: { meterId_period: { meterId, period } } });
      if (existing && existing.value === value && Math.abs(existing.readAt.getTime() - readAt.getTime()) < 1000) {
        let reading = toReadingDto(existing);
        const photo = fd.get("photo") as File | null;
        let photoError: string | null = null;
        if (photo && photo.size && !existing.photoUrl) {
          const ph = await uploadReadingPhoto(existing.id, photo);
          if (ph.ok) reading = { ...reading, photoUrl: ph.photoUrl };
          else photoError = ph.error;
        }
        const iss = await issueFor(existing.id);
        return Response.json({ ok: true, duplicate: true, reading, location: { address: null, lat: existing.lat, lng: existing.lng, accuracy: existing.accuracy, addrField: false }, photoError, ...iss });
      }
    }
    const res = await saveReadingLogged(user, {
      meterId,
      value,
      lat,
      lng,
      accuracy,
      confirmed: fd.get("confirmed") === "1",
      address: typeof fd.get("address") === "string" ? String(fd.get("address")) : null,
      readAt,
      fromQueue: true,
    });
    if (!res.ok) return Response.json(res);
    let reading = res.reading;
    let photoError: string | null = null;
    const photo = fd.get("photo") as File | null;
    if (photo && photo.size) {
      const ph = await uploadReadingPhoto(reading.id, photo);
      if (ph.ok) reading = { ...reading, photoUrl: ph.photoUrl };
      else photoError = ph.error;
    }
    const iss = await issueFor(reading.id);
    return Response.json({ ok: true, reading, location: res.location, photoError, ...iss });
  } catch (e) {
    console.error("[teren/sync] eșuat:", e);
    return Response.json({ ok: false, error: "Eroare pe server." }, { status: 500 });
  }
}
