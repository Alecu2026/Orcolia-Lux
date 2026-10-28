// Filtrele „Sector” și „Localitate” cu alegere multiplă, la Plătitori, Notificări plătitori și Contoare (cod partajat server / browser).
//
// Sectorul unui abonat = „Участок” din 1C (dacă e completat), altfel sectorul din ultima factură (valoarea păstrată din import: „1sc”, „5sp”, „Agenti economici 1” …).
// Cele două valori generale („Sector privat” / „Sector comunal”) rămân la filtrul vechi „Toate sectoarele”.

/** Separatorul valorilor în adresă / în filtre („1sc|5sp”): o virgulă ar putea apărea chiar în numele unui sector. */
export const SECTOR_SEP = "|";
const MAX_VALUES = 60;
const MAX_LEN = 80;

const GENERIC = new Set(["Sector privat", "Sector comunal"]);

/** Sectorul pentru filtrul multiplu: „Участок” din 1C, altfel sectorul din factură (fără cele două valori generale). */
export function effectiveSector(uch: string | null | undefined, invoiceSector: string | null | undefined): string | null {
  const u = uch?.trim();
  if (u) return u;
  const s = invoiceSector?.trim();
  return s && !GENERIC.has(s) ? s : null;
}

/** Localitatea dintr-o adresă „or.Cahul, str. Independenței, nr. 14”: primul segment. */
export const addressLocality = (address: string | null | undefined): string => (address ? address.split(",")[0].trim() : "");

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

/** Mulțimea valorilor alese, sau null dacă filtrul nu e activ. */
export function parseSectorFilter(v: string): Set<string> | null {
  const s = cleanSectorList(v);
  return s ? new Set(s.split(SECTOR_SEP)) : null;
}

/** Valorile distincte (cu numărul de rânduri) în ordine naturală („2sc” înaintea lui „10sc”). */
export function distinctBy<T>(rows: readonly T[], pick: (r: T) => string | null | undefined): { value: string; count: number }[] {
  const c = new Map<string, number>();
  for (const r of rows) {
    const v = pick(r);
    if (v) c.set(v, (c.get(v) ?? 0) + 1);
  }
  const coll = new Intl.Collator("ro", { numeric: true });
  return [...c].map(([value, count]) => ({ value, count })).sort((a, b) => coll.compare(a.value, b.value));
}

export const distinctSectors = (rows: readonly { uch: string | null }[]) => distinctBy(rows, (r) => r.uch);
