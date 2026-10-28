// Filtrul „Sector” (sectorul din 1C, „Участок”): mai multe sectoare deodată, la Plătitori, Notificări plătitori și Contoare (cod partajat server / browser).

/** Separatorul valorilor în adresă / în filtre („Sector 1|Sector 3”): o virgulă ar putea apărea chiar în numele unui sector. */
export const SECTOR_SEP = "|";
const MAX_VALUES = 60;
const MAX_LEN = 80;

/** Normalizează valoarea filtrului (din adresă, localStorage, corp de cerere): valori unice, fără spații în plus, plafonate. */
export function cleanSectorList(v: unknown): string {
  if (typeof v !== "string") return "";
  const seen = new Set<string>();
  for (const part of v.split(SECTOR_SEP)) {
    const s = part.trim().replace(/\s+/g, " ").slice(0, MAX_LEN);
    if (s) seen.add(s);
    if (seen.size >= MAX_VALUES) break;
  }
  return [...seen].join(SECTOR_SEP);
}

/** Mulțimea sectoarelor alese, sau null dacă filtrul nu e activ. */
export function parseSectorFilter(v: string): Set<string> | null {
  const s = cleanSectorList(v);
  return s ? new Set(s.split(SECTOR_SEP)) : null;
}

/** Sectoarele distincte din date, cu numărul de rânduri (în ordine naturală: „Sector 2” înaintea lui „Sector 10”). */
export function distinctSectors(rows: readonly { uch: string | null }[]): { value: string; count: number }[] {
  const c = new Map<string, number>();
  for (const r of rows) if (r.uch) c.set(r.uch, (c.get(r.uch) ?? 0) + 1);
  const coll = new Intl.Collator("ro", { numeric: true });
  return [...c].map(([value, count]) => ({ value, count })).sort((a, b) => coll.compare(a.value, b.value));
}
