// Elementele meniului principal (partajat server + browser): adresa, eticheta (cheie din messages.nav) și permisiunea necesară. Iconițele stau în AppShell.
// „audit.view” = doar super-administratorul. Folosit și pentru „Butoane rapide pe telefon” din Setări.

import type { Messages } from "./i18n";

export type NavMeta = { href: string; labelKey: keyof Messages["nav"]; perm?: string };

export const NAV_META: NavMeta[] = [
  { href: "/dashboard", labelKey: "dashboard", perm: "dashboard.view" },
  { href: "/tasks", labelKey: "tasks", perm: "tasks.view" },
  { href: "/tickets", labelKey: "tickets", perm: "tickets.view" },
  { href: "/appointments", labelKey: "appointments", perm: "appointments.view" },
  { href: "/projects", labelKey: "projects", perm: "projects.view" },
  { href: "/kanban", labelKey: "kanban", perm: "kanban.view" },
  { href: "/calendar", labelKey: "calendar", perm: "calendar.view" },
  { href: "/clients", labelKey: "clients", perm: "clients.view" },
  { href: "/platitori", labelKey: "payers", perm: "payers.view" },
  { href: "/notificari-platitori", labelKey: "payerNotify", perm: "payers.view" },
  { href: "/contoare", labelKey: "meters", perm: "payers.view" },
  { href: "/contoare/citiri", labelKey: "fieldReadings", perm: "meters.read" },
  { href: "/pbx", labelKey: "pbx", perm: "pbx.view" },
  { href: "/invoices", labelKey: "invoices", perm: "invoices.view" },
  { href: "/users", labelKey: "users", perm: "users.manage" },
  { href: "/team", labelKey: "team", perm: "teams.view" },
  { href: "/harta", labelKey: "map", perm: "map.view" },
  { href: "/admin/audit-logs", labelKey: "auditLogs", perm: "audit.view" },
  { href: "/admin/jurnal-notificari", labelKey: "deliveryLogs", perm: "audit.view" },
  { href: "/admin/rute-citiri", labelKey: "readingRoutes", perm: "meters.manage" },
  { href: "/telegram", labelKey: "telegram" },
  { href: "/settings", labelKey: "settings" },
];

/** Câte butoane încap în bara de jos de pe telefon. */
export const BOTTOM_NAV_MAX = 5;

/** Adresele alese de utilizator pentru bara de jos: doar cele care există în meniu, fără dubluri, maximum ${BOTTOM_NAV_MAX}. */
export function sanitizeBottomNav(raw: unknown): string[] {
  const valid = new Set(NAV_META.map((n) => n.href));
  const out: string[] = [];
  for (const h of Array.isArray(raw) ? raw : []) if (typeof h === "string" && valid.has(h) && !out.includes(h)) out.push(h);
  return out.slice(0, BOTTOM_NAV_MAX);
}
