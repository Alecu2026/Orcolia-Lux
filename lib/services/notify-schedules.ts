import "server-only";
import { prisma } from "../prisma";
import { DEFAULT_TZ } from "../date";
import { computeNextRun, parseReminderSchedule, type ReminderSchedule } from "../reminder-schedule";
import { NOTIFY_CHUNK_SIZE, NOTIFY_MAX_RECIPIENTS, isEmail, normalizePhone, sanitizeFilters, type NotifyFilters } from "../payer-notify";
import { listMatchingPayerContacts } from "../queries/payers";
import { filtersToListOptsAsync } from "../queries/payer-notify";
import { CRM_CLIENT_WHERE } from "../queries/clients";
import { logAudit } from "./audit";
import { deliverNotificationChunk, validateMessage, type SendChunkInput } from "./payer-notify-send";

/**
 * Notificări programate către plătitori sau clienți: același mesaj (email / SMS / apel) trimis la o dată și o oră (o singură dată), zilnic, săptămânal, lunar sau la interval,
 * ca reamintirile sarcinilor / cererilor. Destinatarii se recalculează la FIECARE rulare din filtrele salvate (plătitori: filtrele din pagina Notificări; clienți: căutare + contact)
 * sau, la o selecție fixă, din lista de id-uri. Trimiterea folosește același cod ca trimiterea manuală, deci fiecare mesaj apare în Jurnalul de notificări, cu numele programării.
 */

export type ScheduleMessage = {
  email: { enabled: boolean; subject: string; body: string };
  sms: { enabled: boolean; body: string; ascii: boolean };
  call: { enabled: boolean; body: string; voice: string };
};

export type ClientCriteria = { q: string; contact: "" | "any" | "email" | "phone" | "both" };
export type Audience = "payers" | "clients";

export type ScheduleDto = {
  id: string;
  name: string;
  audience: Audience;
  /** câți destinatari are selecția fixă (null = din filtre) */
  fixedCount: number | null;
  filtersText: string;
  schedule: ReminderSchedule;
  active: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastResult: string | null;
  runCount: number;
  createdByName: string;
  channels: string;
};

type Row = Awaited<ReturnType<typeof prisma.notifySchedule.findFirst>> & object;

// Exact aceiași clienți ca în pagina Clienți (/clients). În Mongo un câmp lipsă ≠ null, deci `not: null` ar fi eliminat TOȚI clienții.
const NOT_PAYER = CRM_CLIENT_WHERE;

export function sanitizeClientCriteria(raw: unknown): ClientCriteria {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const q = typeof o.q === "string" ? o.q.trim().slice(0, 120) : "";
  const contact = o.contact === "any" || o.contact === "email" || o.contact === "phone" || o.contact === "both" ? o.contact : "";
  return { q, contact };
}

/** Clienții obișnuiți (fără plătitori) care respectă căutarea și contactul cerut, cu steagurile de contact (1 = email valid, 2 = telefon valid). */
export async function listClientTargets(c: ClientCriteria, limit = NOTIFY_MAX_RECIPIENTS): Promise<{ id: string; name: string; email: string | null; phone: string | null; flags: number }[]> {
  const q = c.q.trim();
  const rows = await prisma.client.findMany({
    where: {
      ...NOT_PAYER,
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { phone: { contains: q } }, { email: { contains: q, mode: "insensitive" as const } }] } : {}),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, phone: true },
    take: limit + 1,
  });
  const out = rows.map((r) => ({ ...r, flags: (isEmail(r.email) ? 1 : 0) | (normalizePhone(r.phone) ? 2 : 0) }));
  const want = c.contact;
  return out.filter((r) => (want === "any" ? r.flags !== 0 : want === "email" ? (r.flags & 1) !== 0 : want === "phone" ? (r.flags & 2) !== 0 : want === "both" ? r.flags === 3 : true)).slice(0, limit);
}

async function resolveIds(sc: Row): Promise<string[]> {
  if (sc.audience === "clients") {
    if (sc.filters) return (await listClientTargets(sanitizeClientCriteria(sc.filters))).map((r) => r.id);
    return sc.ids;
  }
  if (sc.filters) {
    const f = sanitizeFilters(sc.filters as Record<string, unknown>);
    const all = await listMatchingPayerContacts(await filtersToListOptsAsync(f));
    return all.slice(0, NOTIFY_MAX_RECIPIENTS).map((c) => c.id);
  }
  return sc.ids;
}

function asMessage(raw: unknown): ScheduleMessage {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<ScheduleMessage>;
  return {
    email: { enabled: !!o.email?.enabled, subject: String(o.email?.subject ?? ""), body: String(o.email?.body ?? "") },
    sms: { enabled: !!o.sms?.enabled, body: String(o.sms?.body ?? ""), ascii: o.sms?.ascii !== false },
    call: { enabled: !!o.call?.enabled, body: String(o.call?.body ?? ""), voice: String(o.call?.voice ?? "") },
  };
}

export function parseSchedule(raw: unknown): ReminderSchedule | null {
  return parseReminderSchedule(raw, new Date(), DEFAULT_TZ);
}

/** Următoarea rulare după `after` (null = nu mai urmează niciuna). */
export function nextRunOf(s: ReminderSchedule, after: Date): Date | null {
  return computeNextRun(s, after, DEFAULT_TZ);
}

async function senderFor(sc: Row) {
  const u =
    (await prisma.user.findFirst({ where: { id: sc.createdById, isActive: true }, select: { id: true, name: true, role: true, isSuperAdmin: true } })) ??
    (await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, role: true, isSuperAdmin: true } }));
  if (!u) return null;
  // numele apare în Jurnalul de notificări: se vede că mesajul a plecat dintr-o programare
  return { id: u.id, name: `Programare „${sc.name}” (${u.name})`.slice(0, 120), role: u.role, isSuperAdmin: u.isSuperAdmin };
}

/** Trimite acum notificarea unei programări (cron sau „Rulează acum”) și actualizează starea ei. Întoarce rezumatul. */
export async function runSchedule(id: string, opts: { manual?: boolean } = {}): Promise<{ ok: boolean; summary: string }> {
  const sc = await prisma.notifySchedule.findUnique({ where: { id } });
  if (!sc) return { ok: false, summary: "Programarea nu există." };
  const msg = asMessage(sc.message);
  const finish = async (ok: boolean, summary: string) => {
    const sched = parseSchedule(sc.schedule);
    const next = !opts.manual && sched ? nextRunOf(sched, new Date()) : undefined;
    await prisma.notifySchedule
      .update({
        where: { id },
        data: {
          lastRunAt: new Date(),
          lastResult: summary.slice(0, 400),
          runCount: { increment: 1 },
          ...(opts.manual ? {} : { nextRunAt: next ?? null, ...(next ? {} : { active: false }) }),
        },
      })
      .catch((e) => console.error("[notify-schedule] starea:", String((e as Error)?.message ?? e).slice(0, 160)));
    console.log(`[notify-schedule] „${sc.name}” (${sc.audience}): ${summary}`);
    return { ok, summary };
  };

  const err = validateMessage(msg);
  if (err) return finish(false, `Nu s-a trimis: ${err}`);
  const sender = await senderFor(sc);
  if (!sender) return finish(false, "Nu s-a trimis: nu există un utilizator activ care să trimită.");
  let ids: string[];
  try {
    ids = [...new Set(await resolveIds(sc))].slice(0, NOTIFY_MAX_RECIPIENTS);
  } catch (e) {
    return finish(false, `Nu s-au putut afla destinatarii: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
  }
  if (ids.length === 0) return finish(true, "Niciun destinatar la această rulare.");

  const campaignId = `sch-${sc.id.slice(-8)}-${Date.now().toString(36)}`;
  let sent = 0, failed = 0, skipped = 0;
  for (let i = 0, index = 0; i < ids.length; i += NOTIFY_CHUNK_SIZE, index++) {
    const input: SendChunkInput = { campaignId, index, totalPlanned: ids.length, ids: ids.slice(i, i + NOTIFY_CHUNK_SIZE), audience: sc.audience === "clients" ? "clients" : "payers", ...msg };
    const r = await deliverNotificationChunk(sender, input);
    if (!r.ok) return finish(false, `Trimitere oprită după ${i} destinatari: ${r.error}`);
    for (const x of r.results) for (const ch of [x.email, x.sms, x.call]) {
      if (ch.status === "sent") sent++;
      else if (ch.status === "failed") failed++;
      else skipped++;
    }
  }
  return finish(failed === 0, `${ids.length} destinatari: ${sent} mesaje trimise, ${failed} eșuate, ${skipped} omise.`);
}

/** Programările scadente (nextRunAt trecut): fiecare se „revendică” atomic (nextRunAt trece la următoarea dată), deci nu pleacă de două ori nici dacă rulează două procese. */
export async function runDueNotifySchedules(now = new Date()): Promise<{ due: number; ran: number }> {
  const due = await prisma.notifySchedule.findMany({ where: { active: true, nextRunAt: { lte: now } }, orderBy: { nextRunAt: "asc" }, take: 5, select: { id: true, schedule: true, nextRunAt: true } });
  let ran = 0;
  for (const d of due) {
    const sched = parseSchedule(d.schedule);
    const next = sched ? nextRunOf(sched, now) : null;
    const claim = await prisma.notifySchedule.updateMany({
      where: { id: d.id, active: true, nextRunAt: d.nextRunAt },
      data: { nextRunAt: next, ...(next ? {} : { active: false }) },
    });
    if (claim.count !== 1) continue; // altcineva a revendicat-o
    ran++;
    await runSchedule(d.id).catch((e) => console.error("[notify-schedule] rulare:", String((e as Error)?.message ?? e).slice(0, 200)));
  }
  return { due: due.length, ran };
}

// ── Gestionarea (apelată din acțiuni) ───────────────────────────────────────────────────────────

export async function createSchedule(
  actor: { id: string; name: string; role: string; isSuperAdmin: boolean },
  input: { name: string; audience: Audience; filters: unknown; ids: string[]; message: unknown; schedule: unknown },
): Promise<{ ok: true; id: string; nextRunAt: string | null } | { ok: false; error: string }> {
  const name = input.name.trim().slice(0, 80);
  if (!name) return { ok: false, error: "Dă un nume programării." };
  const sched = parseSchedule(input.schedule);
  if (!sched) return { ok: false, error: "Programarea (data / ora / repetarea) nu e validă." };
  const message = asMessage(input.message);
  const err = validateMessage(message);
  if (err) return { ok: false, error: err };
  const next = nextRunOf(sched, new Date());
  if (!next) return { ok: false, error: "Momentul ales a trecut deja." };
  const audience: Audience = input.audience === "clients" ? "clients" : "payers";
  const filters = audience === "clients" ? (input.filters ? sanitizeClientCriteria(input.filters) : null) : input.filters ? sanitizeFilters(input.filters as Record<string, unknown>) : null;
  const ids = Array.isArray(input.ids) ? input.ids.filter((x): x is string => typeof x === "string" && /^[0-9a-f]{24}$/i.test(x)).slice(0, NOTIFY_MAX_RECIPIENTS) : [];
  if (!filters && ids.length === 0) return { ok: false, error: "Nu ai ales destinatari." };
  const row = await prisma.notifySchedule.create({
    data: {
      name,
      audience,
      filters: (filters ?? undefined) as object | undefined,
      ids: filters ? [] : ids,
      message: message as object,
      schedule: sched as object,
      nextRunAt: next,
      createdById: actor.id,
      createdByName: actor.name,
    },
    select: { id: true },
  });
  await logAudit(actor, { action: "payer.notify", module: "Notifications", objectId: row.id, objectName: `Notificare programată „${name}” (${audience === "clients" ? "clienți" : "plătitori"})`, newValue: JSON.stringify(sched).slice(0, 200) });
  return { ok: true, id: row.id, nextRunAt: next.toISOString() };
}

const channelsOf = (m: ScheduleMessage) => [m.email.enabled ? "email" : null, m.sms.enabled ? "SMS" : null, m.call.enabled ? "apel" : null].filter(Boolean).join(" + ");

function filtersText(sc: Row): string {
  if (!sc.filters) return "";
  if (sc.audience === "clients") {
    const c = sanitizeClientCriteria(sc.filters);
    return [c.q ? `„${c.q}”` : "", c.contact ? `contact: ${c.contact}` : ""].filter(Boolean).join(", ");
  }
  const f = sanitizeFilters(sc.filters as Record<string, unknown>) as NotifyFilters;
  return Object.entries(f).filter(([k, v]) => v && k !== "sort").map(([k, v]) => `${k}=${v}`).join(", ");
}

export async function listSchedules(): Promise<ScheduleDto[]> {
  const rows = await prisma.notifySchedule.findMany({ orderBy: [{ active: "desc" }, { nextRunAt: "asc" }, { createdAt: "desc" }], take: 200 });
  return rows.flatMap((r) => {
    const schedule = parseSchedule(r.schedule);
    if (!schedule) return [];
    return [
      {
        id: r.id,
        name: r.name,
        audience: r.audience === "clients" ? ("clients" as const) : ("payers" as const),
        fixedCount: r.filters ? null : r.ids.length,
        filtersText: filtersText(r),
        schedule,
        active: r.active,
        nextRunAt: r.nextRunAt ? r.nextRunAt.toISOString() : null,
        lastRunAt: r.lastRunAt ? r.lastRunAt.toISOString() : null,
        lastResult: r.lastResult,
        runCount: r.runCount,
        createdByName: r.createdByName,
        channels: channelsOf(asMessage(r.message)),
      },
    ];
  });
}

/** Pornește / oprește o programare; la pornire se recalculează următoarea rulare (o programare unică trecută nu mai pornește). */
export async function setScheduleActive(id: string, active: boolean): Promise<{ ok: boolean; error?: string }> {
  const sc = await prisma.notifySchedule.findUnique({ where: { id }, select: { schedule: true } });
  if (!sc) return { ok: false, error: "Programarea nu există." };
  if (!active) {
    await prisma.notifySchedule.update({ where: { id }, data: { active: false } });
    return { ok: true };
  }
  const sched = parseSchedule(sc.schedule);
  const next = sched ? nextRunOf(sched, new Date()) : null;
  if (!next) return { ok: false, error: "Nu mai urmează nicio rulare (momentul ales a trecut)." };
  await prisma.notifySchedule.update({ where: { id }, data: { active: true, nextRunAt: next } });
  return { ok: true };
}

export async function deleteSchedule(id: string): Promise<void> {
  await prisma.notifySchedule.deleteMany({ where: { id } });
}
