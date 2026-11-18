import "server-only";
import { can, type PermissionSubject } from "../permissions";
import { MANUAL } from "../manual/content";
import { filterManual, shotKeysOfSections, type ManualAccess } from "../manual/access";
import { canEditManual } from "../manual-editor";
import type { ManualSection } from "../manual/types";

/**
 * Manualul unui utilizator, după drepturile lui: paginile la care are acces + secțiunile generale. Același calcul pentru pagină, PDF și ruta pozelor, ca nimic din ce nu-i este permis să nu ajungă la el.
 * Accesul la manual îl dă dreptul „Manual de utilizare” (inclus în tipurile Cititor, Operator, Responsabil citiri, Doar vizualizare și la administratori); contul editor îl vede oricum, întreg.
 */

type U = PermissionSubject & { email: string; isSuperAdmin?: boolean };

/** Editorul vede mereu (și ciorna); ceilalți doar cu dreptul „Manual de utilizare” ȘI după ce manualul e publicat („Finalizat”). */
export const canViewManual = (u: U, published: boolean): boolean => canEditManual(u.email) || (published && can(u, "manual.view"));

export function manualAccessFor(u: U): ManualAccess {
  return { can: (k) => can(u, k), isSuper: u.isSuperAdmin === true, isEditor: canEditManual(u.email) };
}

export function manualFor(u: U): { sections: ManualSection[]; keys: Set<string> } {
  const sections = filterManual(MANUAL, manualAccessFor(u));
  return { sections, keys: shotKeysOfSections(sections) };
}

/** „pentru administrator” sau „pentru utilizator”, după cine citește (afișat în titlu și pe coperta PDF-ului). */
export const manualAudience = (u: U): "administrator" | "utilizator" => (can(u, "admin") ? "administrator" : "utilizator");
