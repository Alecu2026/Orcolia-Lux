/**
 * Permisiuni individuale per utilizator.
 * ADMIN (role) sau cheia "admin" => acces total.
 * Cheile sunt stocate în User.permissions (String[]).
 */

export type PermissionKey =
  // Task-uri / Tichete / Work Orders
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
  // Administrare
  | "dashboard.view"
  | "reports.view"
  | "users.manage"
  | "notifications.receive"
  | "admin";

export const PERMISSION_GROUPS: {
  group: string;
  items: { key: PermissionKey; label: string }[];
}[] = [
  {
    group: "Task-uri / Tichete / Work Orders",
    items: [
      { key: "tasks.view", label: "Vizualizare" },
      { key: "tasks.create", label: "Creare" },
      { key: "tasks.edit", label: "Editare" },
      { key: "tasks.delete", label: "Ștergere" },
      { key: "tasks.assign", label: "Asignare" },
      { key: "tasks.close", label: "Închidere / finalizare" },
    ],
  },
  {
    group: "Proiecte",
    items: [
      { key: "projects.view", label: "Vizualizare" },
      { key: "projects.create", label: "Creare" },
      { key: "projects.edit", label: "Editare" },
      { key: "projects.delete", label: "Ștergere" },
    ],
  },
  {
    group: "Clienți",
    items: [
      { key: "clients.view", label: "Vizualizare" },
      { key: "clients.create", label: "Creare" },
      { key: "clients.edit", label: "Editare" },
      { key: "clients.delete", label: "Ștergere" },
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
    group: "Administrare",
    items: [
      { key: "dashboard.view", label: "Vizualizare dashboard" },
      { key: "reports.view", label: "Vizualizare rapoarte" },
      { key: "users.manage", label: "Gestionare utilizatori" },
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

/** Are userul permisiunea cerută? ADMIN sau "admin" => mereu true. */
export function can(user: PermissionSubject, key: PermissionKey): boolean {
  if (user.role === "ADMIN") return true;
  if (user.permissions.includes("admin")) return true;
  return user.permissions.includes(key);
}

export function canAny(user: PermissionSubject, keys: PermissionKey[]): boolean {
  return keys.some((k) => can(user, k));
}
