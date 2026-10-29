// Șabloane de roluri / tipuri de utilizator (cod partajat server + browser): cele implicite din lib/permissions.ts (Cititor, Operator, Responsabil citiri, Doar vizualizare)
// pot fi modificate, iar administratorul poate crea altele (ex. Dispecer, Contabil, Administrator). Un șablon = nume + descriere + rol + permisiuni + ce sarcini vede.

import { ALL_PERMISSION_KEYS, PERMISSION_GROUPS, USER_TYPES, effectivePermissionKeys } from "./permissions";

export type RoleTemplate = {
  /** Cheia unui tip implicit („reader”, „operator”, …) sau id-ul unui șablon creat de administrator. */
  key: string;
  name: string;
  description: string;
  /** Rolul contului: Administrator = acces la tot (fără permisiuni individuale); Angajat = cu permisiunile de mai jos. */
  role: "ADMIN" | "STAFF";
  permissions: string[];
  /** Ce sarcini vede contul: toate / doar ale lui; "" = nu schimbă nimic la aplicare. */
  taskView: "" | "ALL" | "OWN";
  /** Tip implicit (nu se șterge, se poate reveni la valorile originale). */
  builtin: boolean;
  /** Tip implicit modificat de administrator. */
  customized: boolean;
};

export const ROLE_TEMPLATE_MAX = 50;
export const ROLE_TEMPLATE_MAX_NAME = 40;
export const ROLE_TEMPLATE_MAX_DESCRIPTION = 300;

/** Orice permisiune dintr-un grup (creare/editare/…) cere „Vizualizare” din același grup. */
export const VIEW_OF: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const g of PERMISSION_GROUPS) {
    const view = g.items.find((i) => i.key.endsWith(".view"));
    if (!view) continue;
    const prefix = view.key.split(".")[0];
    for (const i of g.items) if (i.key !== view.key && i.key.split(".")[0] === prefix) out[i.key] = view.key;
  }
  return out;
})();

/** Permisiuni valide, fără dubluri, cu „Vizualizare” adăugată acolo unde lipsește; „admin” (acces total) nu se dă prin șablon. */
export function cleanPermissions(keys: unknown): string[] {
  const set = new Set<string>();
  for (const k of Array.isArray(keys) ? keys : []) {
    if (typeof k === "string" && k !== "admin" && (ALL_PERMISSION_KEYS as string[]).includes(k)) {
      set.add(k);
      if (VIEW_OF[k]) set.add(VIEW_OF[k]);
    }
  }
  return [...set].sort();
}

export const isTaskView = (v: unknown): v is "" | "ALL" | "OWN" => v === "" || v === "ALL" || v === "OWN";

/** Rândul din baza de date (suprascriere a unui tip implicit sau șablon propriu). */
export type RoleTemplateRow = { key: string; name: string; description: string | null; role: string; permissions: string[]; taskView: string | null };

/** Tipurile implicite (cu eventualele modificări salvate) + șabloanele create de administrator, în ordine alfabetică. */
export function mergeRoleTemplates(rows: RoleTemplateRow[]): RoleTemplate[] {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const builtins = USER_TYPES.map((u): RoleTemplate => {
    const o = byKey.get(u.key);
    return o
      ? { key: u.key, name: o.name, description: o.description ?? "", role: o.role === "ADMIN" ? "ADMIN" : "STAFF", permissions: cleanPermissions(o.permissions), taskView: isTaskView(o.taskView ?? "") ? ((o.taskView ?? "") as RoleTemplate["taskView"]) : "", builtin: true, customized: true }
      : { key: u.key, name: u.label, description: u.description, role: "STAFF", permissions: cleanPermissions(u.permissions), taskView: "", builtin: true, customized: false };
  });
  const builtinKeys = new Set<string>(USER_TYPES.map((u) => u.key));
  const custom = rows
    .filter((r) => !builtinKeys.has(r.key))
    .map((r): RoleTemplate => ({ key: r.key, name: r.name, description: r.description ?? "", role: r.role === "ADMIN" ? "ADMIN" : "STAFF", permissions: cleanPermissions(r.permissions), taskView: isTaskView(r.taskView ?? "") ? ((r.taskView ?? "") as RoleTemplate["taskView"]) : "", builtin: false, customized: false }))
    .sort((a, b) => a.name.localeCompare(b.name, "ro"));
  return [...builtins, ...custom];
}

/**
 * Șablonul care se potrivește exact unui cont (același rol; la angajat — aceleași permisiuni efective). Administratorii se potrivesc cu un șablon de tip Administrator, dacă există.
 * Cu mai multe potriviri câștigă primul (cele implicite înaintea celor proprii).
 */
export function matchRoleTemplate(templates: RoleTemplate[], role: string, permissions: string[]): RoleTemplate | null {
  if (role === "ADMIN" || permissions.includes("admin")) return templates.find((t) => t.role === "ADMIN") ?? null;
  const have = new Set(effectivePermissionKeys(permissions));
  return templates.find((t) => t.role === "STAFF" && t.permissions.length === have.size && t.permissions.every((p) => have.has(p))) ?? null;
}
