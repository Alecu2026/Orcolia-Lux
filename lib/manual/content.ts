import type { ManualSection } from "./types";
import { SECTION_A } from "./content-a";
import { SECTION_B } from "./content-b";
import { SECTION_C } from "./content-c";

/**
 * „Manual de utilizare pentru administrator”: toate secțiunile, în ordinea din pagină. Textele stau în content-a/b/c.ts; pozele nu sunt în cod (vezi lib/manual/types.ts).
 */
export const MANUAL: ManualSection[] = [...SECTION_A, ...SECTION_B, ...SECTION_C];

/** Toate locurile pentru poze (cheile), în ordinea paginii. */
export function shotList(sections: ManualSection[] = MANUAL): { key: string; where: string; caption: string; page: string; section: string }[] {
  const out: { key: string; where: string; caption: string; page: string; section: string }[] = [];
  for (const s of sections) for (const pg of s.pages) for (const b of pg.blocks) if (b.t === "shot") out.push({ ...b.shot, page: pg.title, section: s.title });
  return out;
}

/** Cheile valide pentru poze (o poză se acceptă doar pentru un loc care există în manual). */
export const SHOT_KEYS: ReadonlySet<string> = new Set(shotList().map((s) => s.key));
