/**
 * Lista proiectelor (pagina /projects), ca tupluri compacte: cod partajat server / browser, fără dependențe de server (vezi lib/services/project-cache.ts).
 * Un rând = [id, nr., nume, descriere, status, client, responsabil, echipă, adresă, lat, lng]. Numărul de sarcini NU face parte din listă (se schimbă la fiecare sarcină nouă): vine separat, ca
 * hartă mică id → număr (`/api/projects/counts`), deci lista mare nu se descarcă din nou la fiecare sarcină creată.
 */
export type ProjectStatusKey = "ACTIVE" | "ON_HOLD" | "DONE" | "ARCHIVED";

export type ProjectItem = {
  id: string;
  seq: number | null;
  name: string;
  description: string | null;
  status: ProjectStatusKey;
  clientId: string | null;
  assigneeId: string | null;
  teamId: string | null;
  taskCount: number;
  address: string | null;
  lat: number | null;
  lng: number | null;
};

export type ProjectTuple = [
  id: string, seq: number | null, name: string, description: string | null, status: ProjectStatusKey, clientId: string | null, assigneeId: string | null, teamId: string | null,
  address: string | null, lat: number | null, lng: number | null,
];

/** Până la atâtea proiecte, tot setul vine direct în pagină; peste, pagina primește doar primele rânduri, iar restul vine din /api/projects/snapshot. */
export const PROJECT_INLINE_MAX = 1500;
/** Câte proiecte (cele mai recente) intră în HTML când lista e mare. */
export const PROJECT_HEAD_ROWS = 60;
/** Cel mult atâtea proiecte în lista completă. */
export const PROJECT_DATASET_MAX = 50_000;

export type ProjectPayload = { v: 1; rows: ProjectTuple[] };
export type ProjectCountsPayload = { v: 1; counts: [id: string, n: number][] };

export function decodeProjects(tuples: ProjectTuple[], counts?: Map<string, number>): ProjectItem[] {
  const out: ProjectItem[] = new Array(tuples.length);
  for (let i = 0; i < tuples.length; i++) {
    const t = tuples[i];
    out[i] = { id: t[0], seq: t[1], name: t[2], description: t[3], status: t[4], clientId: t[5], assigneeId: t[6], teamId: t[7], taskCount: counts?.get(t[0]) ?? 0, address: t[8], lat: t[9], lng: t[10] };
  }
  return out;
}

export function withCounts(rows: ProjectItem[], counts: Map<string, number>): ProjectItem[] {
  return rows.map((r) => {
    const n = counts.get(r.id) ?? 0;
    return n === r.taskCount ? r : { ...r, taskCount: n };
  });
}
