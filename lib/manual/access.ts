import type { Block, ManualSection, PermReq } from "./types";
import type { PermissionKey } from "../permissions";

/**
 * Ce din manual vede un utilizator: doar paginile (și blocurile) la care are drepturi, plus secțiunile generale (fără condiție). Se calculează PE SERVER (pagina, PDF-ul și rută pozelor),
 * deci conținutul pentru care nu are drepturi nici nu ajunge în browserul lui. Contul „editor” (cel care pune pozele) vede tot.
 */
export type ManualAccess = {
  can: (key: PermissionKey) => boolean;
  isSuper: boolean;
  /** contul care pune pozele: vede tot manualul, ca să poată pune poze peste tot */
  isEditor: boolean;
};

export function allows(req: PermReq | undefined, a: ManualAccess): boolean {
  if (a.isEditor || !req) return true;
  if (Array.isArray(req)) return req.some((k) => a.can(k));
  if (req === "super") return a.isSuper;
  if (req === "editor") return false; // doar editorul (tratat mai sus)
  return a.can(req);
}

/** Manualul rămas după aplicarea drepturilor: secțiunile fără nicio pagină vizibilă dispar, la fel și paginile fără niciun bloc. */
export function filterManual(sections: ManualSection[], a: ManualAccess): ManualSection[] {
  const out: ManualSection[] = [];
  for (const s of sections) {
    const pages = s.pages
      .filter((pg) => allows(pg.perm, a))
      .map((pg) => ({ ...pg, blocks: pg.blocks.filter((b: Block) => allows(b.perm, a)) }))
      .filter((pg) => pg.blocks.length > 0);
    if (pages.length > 0) out.push({ ...s, pages });
  }
  return out;
}

/**
 * Manualul pentru un CITITOR: locurile pentru poze FĂRĂ poză dispar cu totul (instrucțiunile „de unde faci poza” nu ajung la el); rămân doar pozele puse. Editorul vede și cadrele goale.
 * Paginile rămân (au și text). Pozele păstrate își pierd și textul „unde faci poza” (nu ajunge în browserul cititorului).
 */
export function withoutEmptyShots(sections: ManualSection[], have: ReadonlySet<string>): ManualSection[] {
  return sections.map((s) => ({
    ...s,
    pages: s.pages
      // pozele rămase nu mai poartă instrucțiunea „de unde faci poza” (cititorul vede doar poza și legenda ei)
      .map((pg) => ({
        ...pg,
        blocks: pg.blocks.filter((b: Block) => b.t !== "shot" || have.has(b.shot.key)).map((b: Block): Block => (b.t === "shot" ? { ...b, shot: { ...b.shot, where: "" } } : b)),
      }))
      .filter((pg) => pg.blocks.length > 0),
  })).filter((s) => s.pages.length > 0);
}

/** Cheile locurilor pentru poze din manualul dat. */
export function shotKeysOfSections(sections: ManualSection[]): Set<string> {
  const keys = new Set<string>();
  for (const s of sections) for (const pg of s.pages) for (const b of pg.blocks) if (b.t === "shot") keys.add(b.shot.key);
  return keys;
}
