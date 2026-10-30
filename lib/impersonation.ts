// Simulare de login (partajat server + browser): cine are voie să intre în contul cui, cât ține simularea și cum arată timpul rămas.
//
// Reguli (cine e „subaltern”):
//  • doar cu permisiunea „Simulare de login” (administratorii o au implicit);
//  • nu în propriul cont, nu într-un cont dezactivat;
//  • super-administratorul poate intra în orice cont activ;
//  • ceilalți NU pot intra în conturi de administrator / super-administrator, iar un cont fără drepturi de administrator se poate simula
//    doar dacă NU are nicio permisiune pe care tu n-o ai (altfel ai obține, prin simulare, drepturi pe care nu le ai);
//  • la fel pentru vizibilitatea sarcinilor: dacă ție ți se văd doar anumite echipe / persoane, contul simulat nu poate vedea mai mult decât tine;
//  • în timpul unei simulări nu se poate porni alta.

import { can, effectivePermissionKeys } from "./permissions";

/** Cât ține o simulare (fix, fără prelungire). */
export const IMPERSONATION_HOURS = 6;
export const IMPERSONATION_TTL_MS = IMPERSONATION_HOURS * 60 * 60 * 1000;

export type ImpersonationInfo = { byId: string; byName: string; expiresAt: number };

export type ImpersonationSubject = {
  id: string;
  role: string;
  permissions: string[];
  isSuperAdmin?: boolean;
  isActive?: boolean;
  /** vizibilitatea sarcinilor (ALL / RESTRICTED + echipele și persoanele vizibile) — obligatorie, ca să nu se uite la apelant */
  taskViewScope: string;
  taskViewTeamIds: string[];
  taskViewMemberIds: string[];
};
type Subject = ImpersonationSubject;

const adminLevel = (u: Subject) => u.role === "ADMIN" || u.permissions.includes("admin");
const asPerm = (u: Pick<Subject, "role" | "permissions">) => ({ role: (u.role === "ADMIN" ? "ADMIN" : "STAFF") as "ADMIN" | "STAFF", permissions: u.permissions });

export type CanResult = { ok: true } | { ok: false; reason: string };

/** Are voie `actor` să intre în contul utilizatorului `target`? */
export function canImpersonateUser(actor: Subject, target: Subject): CanResult {
  if (!can(asPerm(actor), "users.impersonate")) return { ok: false, reason: "Nu ai permisiunea de simulare de login." };
  if (target.id === actor.id) return { ok: false, reason: "Nu poți intra în propriul cont." };
  if (target.isActive === false) return { ok: false, reason: "Contul este dezactivat." };
  if (actor.isSuperAdmin) return { ok: true };
  if (target.isSuperAdmin || adminLevel(target)) return { ok: false, reason: "Doar un super-administrator poate intra într-un cont de administrator." };
  // vizibilitatea sarcinilor: contul simulat nu poate vedea mai mult decât ai voie tu
  if (actor.taskViewScope === "RESTRICTED") {
    const teams = new Set(actor.taskViewTeamIds);
    const members = new Set([...actor.taskViewMemberIds, actor.id]);
    if (target.taskViewScope !== "RESTRICTED" || target.taskViewTeamIds.some((t) => !teams.has(t)) || target.taskViewMemberIds.some((m) => !members.has(m))) {
      return { ok: false, reason: "Contul vede mai multe sarcini decât tine (poți intra doar în conturile subordonate)." };
    }
  }
  if (adminLevel(actor)) return { ok: true };
  const mine = new Set(effectivePermissionKeys(actor.permissions));
  if (effectivePermissionKeys(target.permissions).some((k) => !mine.has(k))) {
    return { ok: false, reason: "Contul are permisiuni pe care tu nu le ai (poți intra doar în conturile subordonate)." };
  }
  return { ok: true };
}

/** Intrarea într-un cont de portal: permisiunea de simulare + acces la plătitori / clienți (altfel n-ar avea cum să-i vadă). */
export function canImpersonatePortal(actor: Pick<Subject, "id" | "role" | "permissions">): boolean {
  const a = asPerm(actor);
  return can(a, "users.impersonate") && (can(a, "payers.view") || can(a, "clients.view"));
}

/** „5 h 12 min” / „48 min” / „sub 1 min”. */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return "0 min";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "< 1 min";
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} h ${String(min % 60).padStart(2, "0")} min` : `${min} min`;
}
