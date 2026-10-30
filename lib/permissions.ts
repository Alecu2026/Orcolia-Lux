/**
 * Permisiuni individuale per utilizator.
 * ADMIN (role) sau cheia "admin" => acces total.
 * Cheile sunt stocate în User.permissions (String[]).
 */

export type PermissionKey =
  // Task-uri / Tichete
  | "tasks.view"
  | "tasks.create"
  | "tasks.edit"
  | "tasks.delete"
  | "tasks.assign"
  | "tasks.close"
  // Proiecte
  | "projects.view"
  | "projects.create"
  | "projects.edit"
  | "projects.delete"
  // Clienți
  | "clients.view"
  | "clients.create"
  | "clients.edit"
  | "clients.delete"
  // Facturi
  | "invoices.view"
  | "invoices.create"
  | "invoices.edit"
  | "invoices.delete"
  // Programări
  | "appointments.view"
  | "appointments.manage"
  // Echipe
  | "teams.view"
  | "teams.manage"
  // Pagini (acces la ecran)
  | "dashboard.view"
  | "tickets.view"
  | "kanban.view"
  | "calendar.view"
  | "map.view"
  // Plătitori (pagina Plătitori, fișa, decontarea, Notificări plătitori, Contoare)
  | "payers.view"
  | "payers.edit"
  | "payers.notify"
  | "payers.delete"
  // Citiri lunare din teren (introducere index, locație, poză) — fără acces la datele plătitorilor
  | "meters.read"
  // Rute de citire, comparația planificat / citit pe cititor, nereguli ale contoarelor (administrare)
  | "meters.manage"
  // PBX / apeluri
  | "pbx.view"
  | "pbx.manage"
  // Administrare
  | "reports.view"
  | "users.manage"
  // Simulare de login: intri în contul unui subaltern sau în portalul unui client, cu aceleași drepturi ca ei (expiră la 6 ore)
  | "users.impersonate"
  | "notifications.receive"
  // Personalizarea tabelelor de către utilizator: lățimea coloanelor, culori, mărimea textului, celule spațioase, ordinea coloanelor
  | "tables.customize"
  // Export / import, separat pe pagini (înainte: export = „Vizualizare”, import = „Creare”)
  | "tasks.export"
  | "tasks.import"
  | "tickets.export"
  | "tickets.import"
  | "projects.export"
  | "projects.import"
  | "clients.export"
  | "clients.import"
  | "appointments.export"
  | "appointments.import"
  | "payers.export"
  | "payers.import"
  | "meters.export"
  | "admin";

export const PERMISSION_GROUPS: {
  group: string;
  items: { key: PermissionKey; label: string }[];
}[] = [
  {
    group: "Sarcini / Cereri",
    items: [
      { key: "tasks.view", label: "Vizualizare" },
      { key: "tasks.create", label: "Creare" },
      { key: "tasks.edit", label: "Editare" },
      { key: "tasks.delete", label: "Ștergere" },
      { key: "tasks.assign", label: "Asignare" },
      { key: "tasks.close", label: "Închidere / finalizare" },
      { key: "tasks.export", label: "Export sarcini (Excel / CSV / JSON)" },
      { key: "tasks.import", label: "Import sarcini din fișier" },
      { key: "tickets.export", label: "Export cereri (Excel / CSV / JSON)" },
      { key: "tickets.import", label: "Import cereri din fișier" },
    ],
  },
  {
    group: "Proiecte",
    items: [
      { key: "projects.view", label: "Vizualizare" },
      { key: "projects.create", label: "Creare" },
      { key: "projects.edit", label: "Editare" },
      { key: "projects.delete", label: "Ștergere" },
      { key: "projects.export", label: "Export (Excel / CSV / JSON)" },
      { key: "projects.import", label: "Import din fișier" },
    ],
  },
  {
    group: "Clienți",
    items: [
      { key: "clients.view", label: "Vizualizare" },
      { key: "clients.create", label: "Creare" },
      { key: "clients.edit", label: "Editare" },
      { key: "clients.delete", label: "Ștergere" },
      { key: "clients.export", label: "Export (Excel / CSV / JSON)" },
      { key: "clients.import", label: "Import din fișier" },
    ],
  },
  {
    group: "Facturi",
    items: [
      { key: "invoices.view", label: "Vizualizare" },
      { key: "invoices.create", label: "Creare" },
      { key: "invoices.edit", label: "Editare" },
      { key: "invoices.delete", label: "Ștergere" },
    ],
  },
  {
    group: "Programări",
    items: [
      { key: "appointments.view", label: "Vizualizare" },
      { key: "appointments.manage", label: "Gestionare (creare/editare)" },
      { key: "appointments.export", label: "Export (Excel / CSV / JSON)" },
      { key: "appointments.import", label: "Import din fișier" },
    ],
  },
  {
    group: "Echipe",
    items: [
      { key: "teams.view", label: "Vizualizare" },
      { key: "teams.manage", label: "Gestionare" },
    ],
  },
  {
    group: "Plătitori",
    items: [
      { key: "payers.view", label: "Vizualizare (paginile Plătitori și Contoare, fișa, decontarea)" },
      { key: "payers.edit", label: "Editare (date, notițe)" },
      { key: "payers.notify", label: "Notificări (trimitere SMS/email/apel, șabloane)" },
      { key: "payers.delete", label: "Ștergere" },
      { key: "meters.read", label: "Citiri contoare (introducere index lunar, locație, poză) — pagina Citiri teren" },
      { key: "meters.manage", label: "Rute de citire, planificat vs citit pe cititor, nereguli contoare (administrare)" },
      { key: "payers.export", label: "Export plătitori (lista cu filtre, Notificări, Tabel 1C, decontare)" },
      { key: "payers.import", label: "Import plătitori din fișier" },
      { key: "meters.export", label: "Export contoare și citiri teren (CSV)" },
    ],
  },
  {
    group: "PBX / Apeluri",
    items: [
      { key: "pbx.view", label: "Vizualizare (pagina PBX, apeluri, popup apel primit)" },
      { key: "pbx.manage", label: "Gestionare (autoinformare, registru apeluri)" },
    ],
  },
  {
    group: "Pagini (acces la ecran)",
    items: [
      { key: "dashboard.view", label: "Dashboard" },
      { key: "tickets.view", label: "Cereri" },
      { key: "kanban.view", label: "Kanban" },
      { key: "calendar.view", label: "Calendar" },
      { key: "map.view", label: "Hartă" },
    ],
  },
  {
    group: "Administrare",
    items: [
      { key: "users.manage", label: "Gestionare utilizatori" },
      { key: "users.impersonate", label: "Simulare de login (intri în contul unui subaltern sau în portalul unui client; expiră după 6 ore)" },
      { key: "tables.customize", label: "Personalizare tabele (lățimi coloane, culori, mărime text, celule spațioase)" },
      { key: "admin", label: "Acces administrativ (tot)" },
    ],
  },
];

export const ALL_PERMISSION_KEYS: PermissionKey[] = PERMISSION_GROUPS.flatMap(
  (g) => g.items.map((i) => i.key),
);

export type PermissionSubject = {
  role: "ADMIN" | "STAFF";
  permissions: string[];
};

/**
 * Marcaj pus pe conturile ale căror permisiuni au fost salvate cu lista nouă (pe pagini). Conturile FĂRĂ marcaj au fost create înainte:
 * permisiunile noi li se deduc din cele vechi (LEGACY_FALLBACK), deci nimeni nu pierde sau câștigă acces la actualizare. La prima salvare
 * din fereastra de utilizator, permisiunile devin explicite și apare marcajul.
 */
export const PERMISSIONS_V2 = "perm.v2";

/**
 * Al doilea marcaj: conturile salvate cu lista care are și „Export / Import” pe pagini. Conturile FĂRĂ acest marcaj le primesc deduse din ce aveau înainte
 * (export = „Vizualizare”, import = „Creare” / „Gestionare”), deci nimeni nu pierde exportul / importul la actualizare; la prima salvare din fereastra
 * de utilizator devin explicite, iar administratorul le poate retrage pe fiecare pagină.
 */
export const PERMISSIONS_V3 = "perm.v3";

const EXPORT_IMPORT_FALLBACK: Partial<Record<PermissionKey, PermissionKey[]>> = {
  "tasks.export": ["tasks.view"],
  "tasks.import": ["tasks.create"],
  "tickets.export": ["tickets.view"],
  "tickets.import": ["tasks.create"],
  "projects.export": ["projects.view"],
  "projects.import": ["projects.create"],
  "clients.export": ["clients.view"],
  "clients.import": ["clients.create"],
  "appointments.export": ["appointments.view"],
  "appointments.import": ["appointments.manage"],
  "payers.export": ["payers.view"],
  "payers.import": ["clients.create"],
  "meters.export": ["meters.read", "payers.view"],
};

/** Permisiune nouă → de ce depindea înainte: cheile vechi (oricare) sau "ANY" (avea oricine). */
export const LEGACY_FALLBACK: Partial<Record<PermissionKey, PermissionKey[] | "ANY">> = {
  "dashboard.view": "ANY",
  "tickets.view": ["tasks.view"],
  "kanban.view": ["tasks.view"],
  "calendar.view": ["tasks.view"],
  "map.view": ["projects.view"],
  "payers.view": ["clients.view"],
  "payers.edit": ["clients.edit"],
  "payers.notify": ["clients.edit"],
  "payers.delete": ["clients.delete"],
  "pbx.view": ["clients.view"],
  "pbx.manage": ["clients.edit"],
  "tasks.assign": ["tasks.create", "tasks.edit"],
  "tasks.close": "ANY",
};

/** Are userul permisiunea cerută? ADMIN sau "admin" => mereu true. */
export function can(user: PermissionSubject, key: PermissionKey): boolean {
  if (user.role === "ADMIN") return true;
  if (user.permissions.includes("admin")) return true;
  if (user.permissions.includes(key)) return true;
  const legacy = LEGACY_FALLBACK[key];
  if (legacy && !user.permissions.includes(PERMISSIONS_V2)) {
    return legacy === "ANY" || legacy.some((k) => user.permissions.includes(k));
  }
  const ei = EXPORT_IMPORT_FALLBACK[key];
  if (ei && !user.permissions.includes(PERMISSIONS_V3)) {
    // importul plătitorilor cerea „Creare” ȘI „Editare” la clienți
    if (key === "payers.import") return can(user, "clients.create") && can(user, "clients.edit");
    return ei.some((k) => can(user, k));
  }
  return false;
}

/** Permisiunile EFECTIVE ale unui cont (cele deduse din vechile chei, pentru conturile fără marcaj) — le arată fereastra de utilizator. */
export function effectivePermissionKeys(permissions: string[]): string[] {
  const out = new Set(permissions.filter((p) => p !== PERMISSIONS_V2 && p !== PERMISSIONS_V3));
  if (!permissions.includes(PERMISSIONS_V2)) {
    for (const [k] of Object.entries(LEGACY_FALLBACK)) {
      if (can({ role: "STAFF", permissions }, k as PermissionKey)) out.add(k);
    }
  }
  if (!permissions.includes(PERMISSIONS_V3)) {
    for (const [k] of Object.entries(EXPORT_IMPORT_FALLBACK)) {
      if (can({ role: "STAFF", permissions }, k as PermissionKey)) out.add(k);
    }
  }
  return [...out];
}

/** Datele task-urilor (comentarii, istoric, liste) se văd din oricare pagină care le arată. */
export function canViewTaskData(user: PermissionSubject): boolean {
  return canAny(user, ["tasks.view", "tickets.view", "kanban.view", "calendar.view"]);
}

/** Prima pagină la care are acces — ținta redirecționărilor când cea cerută e interzisă (nu mereu /dashboard, care poate fi și ea interzisă). */
export function homePath(user: PermissionSubject): string {
  const order: [PermissionKey, string][] = [
    ["dashboard.view", "/dashboard"], ["tasks.view", "/tasks"], ["tickets.view", "/tickets"], ["appointments.view", "/appointments"],
    ["projects.view", "/projects"], ["kanban.view", "/kanban"], ["calendar.view", "/calendar"], ["payers.view", "/platitori"],
    ["clients.view", "/clients"], ["invoices.view", "/invoices"], ["pbx.view", "/pbx"], ["map.view", "/harta"], ["teams.view", "/team"], ["meters.read", "/contoare/citiri"],
    ["users.manage", "/users"],
  ];
  for (const [k, path] of order) if (can(user, k)) return path;
  return "/notificari";
}

/**
 * Tipuri de utilizator cu permisiuni PREDEFINITE: la crearea / editarea unui cont se alege tipul și se bifează singure permisiunile lui (care apoi se pot ajusta).
 * Tipul nu se salvează separat: se recunoaște după permisiunile bifate (dacă s-au schimbat față de tip, contul apare ca „Personalizat”).
 */
export type UserTypeKey = "reader" | "operator" | "supervisor" | "viewer";
export const USER_TYPES: { key: UserTypeKey; label: string; description: string; permissions: PermissionKey[] }[] = [
  {
    key: "reader",
    label: "Cititor",
    description: "Doar pagina Citiri teren: introduce indexuri, poze, locația și neregulile contoarelor din rutele atribuite lui.",
    permissions: ["meters.read", "meters.export"],
  },
  {
    key: "operator",
    label: "Operator",
    description: "Sarcini, cereri, clienți, plătitori, notificări, programări și apeluri; fără administrare.",
    permissions: [
      "tasks.view", "tasks.create", "tasks.edit", "tasks.assign", "tasks.close",
      "dashboard.view", "tickets.view", "kanban.view", "calendar.view",
      "projects.view", "clients.view", "clients.create", "clients.edit",
      "payers.view", "payers.notify", "invoices.view", "appointments.view", "appointments.manage", "teams.view",
      "pbx.view",
      "tasks.export", "tasks.import", "tickets.export", "tickets.import", "projects.export", "clients.export", "clients.import", "appointments.export", "appointments.import", "payers.export", "meters.export",
    ],
  },
  {
    key: "supervisor",
    label: "Responsabil citiri",
    description: "Cititor + administrarea rutelor de citire, planificat vs citit și neregulile contoarelor; vede plătitorii și contoarele.",
    permissions: ["meters.read", "meters.manage", "payers.view", "payers.export", "meters.export"],
  },
  {
    key: "viewer",
    label: "Doar vizualizare",
    description: "Poate vedea toate paginile, fără să modifice nimic.",
    // poate vedea tot și exporta ce vede (fără import: nu modifică nimic)
    permissions: ALL_PERMISSION_KEYS.filter((k) => k.endsWith(".view") || k.endsWith(".export")),
  },
];

/** Tipul de utilizator recunoscut după permisiuni (null = personalizat sau administrator). */
export function userTypeOf(role: string, permissions: string[]): UserTypeKey | null {
  if (role === "ADMIN" || permissions.includes("admin")) return null;
  const have = new Set(effectivePermissionKeys(permissions));
  for (const t of USER_TYPES) {
    if (t.permissions.length === have.size && t.permissions.every((p) => have.has(p))) return t.key;
  }
  return null;
}

export function canAny(user: PermissionSubject, keys: PermissionKey[]): boolean {
  return keys.some((k) => can(user, k));
}

export type TaskOwnership = {
  creatorId: string;
  assigneeId: string | null;
  extraAssigneeIds?: string[];
};

/**
 * Editarea câmpurilor unui task / tichet (titlu, descriere, prioritate, proiect, client, adresă, responsabili, termen, categorie):
 * DOAR cu permisiunea „Editare" (sau administrator). Fiind creator sau responsabil nu dă dreptul de editare.
 */
export function canEditTask(user: PermissionSubject): boolean {
  return can(user, "tasks.edit");
}

export type TaskInvolvement = TaskOwnership & { teamId?: string | null; extraTeamIds?: string[] };

/**
 * Lucrul curent pe un task (schimbarea statusului și a progresului, fișiere atașate, răspunsul către client la tichete):
 * cine are „Editare", sau e implicat în task — creator, responsabil, co-responsabil ori membru al unei echipe asignate.
 * Un angajat care nu e în task și nu are „Editare" nu poate schimba nimic. Aceeași regulă se aplică pe server (lib/services/tasks.ts).
 */
export function canWorkOnTask(user: PermissionSubject & { id: string; teamIds?: string[] }, task: TaskInvolvement): boolean {
  if (can(user, "tasks.edit")) return true;
  if (task.creatorId === user.id) return true;
  if (task.assigneeId === user.id) return true;
  if (task.extraAssigneeIds?.includes(user.id)) return true;
  const teams = user.teamIds ?? [];
  if (task.teamId && teams.includes(task.teamId)) return true;
  if (task.extraTeamIds?.some((t) => teams.includes(t))) return true;
  return false;
}

export type TaskVisibilitySubject = {
  id: string;
  taskViewScope: string;
  taskViewTeamIds: string[];
  taskViewMemberIds: string[];
};

/**
 * Tab-ul „Toate” (task-urile pe care are voie să le vadă): administratorii, sau un angajat căruia i s-au dat explicit echipe / persoane
 * vizibile — altfel task-urile acelor persoane n-ar apărea nicăieri în liste (un angajat fără așa ceva vede doar „Ale mele” / „Create de mine”).
 * Lista rămâne mereu plafonată de regula de vizibilitate (vezi buildWhere în lib/queries/tasks.ts).
 */
export function canUseAllScope(user: { role: string; taskViewScope?: string; taskViewTeamIds?: string[]; taskViewMemberIds?: string[] }): boolean {
  if (user.role === "ADMIN") return true;
  return user.taskViewScope === "RESTRICTED" && ((user.taskViewTeamIds?.length ?? 0) > 0 || (user.taskViewMemberIds?.length ?? 0) > 0);
}

export type TaskTeamOwnership = TaskOwnership & {
  teamId: string | null;
  extraTeamIds?: string[];
};

/**
 * Vede userul task-ul ăsta? taskViewScope="ALL" (implicit — comportamentul de dinainte de
 * restricție) vede tot. "RESTRICTED" vede doar: propriile task-uri (creator/asignat/co-asignat —
 * mereu vizibile, indiferent de listele de mai jos) + cele din echipele/persoanele alese de admin
 * la crearea contului (taskViewTeamIds/taskViewMemberIds) — vezi lib/queries/tasks.ts (buildWhere)
 * pentru aceeași regulă aplicată la nivel de listă/export, nu doar la deschiderea individuală.
 */
export function canViewTask(user: TaskVisibilitySubject, task: TaskTeamOwnership): boolean {
  if (user.taskViewScope !== "RESTRICTED") return true;
  if (task.creatorId === user.id) return true;
  if (task.assigneeId === user.id) return true;
  if (task.extraAssigneeIds?.includes(user.id)) return true;
  if (task.teamId && user.taskViewTeamIds.includes(task.teamId)) return true;
  if (task.extraTeamIds?.some((id) => user.taskViewTeamIds.includes(id))) return true;
  if (task.assigneeId && user.taskViewMemberIds.includes(task.assigneeId)) return true;
  if (task.extraAssigneeIds?.some((id) => user.taskViewMemberIds.includes(id))) return true;
  if (user.taskViewMemberIds.includes(task.creatorId)) return true;
  return false;
}
