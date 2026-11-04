/**
 * Secțiile: nivelul de deasupra echipelor (vezi modelul Section). Partajat între server și browser.
 * Secția unei cereri / sarcini se completează automat din cine se ocupă de ea: întâi din echipele atribuite (secția echipei), apoi din persoanele atribuite (secția persoanei).
 */
export type SectionOpt = { id: string; name: string };

/** Secția dedusă din echipele și persoanele atribuite (prima găsită, în ordinea alegerii); null dacă niciuna nu are secție. */
export function deriveSectionId(
  teamIds: string[],
  assigneeIds: string[],
  teamSection: Record<string, string | null | undefined>,
  userSection: Record<string, string | null | undefined>,
): string | null {
  for (const id of teamIds) if (teamSection[id]) return teamSection[id]!;
  for (const id of assigneeIds) if (userSection[id]) return userSection[id]!;
  return null;
}
