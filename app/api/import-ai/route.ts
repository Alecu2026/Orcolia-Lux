import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { parseWorkbook } from "@/lib/import-utils";
import { createTask } from "@/lib/services/tasks";
import { createAppointment } from "@/lib/services/appointments";

const OPENAI = "https://api.openai.com/v1";

type AiRow = Record<string, string | number | boolean | null>;

type AiResponse = {
  entity: "tasks" | "tickets" | "projects" | "clients" | "appointments";
  rows: AiRow[];
};

async function callOpenAI(systemPrompt: string, userContent: string): Promise<string> {
  const res = await fetch(`${OPENAI}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.ai.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.ai.parseModel,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${err}`);
  }
  const data = await res.json() as { choices: { message: { content: string } }[] };
  return data.choices[0].message.content;
}

const SYSTEM_PROMPT = `Ești un asistent care analizează tabele de date și le convertește în JSON structurat pentru a fi importate într-o aplicație de management.

Analizează datele primite și returnează un JSON cu structura:
{
  "entity": "<tipul entității: tasks | tickets | projects | clients | appointments>",
  "rows": [
    { /* câmpuri normalizate */ },
    ...
  ]
}

Reguli de normalizare:
- Detectează automat tipul entității din coloanele existente
- Pentru PROJECTS: câmpurile sunt: Nume (obligatoriu), Descriere, Status (Activ/Finalizat/Arhivat/În așteptare), Client, Echipă, Asignat, Adresă
- Pentru TASKS: câmpurile sunt: Titlu (obligatoriu), Tip (Task/Tichet), Status (Nou/Asignat/Citit/În lucru/În așteptare/Review/Finalizat/Anulat), Prioritate (Scăzută/Medie/Ridicată/Urgentă), Asignat, Echipă, Proiect, Client, Categorie, Scadent (format ZZ.LL.AAAA), Descriere
- Pentru CLIENTS: câmpurile sunt: Nume (obligatoriu), Telefon, Email, Note
- Pentru APPOINTMENTS: câmpurile sunt: Data (ZZ.LL.AAAA, obligatoriu), Ora start (HH:mm, obligatoriu), Client (obligatoriu), Titlu, Status, Categorie, Ora sfârșit
- Traduce valorile din orice limbă în română/format recunoscut
- Dacă un câmp e gol sau neclar, pune null
- Returnează DOAR JSON valid, fără explicații
`;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  const userId = user.id;

  if (!env.ai.enabled) {
    return Response.json({ error: "AI nu este configurat (lipsește OPENAI_API_KEY)." }, { status: 503 });
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await req.arrayBuffer();
  } catch {
    return Response.json({ error: "Nu s-a putut citi fișierul." }, { status: 400 });
  }

  // Extrage tabelul ca text pentru AI
  let tableText: string;
  try {
    const rows = parseWorkbook(buffer);
    if (rows.length === 0) return Response.json({ error: "Fișierul este gol." }, { status: 400 });
    const headers = Object.keys(rows[0]);
    const lines = [
      headers.join(" | "),
      ...rows.map((r) => headers.map((h) => r[h] ?? "").join(" | ")),
    ];
    tableText = lines.join("\n");
  } catch {
    return Response.json({ error: "Fișier invalid sau corupt." }, { status: 400 });
  }

  // Trimite la OpenAI
  let parsed: AiResponse;
  try {
    const raw = await callOpenAI(SYSTEM_PROMPT, tableText);
    parsed = JSON.parse(raw) as AiResponse;
  } catch (e) {
    return Response.json({ error: `AI nu a putut analiza fișierul: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }

  const { entity, rows: aiRows } = parsed;
  if (!entity || !Array.isArray(aiRows)) {
    return Response.json({ error: "Răspuns AI invalid." }, { status: 500 });
  }

  // Reutilizăm aceeași logică de import ca la endpoint-ul normal
  // Fetch lookups
  const [allUsers, allTeams, allProjects, allCategories, allClients, existingProjects] = await Promise.all([
    prisma.user.findMany({ select: { id: true, name: true } }),
    prisma.team.findMany({ select: { id: true, name: true } }),
    prisma.project.findMany({ select: { id: true, name: true } }),
    prisma.category.findMany({ select: { id: true, name: true } }),
    prisma.client.findMany({ where: { userId: userId }, select: { id: true, name: true } }),
    prisma.project.findMany({ select: { id: true, name: true } }),
  ]);

  const userByName = new Map(allUsers.map((u) => [u.name.trim().toLowerCase(), u.id]));
  const teamByName = new Map(allTeams.map((t) => [t.name.trim().toLowerCase(), t.id]));
  const projectByName = new Map(allProjects.map((p) => [p.name.trim().toLowerCase(), p.id]));
  const categoryByName = new Map(allCategories.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const clientByName = new Map(allClients.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const existingProjectByName = new Map(existingProjects.map((p) => [p.name.trim().toLowerCase(), p.id]));

  const result = { imported: 0, total: aiRows.length, failed: [] as { row: number; error: string }[], entity };

  async function resolveOrCreateClient(name: string): Promise<string | null> {
    if (!name || name === "-") return null;
    const key = name.trim().toLowerCase();
    let id = clientByName.get(key);
    if (!id) {
      const nc = await prisma.client.create({ data: { userId: userId, name: name.trim() }, select: { id: true } });
      clientByName.set(key, nc.id);
      id = nc.id;
    }
    return id;
  }

  async function resolveOrCreateProject(name: string): Promise<string | null> {
    if (!name) return null;
    const key = name.trim().toLowerCase();
    let id = projectByName.get(key);
    if (!id) {
      const np = await prisma.project.create({ data: { name: name.trim(), ownerId: userId }, select: { id: true } });
      projectByName.set(key, np.id);
      id = np.id;
    }
    return id;
  }

  function str(v: unknown): string { return v != null ? String(v).trim() : ""; }

  // ─── PROJECTS ────────────────────────────────────────────────────────────
  if (entity === "projects") {
    const STATUS_MAP: Record<string, string> = {
      "Activ": "ACTIVE", "Active": "ACTIVE", "În așteptare": "ON_HOLD", "On Hold": "ON_HOLD",
      "Finalizat": "DONE", "Done": "DONE", "Completed": "DONE", "Arhivat": "ARCHIVED",
    };
    for (let i = 0; i < aiRows.length; i++) {
      const r = aiRows[i];
      const rowNum = i + 2;
      const name = str(r["Nume"]);
      if (!name) { result.failed.push({ row: rowNum, error: "Lipsește Numele." }); continue; }
      if (existingProjectByName.has(name.toLowerCase())) continue;

      const clientId = await resolveOrCreateClient(str(r["Client"]));
      const teamId = str(r["Echipă"]) ? (teamByName.get(str(r["Echipă"]).toLowerCase()) ?? null) : null;
      const assigneeId = str(r["Asignat"]) ? (userByName.get(str(r["Asignat"]).toLowerCase()) ?? null) : null;
      const status = (STATUS_MAP[str(r["Status"])] ?? "ACTIVE") as import("@prisma/client").ProjectStatus;

      try {
        await prisma.project.create({
          data: { name, description: str(r["Descriere"]) || null, status, address: str(r["Adresă"]) || null, ownerId: userId, clientId, teamId, assigneeId },
        });
        existingProjectByName.set(name.toLowerCase(), "");
        result.imported++;
      } catch (e) { result.failed.push({ row: rowNum, error: e instanceof Error ? e.message : "Eroare" }); }
    }
  }

  // ─── TASKS / TICKETS ─────────────────────────────────────────────────────
  else if (entity === "tasks" || entity === "tickets") {
    const STATUS_MAP: Record<string, string> = {
      "Nou": "NEW", "Asignat": "ASSIGNED", "Citit": "READ", "În lucru": "IN_PROGRESS",
      "În așteptare": "ON_HOLD", "Review": "REVIEW", "Finalizat": "DONE", "Anulat": "CANCELLED",
    };
    const PRIO_MAP: Record<string, string> = {
      "Scăzută": "LOW", "Medie": "MEDIUM", "Ridicată": "HIGH", "Urgentă": "URGENT",
    };
    for (let i = 0; i < aiRows.length; i++) {
      const r = aiRows[i];
      const rowNum = i + 2;
      const title = str(r["Titlu"]);
      if (!title) { result.failed.push({ row: rowNum, error: "Lipsește Titlul." }); continue; }

      const assigneeId = str(r["Asignat"]) ? (userByName.get(str(r["Asignat"]).toLowerCase()) ?? null) : null;
      const teamId = str(r["Echipă"]) ? (teamByName.get(str(r["Echipă"]).toLowerCase()) ?? null) : null;
      const projectId = await resolveOrCreateProject(str(r["Proiect"]));
      const clientId = await resolveOrCreateClient(str(r["Client"]));
      const categoryId = str(r["Categorie"]) ? (categoryByName.get(str(r["Categorie"]).toLowerCase()) ?? null) : null;
      const statusVal = (STATUS_MAP[str(r["Status"])] ?? "NEW") as import("@prisma/client").TaskStatus;
      const priorityVal = (PRIO_MAP[str(r["Prioritate"])] ?? "MEDIUM") as import("@prisma/client").TaskPriority;
      const typeVal = (str(r["Tip"]) === "Tichet" ? "TICKET" : entity === "tickets" ? "TICKET" : "TASK") as import("@prisma/client").TaskType;

      let dueAt: Date | null = null;
      if (str(r["Scadent"])) {
        const m = str(r["Scadent"]).match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
        if (m) dueAt = new Date(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T00:00:00.000Z`);
      }

      try {
        const created = await createTask(user.id, { title, description: str(r["Descriere"]) || undefined, type: typeVal, priority: priorityVal, dueAt, assigneeId, teamId, projectId, categoryId });
        const updates: Record<string, unknown> = {};
        if (statusVal !== "NEW") updates.status = statusVal;
        if (clientId) updates.clientId = clientId;
        if (Object.keys(updates).length) await prisma.task.update({ where: { id: created.id }, data: updates });
        result.imported++;
      } catch (e) { result.failed.push({ row: rowNum, error: e instanceof Error ? e.message : "Eroare" }); }
    }
  }

  // ─── CLIENTS ─────────────────────────────────────────────────────────────
  else if (entity === "clients") {
    for (let i = 0; i < aiRows.length; i++) {
      const r = aiRows[i];
      const rowNum = i + 2;
      const name = str(r["Nume"]);
      if (!name) { result.failed.push({ row: rowNum, error: "Lipsește Numele." }); continue; }
      try {
        await prisma.client.create({ data: { userId: userId, name, phone: str(r["Telefon"]) || null, email: str(r["Email"]) || null, notes: str(r["Note"]) || null } });
        result.imported++;
      } catch (e) { result.failed.push({ row: rowNum, error: e instanceof Error ? e.message : "Eroare" }); }
    }
  }

  // ─── APPOINTMENTS ────────────────────────────────────────────────────────
  else if (entity === "appointments") {
    for (let i = 0; i < aiRows.length; i++) {
      const r = aiRows[i];
      const rowNum = i + 2;
      const dateKey = str(r["Data"]);
      const time = str(r["Ora start"]);
      const clientName = str(r["Client"]);
      if (!dateKey || !time || !clientName) {
        result.failed.push({ row: rowNum, error: "Lipsesc câmpuri obligatorii: Data, Ora start, Client." });
        continue;
      }
      const clientId = await resolveOrCreateClient(clientName);
      if (!clientId) { result.failed.push({ row: rowNum, error: "Nu s-a putut crea clientul." }); continue; }

      const apptResult = await createAppointment(user.id, {
        clientId,
        dateKey,
        time,
        title: str(r["Titlu"]) || undefined,
        categoryId: str(r["Categorie"]) ? (categoryByName.get(str(r["Categorie"]).toLowerCase()) ?? undefined) : undefined,
        reminderEmail: false,
        reminderTelegram: false,
      });
      if (!apptResult.ok) { result.failed.push({ row: rowNum, error: apptResult.error }); }
      else result.imported++;
    }
  }

  return Response.json(result);
}
