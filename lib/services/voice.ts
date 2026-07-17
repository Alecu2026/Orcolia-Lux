import "server-only";
import { env } from "../env";
import {
  voiceParsedSchema, taskVoiceParsedSchema, universalVoiceParsedSchema,
  type VoiceParsed, type TaskVoiceParsed, type UniversalVoiceParsed,
} from "../validation";
import { todayKey, tomorrowKey, addDaysToKey } from "../date";

export type TaskContext = {
  users: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  clients: { id: string; name: string }[];
};

const OPENAI = "https://api.openai.com/v1";

export class VoiceError extends Error {}

/** Transcrie audio cu Whisper (OpenAI-compatibil). */
export async function transcribeAudio(
  buffer: ArrayBuffer,
  filename: string,
  mime: string,
): Promise<string> {
  if (!env.ai.openaiApiKey) {
    throw new VoiceError("AI nu este configurat (lipsește OPENAI_API_KEY).");
  }
  const fd = new FormData();
  fd.append("file", new Blob([buffer], { type: mime || "audio/webm" }), filename);
  fd.append("model", env.ai.transcribeModel);
  fd.append("language", "ro");

  const res = await fetch(`${OPENAI}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.ai.openaiApiKey}` },
    body: fd,
  });
  if (!res.ok) {
    throw new VoiceError(`Transcriere eșuată (${res.status}).`);
  }
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}

function dateContext(tz: string): string {
  const t = todayKey(tz);
  const rows: string[] = [];
  for (let i = 0; i < 8; i++) {
    const key = addDaysToKey(t, i, tz);
    const [y, m, d] = key.split("-").map(Number);
    const label = new Intl.DateTimeFormat("ro-RO", { timeZone: tz, weekday: "long" }).format(
      new Date(Date.UTC(y, m - 1, d, 12)),
    );
    rows.push(`${label}=${key}`);
  }
  return rows.join(", ");
}

/** Extrage date structurate dintr-o comandă în limbaj natural. */
export async function parseCommand(
  transcript: string,
  tz: string,
): Promise<VoiceParsed> {
  if (!env.ai.openaiApiKey) {
    throw new VoiceError("AI nu este configurat (lipsește OPENAI_API_KEY).");
  }
  if (!transcript) return { intent: "unknown" };

  const system = [
    "Ești un asistent care extrage o programare dintr-o frază în limba română.",
    "Răspunde DOAR cu JSON valid, fără text suplimentar.",
    "Câmpuri: intent('create'|'reschedule'|'unknown'), clientName, phone, email, category, dateKey('YYYY-MM-DD'), time('HH:mm', 24h), durationMinutes(int), message, reminderEmail(bool), reminderTelegram(bool).",
    `Azi=${todayKey(tz)}, Mâine=${tomorrowKey(tz)}.`,
    `Zilele săptămânii: ${dateContext(tz)}.`,
    "Ore ambigue în context de business: 'la 3' => 15:00, 'la 9' dimineața => 09:00.",
    "Dacă lipsește un câmp, omite-l. Nu inventa clienți.",
  ].join("\n");

  const res = await fetch(`${OPENAI}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.ai.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.ai.parseModel,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: transcript },
      ],
    }),
  });
  if (!res.ok) throw new VoiceError(`Procesare AI eșuată (${res.status}).`);

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = data.choices?.[0]?.message?.content ?? "{}";
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new VoiceError("Răspuns AI invalid.");
  }
  const parsed = voiceParsedSchema.safeParse(obj);
  return parsed.success ? parsed.data : { intent: "unknown" };
}

export async function transcribeAndParse(
  buffer: ArrayBuffer,
  filename: string,
  mime: string,
  tz: string,
): Promise<{ transcript: string; parsed: VoiceParsed }> {
  const transcript = await transcribeAudio(buffer, filename, mime);
  const parsed = await parseCommand(transcript, tz);
  return { transcript, parsed };
}

/** Extrage câmpuri de task/tichet dintr-o comandă vocală, cu context pentru potrivire entități. */
export async function parseTaskCommand(
  transcript: string,
  tz: string,
  context: TaskContext,
): Promise<TaskVoiceParsed> {
  if (!env.ai.openaiApiKey) throw new VoiceError("AI nu este configurat (lipsește OPENAI_API_KEY).");
  if (!transcript) return {};

  const fmt = (list: { id: string; name: string }[]) =>
    list.length ? list.map((x) => `${x.id}=${x.name}`).join(", ") : "—";

  const system = [
    "Ești un asistent care extrage un task/tichet din o frază în română.",
    "Răspunde DOAR cu JSON valid, fără text suplimentar.",
    "Câmpuri posibile:",
    "  title: string — titlu scurt obligatoriu",
    "  type: 'TASK'|'TICKET' — tichet/ticket→TICKET, altfel TASK",
    "  priority: 'LOW'|'MEDIUM'|'HIGH'|'URGENT' — scăzut→LOW, mediu→MEDIUM, ridicat/important→HIGH, urgent/critic→URGENT",
    `  dueDate: 'YYYY-MM-DD' — azi=${todayKey(tz)}, mâine=${tomorrowKey(tz)}, zile: ${dateContext(tz)}`,
    "  dueTime: 'HH:mm' (24h) — 'la 3' context business=15:00",
    `  assigneeId: exact ID din: ${fmt(context.users)} — potrivire fuzzy după nume, ignoră diacritice`,
    `  teamId: exact ID din: ${fmt(context.teams)}`,
    `  projectId: exact ID din: ${fmt(context.projects)} — dacă proiectul menționat există`,
    "  newProjectName: string — dacă proiectul menționat NU se găsește în lista de mai sus",
    `  clientId: exact ID din: ${fmt(context.clients)} — dacă clientul menționat există`,
    "  newClientName: string — dacă clientul menționat NU se găsește în lista de mai sus",
    "Reguli: omite câmpurile nelipsite. Nu inventa ID-uri. Nu seta simultan projectId și newProjectName.",
  ].join("\n");

  const res = await fetch(`${OPENAI}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.ai.openaiApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.ai.parseModel,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: transcript }],
    }),
  });
  if (!res.ok) throw new VoiceError(`Procesare AI eșuată (${res.status}).`);

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = data.choices?.[0]?.message?.content ?? "{}";
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { throw new VoiceError("Răspuns AI invalid."); }
  const parsed = taskVoiceParsedSchema.safeParse(obj);
  return parsed.success ? parsed.data : {};
}

export async function transcribeAndParseTask(
  buffer: ArrayBuffer,
  filename: string,
  mime: string,
  tz: string,
  context: TaskContext,
): Promise<{ transcript: string; parsed: TaskVoiceParsed }> {
  const transcript = await transcribeAudio(buffer, filename, mime);
  const parsed = await parseTaskCommand(transcript, tz, context);
  return { transcript, parsed };
}

/** Extrage orice entitate CRM (task/ticket/proiect/client/factură) dintr-o comandă vocală. */
export async function parseUniversalCommand(
  transcript: string,
  tz: string,
  context: TaskContext,
): Promise<UniversalVoiceParsed> {
  if (!env.ai.openaiApiKey) throw new VoiceError("AI nu este configurat (lipsește OPENAI_API_KEY).");
  if (!transcript) return { entity: "task" };

  const fmt = (list: { id: string; name: string }[]) =>
    list.length ? list.map((x) => `${x.id}=${x.name}`).join(", ") : "—";

  const system = [
    "Ești un asistent CRM care extrage date structurate dintr-o comandă vocală în română.",
    "Detectează tipul entității și extrage câmpurile relevante.",
    "Răspunde DOAR cu JSON valid, fără text suplimentar.",
    "",
    "Câmpul 'entity' (obligatoriu): 'task'|'ticket'|'project'|'client'|'invoice'",
    "  tichet/ticket/reclamație/sesizare → 'ticket'",
    "  proiect → 'project'",
    "  client/companie/firmă/partener → 'client'",
    "  factură/factura/invoice/bon → 'invoice'",
    "  altfel → 'task'",
    "",
    "Câmpuri comune (pentru orice entitate):",
    "  title: string — titlu/nume scurt principal",
    "  description: string — descriere suplimentară (opțional)",
    "",
    "Câmpuri task/ticket:",
    "  priority: 'LOW'|'MEDIUM'|'HIGH'|'URGENT' — scăzut→LOW, mediu→MEDIUM, important→HIGH, urgent/critic→URGENT",
    `  dueDate: 'YYYY-MM-DD' — azi=${todayKey(tz)}, mâine=${tomorrowKey(tz)}, zile: ${dateContext(tz)}`,
    "  dueTime: 'HH:mm' (24h) — 'la 3' în context business = 15:00",
    `  assigneeId: exact ID din: ${fmt(context.users)} — potrivire fuzzy după nume`,
    `  teamId: exact ID din: ${fmt(context.teams)}`,
    `  projectId: exact ID din: ${fmt(context.projects)} (dacă proiectul există)`,
    "  newProjectName: string (dacă proiectul menționat NU există în lista de mai sus)",
    `  clientId: exact ID din: ${fmt(context.clients)} (dacă clientul există)`,
    "  newClientName: string (dacă clientul menționat NU există în lista de mai sus)",
    "",
    "Câmpuri suplimentare project:",
    `  clientId, newClientName, assigneeId, teamId — la fel ca mai sus`,
    "",
    "Câmpuri client:",
    "  clientPhone: string — număr de telefon",
    "  clientEmail: string — adresă email",
    "",
    "Câmpuri invoice:",
    `  clientId: exact ID din: ${fmt(context.clients)} (dacă clientul există)`,
    "  newClientName: string (dacă clientul nu există)",
    `  projectId: exact ID din: ${fmt(context.projects)} (dacă proiectul există)`,
    "  invoiceAmount: number — suma totală menționată",
    `  invoiceDueDate: 'YYYY-MM-DD' — termenul de plată`,
    "  invoiceNotes: string — observații/note",
    "  invoiceItems: array de {description:string, qty:number, unitPrice:number} — linii din factură",
    "",
    "REGULI: omite câmpurile lipsă. Nu inventa ID-uri. Nu seta simultan xId și newXName pentru același obiect.",
  ].join("\n");

  const res = await fetch(`${OPENAI}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.ai.openaiApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.ai.parseModel,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: transcript }],
    }),
  });
  if (!res.ok) throw new VoiceError(`Procesare AI eșuată (${res.status}).`);

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = data.choices?.[0]?.message?.content ?? "{}";
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { throw new VoiceError("Răspuns AI invalid."); }
  const parsed = universalVoiceParsedSchema.safeParse(obj);
  return parsed.success ? parsed.data : { entity: "task" };
}

export async function transcribeAndParseUniversal(
  buffer: ArrayBuffer,
  filename: string,
  mime: string,
  tz: string,
  context: TaskContext,
): Promise<{ transcript: string; parsed: UniversalVoiceParsed }> {
  const transcript = await transcribeAudio(buffer, filename, mime);
  const parsed = await parseUniversalCommand(transcript, tz, context);
  return { transcript, parsed };
}
