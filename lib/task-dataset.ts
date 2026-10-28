/**
 * Lista completă de task-uri / tichete în format compact (tupluri + dicționar de nume), pentru motorul local din browser:
 * serverul o construiește o dată (lib/services/task-dataset.ts), o comprimă gzip și o servește cu ETag/304; browserul o ține în IndexedDB
 * și filtrează / sortează / paginează totul în JS. Numele (utilizatori, echipe, proiecte, categorii, clienți) NU sunt repetate pe fiecare rând:
 * rândurile au doar id-uri, iar numele vin o singură dată în `names`.
 */

export const TASK_STATUS_LIST = ["NEW", "ASSIGNED", "READ", "IN_PROGRESS", "ON_HOLD", "REVIEW", "DONE", "CANCELLED"] as const;
export const TASK_PRIORITY_LIST = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

export type TaskTuple = [
  string, // 0 id
  number | null, // 1 seq
  string, // 2 type
  string, // 3 title
  string | null, // 4 description
  number, // 5 status (index în TASK_STATUS_LIST)
  number, // 6 priority (index în TASK_PRIORITY_LIST)
  number, // 7 progress
  number | null, // 8 dueAt (ms)
  number | null, // 9 reminderIntervalMinutes
  string, // 10 creatorId
  string | null, // 11 assigneeId
  string | null, // 12 teamId
  string | null, // 13 projectId
  string | null, // 14 clientId (cel salvat pe task; dacă lipsește, se ia cel al proiectului)
  string | null, // 15 categoryId
  string[], // 16 extraAssigneeIds
  string[], // 17 extraTeamIds
  string | null, // 18 assignmentSettingsJson
  0 | 1, // 19 bypassQuietHours
  number, // 20 createdAt (ms)
  0 | 1, // 21 chatUnread
  string, // 22 solicitantul (tichete din email/portal: fromName sau fromEmail), altfel ""
  string, // 23 adresa (text) sau ""
  string | null, // 24 reminderSchedule (JSON) — lipsește în listele salvate înainte de această versiune
  string | null, // 25 culoarea rândului (hex) — lipsește în listele salvate înainte de această versiune
];

export type TaskNames = {
  /** utilizatori: id → nume */
  u: Record<string, string>;
  /** echipe: id → nume */
  t: Record<string, string>;
  /** proiecte: id → [nume, clientId, lat, lng] */
  p: Record<string, [string, string | null, number | null, number | null]>;
  /** categorii: id → [nume, culoare] */
  c: Record<string, [string, string | null]>;
  /** clienți: id → nume (gol dacă utilizatorul nu are voie să vadă clienții) */
  k: Record<string, string>;
};

export type TaskDatasetPayload = { v: 1; rows: TaskTuple[]; names: TaskNames };

/** Rândul decodat — aceleași câmpuri ca `Task` din TasksManager (datele ca text ISO). */
export type DecodedTask = {
  id: string;
  seq: number | null;
  type: "TASK" | "TICKET" | "WORK_ORDER";
  title: string;
  description: string | null;
  status: (typeof TASK_STATUS_LIST)[number];
  priority: (typeof TASK_PRIORITY_LIST)[number];
  progress: number;
  dueAt: string | null;
  reminderIntervalMinutes: number | null;
  reminderSchedule: string | null;
  creatorId: string;
  assigneeId: string | null;
  teamId: string | null;
  projectId: string | null;
  clientId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  address: string | null;
  extraAssigneeIds: string[];
  extraTeamIds: string[];
  assignmentSettingsJson: string | null;
  bypassQuietHours: boolean;
  assigneeName: string | null;
  teamName: string | null;
  projectName: string | null;
  projectLat: number | null;
  projectLng: number | null;
  clientName: string | null;
  creatorName: string;
  createdAt: string;
  chatUnread: boolean;
  color: string | null;
};

/** Tupluri → rânduri complete (cu numele rezolvate din dicționar). Aceeași logică ca `toRow` de pe server. */
export function decodeTasks(tuples: TaskTuple[], names: TaskNames): DecodedTask[] {
  const out: DecodedTask[] = new Array(tuples.length);
  for (let i = 0; i < tuples.length; i++) {
    const r = tuples[i];
    const project = r[13] ? names.p[r[13]] : undefined;
    const category = r[15] ? names.c[r[15]] : undefined;
    const clientId = r[14] ?? project?.[1] ?? null;
    out[i] = {
      id: r[0],
      seq: r[1],
      type: r[2] as DecodedTask["type"],
      title: r[3],
      description: r[4],
      status: TASK_STATUS_LIST[r[5]] ?? "NEW",
      priority: TASK_PRIORITY_LIST[r[6]] ?? "MEDIUM",
      progress: r[7],
      dueAt: r[8] == null ? null : new Date(r[8]).toISOString(),
      reminderIntervalMinutes: r[9],
      reminderSchedule: r[24] ?? null,
      creatorId: r[10],
      assigneeId: r[11],
      teamId: r[12],
      projectId: r[13],
      clientId,
      categoryId: r[15],
      categoryName: category?.[0] ?? null,
      categoryColor: category?.[1] ?? null,
      address: r[23] || null,
      extraAssigneeIds: r[16],
      extraTeamIds: r[17],
      assignmentSettingsJson: r[18],
      bypassQuietHours: r[19] === 1,
      assigneeName: r[11] ? names.u[r[11]] ?? null : null,
      teamName: r[12] ? names.t[r[12]] ?? null : null,
      projectName: project?.[0] ?? null,
      projectLat: project?.[2] ?? null,
      projectLng: project?.[3] ?? null,
      clientName: clientId ? names.k[clientId] ?? null : null,
      creatorName: r[2] === "TICKET" && r[22] ? r[22] : names.u[r[10]] ?? "Necunoscut",
      createdAt: new Date(r[20]).toISOString(),
      chatUnread: r[21] === 1,
      color: r[25] ?? null,
    };
  }
  return out;
}
