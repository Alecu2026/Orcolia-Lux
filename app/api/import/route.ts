import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { parseWorkbook, parseRoDateKey, parseTime, ImportResult } from "@/lib/import-utils";
import {
  RO_TO_TASK_STATUS,
  RO_TO_TASK_PRIORITY,
  RO_TO_TASK_TYPE,
  RO_TO_PROJECT_STATUS,
  RO_TO_APPT_STATUS,
} from "@/lib/import-utils";
import { createTask } from "@/lib/services/tasks";
import { createAppointment } from "@/lib/services/appointments";
import { DEFAULT_TZ } from "@/lib/date";

const TZ = DEFAULT_TZ;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const entity = sp.get("entity") ?? "";

  let buffer: ArrayBuffer;
  try {
    buffer = await req.arrayBuffer();
  } catch {
    return Response.json({ error: "Nu s-a putut citi fișierul." }, { status: 400 });
  }

  let rows: ReturnType<typeof parseWorkbook>;
  try {
    rows = parseWorkbook(buffer);
  } catch {
    return Response.json({ error: "Fișier invalid sau corupt." }, { status: 400 });
  }

  if (rows.length === 0) {
    return Response.json({ imported: 0, total: 0, failed: [] } satisfies ImportResult);
  }

  // Debug: returnează cheile primului rând dacă entitatea este "debug"
  if (entity === "debug") {
    const firstRow = rows[0];
    const keys = Object.keys(firstRow).map((k) => ({
      raw: k,
      codes: Array.from(k).map((c) => c.charCodeAt(0).toString(16)).join(" "),
      value: firstRow[k],
    }));
    return Response.json({ keys });
  }

  // ─── TASKS / TICHETE ──────────────────────────────────────────────────────
  if (entity === "tasks" || entity === "tickets") {
    // Pre-fetch lookup tables
    const [allUsers, allTeams, allProjects, allCategories, allClients] = await Promise.all([
      prisma.user.findMany({ select: { id: true, name: true } }),
      prisma.team.findMany({ select: { id: true, name: true } }),
      prisma.project.findMany({ select: { id: true, name: true } }),
      prisma.category.findMany({ select: { id: true, name: true } }),
      prisma.client.findMany({ where: { userId: user.id }, select: { id: true, name: true } }),
    ]);

    const userByName = new Map(allUsers.map((u) => [u.name.trim().toLowerCase(), u.id]));
    const teamByName = new Map(allTeams.map((t) => [t.name.trim().toLowerCase(), t.id]));
    const projectByName = new Map(allProjects.map((p) => [p.name.trim().toLowerCase(), p.id]));
    const categoryByName = new Map(allCategories.map((c) => [c.name.trim().toLowerCase(), c.id]));
    const clientByName = new Map(allClients.map((c) => [c.name.trim().toLowerCase(), c.id]));

    const result: ImportResult = { imported: 0, total: rows.length, failed: [] };

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2; // 1-indexed, +1 for header

      const title = r["Titlu"]?.trim();
      if (!title) {
        result.failed.push({ row: rowNum, error: "Câmpul 'Titlu' este obligatoriu." });
        continue;
      }

      let typeVal: import("@prisma/client").TaskType = entity === "tickets" ? "TICKET" : "TASK";
      if (r["Tip"]) {
        const mapped = RO_TO_TASK_TYPE[r["Tip"]];
        if (!mapped) {
          result.failed.push({
            row: rowNum,
            error: `Tipul '${r["Tip"]}' nu este recunoscut. Valori acceptate: Task, Tichet.`,
          });
          continue;
        }
        typeVal = mapped as import("@prisma/client").TaskType;
      }

      let statusVal: import("@prisma/client").TaskStatus | undefined;
      if (r["Status"]) {
        const mapped = RO_TO_TASK_STATUS[r["Status"]];
        if (!mapped) {
          result.failed.push({
            row: rowNum,
            error: `Statusul '${r["Status"]}' nu este recunoscut. Valori acceptate: ${Object.keys(RO_TO_TASK_STATUS).filter((k) => !k.includes("lucru") || !k.startsWith("In")).join(", ")}.`,
          });
          continue;
        }
        statusVal = mapped as import("@prisma/client").TaskStatus;
      }

      let priorityVal: import("@prisma/client").TaskPriority | undefined;
      if (r["Prioritate"]) {
        const mapped = RO_TO_TASK_PRIORITY[r["Prioritate"]];
        if (!mapped) {
          result.failed.push({
            row: rowNum,
            error: `Prioritatea '${r["Prioritate"]}' nu este recunoscută. Valori acceptate: Scăzută, Medie, Ridicată, Urgentă.`,
          });
          continue;
        }
        priorityVal = mapped as import("@prisma/client").TaskPriority;
      }

      let assigneeId: string | undefined;
      if (r["Asignat"]) {
        const id = userByName.get(r["Asignat"].trim().toLowerCase());
        if (!id) {
          result.failed.push({
            row: rowNum,
            error: `Asignatul '${r["Asignat"]}' nu există în baza de date.`,
          });
          continue;
        }
        assigneeId = id;
      }

      let teamId: string | undefined;
      if (r["Echipă"]) {
        const id = teamByName.get(r["Echipă"].trim().toLowerCase());
        if (!id) {
          result.failed.push({
            row: rowNum,
            error: `Echipa '${r["Echipă"]}' nu există în baza de date.`,
          });
          continue;
        }
        teamId = id;
      }

      let projectId: string | undefined;
      if (r["Proiect"]) {
        const key = r["Proiect"].trim().toLowerCase();
        const existing = projectByName.get(key);
        if (existing) {
          projectId = existing;
        } else {
          // Creează proiect rapid doar cu denumirea
          const newProj = await prisma.project.create({
            data: { name: r["Proiect"].trim(), ownerId: user.id },
            select: { id: true },
          });
          projectByName.set(key, newProj.id);
          projectId = newProj.id;
        }
      }

      let taskClientId: string | undefined;
      if (r["Client"]) {
        const key = r["Client"].trim().toLowerCase();
        const existing = clientByName.get(key);
        if (existing) {
          taskClientId = existing;
        } else {
          const newClient = await prisma.client.create({
            data: { userId: user.id, name: r["Client"].trim() },
            select: { id: true },
          });
          clientByName.set(key, newClient.id);
          taskClientId = newClient.id;
        }
      }

      let categoryId: string | undefined;
      if (r["Categorie"]) {
        const id = categoryByName.get(r["Categorie"].trim().toLowerCase());
        if (!id) {
          result.failed.push({
            row: rowNum,
            error: `Categoria '${r["Categorie"]}' nu există în baza de date.`,
          });
          continue;
        }
        categoryId = id;
      }

      let dueAt: Date | undefined;
      if (r["Scadent"]) {
        const dateKey = parseRoDateKey(r["Scadent"]);
        if (!dateKey) {
          result.failed.push({
            row: rowNum,
            error: `Data scadenței '${r["Scadent"]}' nu este validă. Format acceptat: ZZ.LL.AAAA.`,
          });
          continue;
        }
        dueAt = new Date(`${dateKey}T00:00:00.000Z`);
      }

      try {
        const created = await createTask(user.id, {
          title,
          description: r["Descriere"] || undefined,
          type: typeVal,
          priority: priorityVal,
          dueAt: dueAt ?? null,
          assigneeId: assigneeId ?? null,
          teamId: teamId ?? null,
          projectId: projectId ?? null,
          categoryId: categoryId ?? null,
        });

        // Aplică status și/sau client dacă diferă de default
        const postUpdates: Record<string, unknown> = {};
        if (statusVal && statusVal !== "NEW") postUpdates.status = statusVal;
        if (taskClientId) postUpdates.clientId = taskClientId;
        if (Object.keys(postUpdates).length > 0) {
          await prisma.task.update({ where: { id: created.id }, data: postUpdates });
        }

        result.imported++;
      } catch (e) {
        result.failed.push({
          row: rowNum,
          error: `Eroare la salvare: ${e instanceof Error ? e.message : "necunoscută"}.`,
        });
      }
    }

    return Response.json(result);
  }

  // ─── PROJECTS ─────────────────────────────────────────────────────────────
  if (entity === "projects") {
    const [allUsers, allTeams, allClients, existingProjects] = await Promise.all([
      prisma.user.findMany({ select: { id: true, name: true } }),
      prisma.team.findMany({ select: { id: true, name: true } }),
      prisma.client.findMany({ select: { id: true, name: true } }),
      prisma.project.findMany({ select: { id: true, name: true } }),
    ]);
    const userByName = new Map(allUsers.map((u) => [u.name.trim().toLowerCase(), u.id]));
    const teamByName = new Map(allTeams.map((t) => [t.name.trim().toLowerCase(), t.id]));
    const clientByName = new Map(allClients.map((c) => [c.name.trim().toLowerCase(), c.id]));
    const projectByName = new Map(existingProjects.map((p) => [p.name.trim().toLowerCase(), p.id]));

    // Mapare flexibilă coloane — suportă formatul nostru și formate externe
    const STATUS_MAP: Record<string, string> = {
      ...RO_TO_PROJECT_STATUS,
      "Active": "ACTIVE", "In Progress": "ACTIVE", "Not Started": "ACTIVE",
      "On Hold": "ON_HOLD", "Completed": "DONE", "Done": "DONE",
      "Finished": "DONE", "Cancelled": "ARCHIVED", "Archived": "ARCHIVED",
    };

    function col(r: Record<string, string>, ...keys: string[]): string {
      for (const k of keys) if (r[k]?.trim()) return r[k].trim();
      return "";
    }

    const result: ImportResult = { imported: 0, total: rows.length, failed: [] };

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2;

      // Acceptă "Nume", "Project", "Name"
      const name = col(r, "Nume", "Project", "Name");
      if (!name) {
        result.failed.push({ row: rowNum, error: "Lipsește numele proiectului (coloana 'Nume' sau 'Project')." });
        continue;
      }

      // Skip duplicate
      if (projectByName.has(name.toLowerCase())) continue;

      // Status
      const statusRaw = col(r, "Status", "Project Status", "ProjectStatus");
      const statusVal = (STATUS_MAP[statusRaw] ?? "ACTIVE") as import("@prisma/client").ProjectStatus;

      // Client — creat automat dacă nu există
      let clientId: string | undefined;
      const clientName = col(r, "Client", "Customers", "Customer", "Client Name");
      if (clientName && clientName !== "-") {
        const key = clientName.toLowerCase();
        let id = clientByName.get(key);
        if (!id) {
          const nc = await prisma.client.create({
            data: { userId: user.id, name: clientName },
            select: { id: true },
          });
          clientByName.set(key, nc.id);
          id = nc.id;
        }
        clientId = id;
      }

      // Echipă — skip dacă nu există, fără eroare
      const teamName = col(r, "Echipă", "Team", "Department");
      const teamId = teamName ? (teamByName.get(teamName.toLowerCase()) ?? undefined) : undefined;

      // Asignat — poate fi "Prenume Nume, Prenume Nume", luăm primul
      const assigneeRaw = col(r, "Asignat", "Project Members", "Assigned To", "Assignee").split(/[,;]/)[0].trim();
      const assigneeId = assigneeRaw ? (userByName.get(assigneeRaw.toLowerCase()) ?? undefined) : undefined;

      const description = col(r, "Descriere", "Description");
      const address = col(r, "Adresă", "Address");

      try {
        const proj = await prisma.project.create({
          data: {
            name,
            description: description || null,
            status: statusVal,
            address: address || null,
            ownerId: user.id,
            clientId: clientId ?? null,
            teamId: teamId ?? null,
            assigneeId: assigneeId ?? null,
          },
          select: { id: true },
        });
        projectByName.set(name.toLowerCase(), proj.id);
        result.imported++;
      } catch (e) {
        result.failed.push({
          row: rowNum,
          error: `Eroare la salvare: ${e instanceof Error ? e.message : "necunoscută"}.`,
        });
      }
    }

    return Response.json(result);
  }

  // ─── CLIENTS ──────────────────────────────────────────────────────────────
  if (entity === "clients") {
    const result: ImportResult = { imported: 0, total: rows.length, failed: [] };

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2;

      const name = r["Nume"]?.trim();
      if (!name) {
        result.failed.push({ row: rowNum, error: "Câmpul 'Nume' este obligatoriu." });
        continue;
      }

      try {
        await prisma.client.create({
          data: {
            userId: user.id,
            name,
            phone: r["Telefon"] || null,
            email: r["Email"] || null,
            notes: r["Note"] || null,
          },
        });
        result.imported++;
      } catch (e) {
        result.failed.push({
          row: rowNum,
          error: `Eroare la salvare: ${e instanceof Error ? e.message : "necunoscută"}.`,
        });
      }
    }

    return Response.json(result);
  }

  // ─── APPOINTMENTS ─────────────────────────────────────────────────────────
  if (entity === "appointments") {
    const [allClients, allCategories] = await Promise.all([
      prisma.client.findMany({
        where: { userId: user.id },
        select: { id: true, name: true },
      }),
      prisma.category.findMany({ select: { id: true, name: true } }),
    ]);
    const clientByName = new Map(allClients.map((c) => [c.name.trim().toLowerCase(), c.id]));
    const categoryByName = new Map(allCategories.map((c) => [c.name.trim().toLowerCase(), c.id]));

    const result: ImportResult = { imported: 0, total: rows.length, failed: [] };

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2;

      // Required: Data, Ora start, Client
      const dateKey = parseRoDateKey(r["Data"] ?? "");
      if (!dateKey) {
        result.failed.push({
          row: rowNum,
          error: `Data '${r["Data"] ?? ""}' nu este validă. Format acceptat: ZZ.LL.AAAA.`,
        });
        continue;
      }

      const time = parseTime(r["Ora start"] ?? "");
      if (!time) {
        result.failed.push({
          row: rowNum,
          error: `Ora de start '${r["Ora start"] ?? ""}' nu este validă. Format acceptat: HH:mm.`,
        });
        continue;
      }

      const clientName = r["Client"]?.trim();
      if (!clientName) {
        result.failed.push({ row: rowNum, error: "Câmpul 'Client' este obligatoriu." });
        continue;
      }
      let clientId = clientByName.get(clientName.toLowerCase());
      if (!clientId) {
        // Auto-creare client dacă nu există
        const newClient = await prisma.client.create({
          data: { userId: user.id, name: clientName },
          select: { id: true },
        });
        clientByName.set(clientName.toLowerCase(), newClient.id);
        clientId = newClient.id;
      }

      // Optional: Ora sfârșit → durationMinutes
      let durationMinutes: number | undefined;
      if (r["Ora sfârșit"]) {
        const endTime = parseTime(r["Ora sfârșit"]);
        if (!endTime) {
          result.failed.push({
            row: rowNum,
            error: `Ora de sfârșit '${r["Ora sfârșit"]}' nu este validă. Format acceptat: HH:mm.`,
          });
          continue;
        }
        const [sh, sm] = time.split(":").map(Number);
        const [eh, em] = endTime.split(":").map(Number);
        const diffMin = (eh * 60 + em) - (sh * 60 + sm);
        if (diffMin > 0) durationMinutes = diffMin;
      }

      let categoryId: string | undefined;
      if (r["Categorie"]) {
        const id = categoryByName.get(r["Categorie"].trim().toLowerCase());
        if (!id) {
          result.failed.push({
            row: rowNum,
            error: `Categoria '${r["Categorie"]}' nu există în baza de date.`,
          });
          continue;
        }
        categoryId = id;
      }

      let statusVal: "NEW" | "CONFIRMED" = "NEW";
      if (r["Status"]) {
        const mapped = RO_TO_APPT_STATUS[r["Status"]];
        if (!mapped) {
          result.failed.push({
            row: rowNum,
            error: `Statusul '${r["Status"]}' nu este recunoscut. Valori acceptate: Nou, Confirmat, În lucru, Finalizat, Anulat, Absent.`,
          });
          continue;
        }
        if (mapped === "NEW" || mapped === "CONFIRMED") {
          statusVal = mapped;
        }
      }

      const apptResult = await createAppointment(
        user.id,
        {
          clientId,
          dateKey,
          time,
          durationMinutes,
          title: r["Titlu"]?.trim() || undefined,
          categoryId,
          status: statusVal,
          reminderEmail: false,
          reminderTelegram: false,
        },
        "WEB",
      );

      if (!apptResult.ok) {
        result.failed.push({ row: rowNum, error: apptResult.error });
      } else {
        // Apply full status if it's not NEW/CONFIRMED (createAppointment only accepts those two)
        const fullStatus = r["Status"] ? RO_TO_APPT_STATUS[r["Status"]] : undefined;
        if (fullStatus && fullStatus !== "NEW" && fullStatus !== "CONFIRMED") {
          await prisma.appointment.update({
            where: { id: apptResult.id },
            data: { status: fullStatus as import("@prisma/client").AppointmentStatus },
          });
        }
        result.imported++;
      }
    }

    return Response.json(result);
  }

  return Response.json({ error: "Entitate necunoscută." }, { status: 400 });
}
