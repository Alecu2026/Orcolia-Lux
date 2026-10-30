import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { parseWorkbook, parseJsonRows, parseRoDateKey, parseTime, mapLabel, ImportResult } from "@/lib/import-utils";
import { can } from "@/lib/permissions";
import {
  RO_TO_TASK_STATUS,
  RO_TO_TASK_PRIORITY,
  RO_TO_TASK_TYPE,
  RO_TO_PROJECT_STATUS,
  RO_TO_APPT_STATUS,
} from "@/lib/import-utils";
import { createTask } from "@/lib/services/tasks";
import { createAppointment } from "@/lib/services/appointments";
import { invalidatePayers } from "@/lib/services/payer-cache";
import { DEFAULT_TZ, zonedToUtc } from "@/lib/date";
import { cleanContractDate, contractDate, contractKey } from "@/lib/contract-expiry";
import type { Prisma } from "@prisma/client";

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
    rows = parseJsonRows(buffer) ?? parseWorkbook(buffer);
  } catch (e) {
    return Response.json(
      { error: e instanceof SyntaxError ? "JSON invalid." : e instanceof Error && e.message.startsWith("JSON") ? e.message : "Fișier invalid sau corupt." },
      { status: 400 },
    );
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
    if (!can(user, "tasks.create") || !can(user, entity === "tickets" ? "tickets.import" : "tasks.import")) return Response.json({ error: "Fără permisiune pentru import de sarcini." }, { status: 403 });
    // Pre-fetch lookup tables
    const [allUsers, allTeams, allProjects, allCategories, allClients] = await Promise.all([
      prisma.user.findMany({ select: { id: true, name: true } }),
      prisma.team.findMany({ select: { id: true, name: true } }),
      prisma.project.findMany({ select: { id: true, name: true } }),
      prisma.category.findMany({ select: { id: true, name: true } }),
      // Clienții sunt comuni pentru organizație: altfel un client creat de altcineva ar fi dublat la import. Clienții obișnuiți au prioritate față de plătitori.
      prisma.client.findMany({ select: { id: true, name: true, meterSeries: true } }),
    ]);

    const userByName = new Map(allUsers.map((u) => [u.name.trim().toLowerCase(), u.id]));
    const teamByName = new Map(allTeams.map((t) => [t.name.trim().toLowerCase(), t.id]));
    const projectByName = new Map(allProjects.map((p) => [p.name.trim().toLowerCase(), p.id]));
    const categoryByName = new Map(allCategories.map((c) => [c.name.trim().toLowerCase(), c.id]));
    const clientByName = new Map<string, string>();
    for (const c of [...allClients].sort((a, b) => Number(!!a.meterSeries) - Number(!!b.meterSeries))) {
      const k = c.name.trim().toLowerCase();
      if (!clientByName.has(k)) clientByName.set(k, c.id);
    }

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
        const mapped = mapLabel(RO_TO_TASK_TYPE, r["Tip"]);
        if (!mapped) {
          result.failed.push({
            row: rowNum,
            error: `Tipul '${r["Tip"]}' nu este recunoscut. Valori acceptate: Sarcină, Cerere.`,
          });
          continue;
        }
        typeVal = mapped as import("@prisma/client").TaskType;
      }

      let statusVal: import("@prisma/client").TaskStatus | undefined;
      if (r["Status"]) {
        const mapped = mapLabel(RO_TO_TASK_STATUS, r["Status"]);
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
        const mapped = mapLabel(RO_TO_TASK_PRIORITY, r["Prioritate"]);
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
          if (!can(user, "projects.create")) {
            result.failed.push({ row: rowNum, error: `Proiectul '${r["Proiect"]}' nu există și nu ai permisiunea să-l creezi.` });
            continue;
          }
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
          if (!can(user, "clients.create")) {
            result.failed.push({ row: rowNum, error: `Clientul '${r["Client"]}' nu există și nu ai permisiunea să-l creezi.` });
            continue;
          }
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
        // Miezul nopții în fusul Europe/Bucharest (ca la crearea din formular), nu miezul nopții UTC.
        dueAt = zonedToUtc(dateKey, "00:00", TZ);
      }

      // „Data executării” (cereri): aceeași validare de dată calendaristică ca la expirarea contractului; coloanele goale lasă câmpurile necompletate
      const executedRaw = (r["Data executării"] ?? "").trim();
      const executedKey = executedRaw ? cleanContractDate(executedRaw) : null;
      if (executedRaw && !executedKey) {
        result.failed.push({ row: rowNum, error: `Data executării '${executedRaw}' nu este validă. Format acceptat: ZZ.LL.AAAA.` });
        continue;
      }
      const consumerName = (r["Nume consumator"] ?? "").replace(/\s+/g, " ").trim().slice(0, 150);

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
          address: r["Adresă"]?.trim() || null,
        });

        // Aplică status și/sau client dacă diferă de default
        const postUpdates: Prisma.TaskUpdateInput = {};
        if (statusVal && statusVal !== "NEW") postUpdates.status = statusVal;
        if (taskClientId) postUpdates.clientId = taskClientId;
        if (consumerName) postUpdates.consumerName = consumerName;
        if (executedKey) postUpdates.executedAt = contractDate(executedKey);
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
    if (!can(user, "projects.create") || !can(user, "projects.import")) return Response.json({ error: "Fără permisiune pentru import de proiecte." }, { status: 403 });
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

      // Un proiect cu același nume există deja: se omite, dar rândul apare în raport (înainte dispărea fără nicio explicație)
      if (projectByName.has(name.toLowerCase())) {
        result.failed.push({ row: rowNum, error: `Proiectul '${name}' există deja — omis.` });
        continue;
      }

      // Status
      const statusRaw = col(r, "Status", "Project Status", "ProjectStatus");
      const statusVal = (mapLabel(STATUS_MAP, statusRaw) ?? "ACTIVE") as import("@prisma/client").ProjectStatus;

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
    if (!can(user, "clients.create") || !can(user, "clients.import")) return Response.json({ error: "Fără permisiune pentru import de clienți." }, { status: 403 });
    const result: ImportResult = { imported: 0, total: rows.length, failed: [] };
    // Clienții obișnuiți existenți (fără plătitori): cheia = nume + telefon (doar cifre). Același fișier importat de două ori nu mai creează dubluri.
    const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
    const seen = new Set((await prisma.client.findMany({ where: { OR: [{ meterSeries: null }, { meterSeries: { isSet: false } }] }, select: { name: true, phone: true } })).map((c) => `${c.name.trim().toLowerCase()}|${digits(c.phone)}`));

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2;

      const name = r["Nume"]?.trim();
      if (!name) {
        result.failed.push({ row: rowNum, error: "Câmpul 'Nume' este obligatoriu." });
        continue;
      }
      const dupKey = `${name.toLowerCase()}|${digits(r["Telefon"])}`;
      if (seen.has(dupKey)) {
        result.failed.push({ row: rowNum, error: `Clientul '${name}'${r["Telefon"] ? ` (${r["Telefon"]})` : ""} există deja — omis.` });
        continue;
      }
      seen.add(dupKey);

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
    if (!can(user, "appointments.manage") || !can(user, "appointments.import")) return Response.json({ error: "Fără permisiune pentru import de programări." }, { status: 403 });
    const allUsersAppt = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, role: true, permissions: true } });
    const userByNameAppt = new Map(allUsersAppt.map((u) => [u.name.trim().toLowerCase(), u]));
    const [allClients, allCategories] = await Promise.all([
      // Clienții sunt comuni pentru organizație: altfel un angajat ar crea duplicate ale clienților adăugați de altcineva.
      prisma.client.findMany({
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

      // „Pentru” (cine e programarea): doar un utilizator existent; altfel rândul e respins cu mesaj
      let assigneeAppt: string | undefined;
      if (r["Pentru"]?.trim()) {
        const forUser = userByNameAppt.get(r["Pentru"].trim().toLowerCase());
        if (!forUser) {
          result.failed.push({ row: rowNum, error: `Utilizatorul '${r["Pentru"]}' (coloana 'Pentru') nu există sau e dezactivat.` });
          continue;
        }
        if (!can(forUser, "appointments.view")) {
          result.failed.push({ row: rowNum, error: `Utilizatorul '${r["Pentru"]}' nu are acces la Programări.` });
          continue;
        }
        // „Pentru” = chiar cel care importă: programarea e a lui, fără asignat
        assigneeAppt = forUser.id === user.id ? undefined : forUser.id;
      }

      let statusVal: "NEW" | "CONFIRMED" = "NEW";
      if (r["Status"]) {
        const mapped = mapLabel(RO_TO_APPT_STATUS, r["Status"]);
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
          ...(assigneeAppt ? { assigneeId: assigneeAppt } : {}),
          ...(r["Adresă"]?.trim() ? { place: { address: r["Adresă"].trim() } } : {}),
        },
        "WEB",
      );

      if (!apptResult.ok) {
        result.failed.push({ row: rowNum, error: apptResult.error });
      } else {
        // Apply full status if it's not NEW/CONFIRMED (createAppointment only accepts those two)
        const fullStatus = r["Status"] ? mapLabel(RO_TO_APPT_STATUS, r["Status"]) : undefined;
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

  // ─── PAYERS (plătitori Apă-Canal) ─────────────────────────────────────────
  // Cheia e "Serie contor" (unică, e și identificatorul de activare a contului din portal):
  // serie existentă -> se actualizează doar câmpurile completate în fișier (parola/starea portalului
  // rămân neatinse); serie nouă -> plătitor nou. Aceleași coloane ca la export, deci un export
  // poate fi modificat și reimportat direct.
  if (entity === "payers") {
    if (!can(user, "clients.create") || !can(user, "clients.edit") || !can(user, "payers.import")) {
      return Response.json({ error: "Fără permisiune pentru import plătitori." }, { status: 403 });
    }

    const col = (r: Record<string, string>, ...keys: string[]): string => {
      for (const k of keys) if (r[k]?.trim()) return r[k].trim();
      return "";
    };
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    const existing = await prisma.client.findMany({
      where: { meterSeries: { not: null } },
      select: { id: true, meterSeries: true, contractExpiresAt: true },
    });
    const idBySeries = new Map(existing.map((c) => [c.meterSeries as string, c.id]));
    const contractBySeries = new Map(existing.map((c) => [c.meterSeries as string, contractKey(c.contractExpiresAt)]));

    const result: ImportResult = { imported: 0, total: rows.length, failed: [] };

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2;

      const series = col(r, "Serie contor", "meterSeries", "Serie");
      if (!series) {
        result.failed.push({ row: rowNum, error: "Câmpul 'Serie contor' este obligatoriu." });
        continue;
      }
      const name = col(r, "Nume", "name");
      const phone = col(r, "Telefon", "phone");
      const email = col(r, "Email", "email").toLowerCase();
      const notes = col(r, "Note", "notes");
      const meterNumber = col(r, "Nr. contor", "meterNumber");
      const consumAddress = col(r, "Adresa consum", "Adresă consum", "consumAddress");
      const readingRaw = col(r, "Indice curent", "meterCurrReading");
      const contractRaw = col(r, "Contract expiră la", "Data expirării contractului", "contractExpiresAt");
      const contractNew = contractRaw ? cleanContractDate(contractRaw) : null;
      if (contractRaw && !contractNew) {
        result.failed.push({ row: rowNum, error: `Data expirării contractului '${contractRaw}' nu este validă (ZZ.LL.AAAA).` });
        continue;
      }

      if (email && !EMAIL_RE.test(email)) {
        result.failed.push({ row: rowNum, error: `Emailul '${email}' nu este valid.` });
        continue;
      }
      let reading: number | undefined;
      if (readingRaw) {
        reading = Number(readingRaw.replace(",", "."));
        if (!Number.isFinite(reading) || reading < 0) {
          result.failed.push({ row: rowNum, error: `Indicele curent '${readingRaw}' nu este valid.` });
          continue;
        }
      }

      const existingId = idBySeries.get(series);
      if (!existingId && !name) {
        result.failed.push({ row: rowNum, error: "Pentru un plătitor nou, câmpul 'Nume' este obligatoriu." });
        continue;
      }

      const fields = {
        ...(name ? { name } : {}),
        ...(phone ? { phone } : {}),
        ...(email ? { email } : {}),
        ...(notes ? { notes } : {}),
        ...(meterNumber ? { meterNumber } : {}),
        ...(consumAddress ? { consumAddress } : {}),
        ...(reading !== undefined ? { meterCurrReading: reading, meterReadingEstimated: false } : {}),
        // coloana goală nu șterge data existentă; o dată schimbată reia notificările „expiră în 30 / 10 zile”
        ...(contractNew && contractNew !== contractBySeries.get(series) ? { contractExpiresAt: contractDate(contractNew), contractNotified: [] } : {}),
      };

      try {
        if (existingId) {
          await prisma.client.update({ where: { id: existingId }, data: fields });
        } else {
          const created = await prisma.client.create({
            data: { userId: user.id, name, meterSeries: series, ...fields },
            select: { id: true },
          });
          idBySeries.set(series, created.id);
        }
        result.imported++;
      } catch (e) {
        result.failed.push({
          row: rowNum,
          error: `Eroare la salvare: ${e instanceof Error ? e.message : "necunoscută"}.`,
        });
      }
    }

    if (result.imported > 0) await invalidatePayers();
    return Response.json(result);
  }

  return Response.json({ error: "Entitate necunoscută." }, { status: 400 });
}
