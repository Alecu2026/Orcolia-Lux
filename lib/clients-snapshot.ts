/**
 * Lista clienților de CRM (pagina /clients), ca tupluri compacte: cod partajat server / browser, fără dependențe de server (vezi lib/services/client-cache.ts).
 * Un rând = [id, nume, telefon, email, id Telegram, notițe, absențe, ultima programare (ms) | null].
 */
export type ClientRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  telegramChatId: string | null;
  notes: string | null;
  noShowCount: number;
  lastAppointmentAt: string | null;
};

export type ClientTuple = [id: string, name: string, phone: string | null, email: string | null, tg: string | null, notes: string | null, noShow: number, lastMs: number | null];

/** Până la atâția clienți, tot setul vine direct în pagină (ca până acum); peste, pagina primește doar primele rânduri, iar restul vine din /api/clients/snapshot. */
export const CLIENT_INLINE_MAX = 1500;
/** Câte rânduri (cele mai recente) intră în HTML când lista e mare. */
export const CLIENT_HEAD_ROWS = 60;

export type ClientPayload = { v: 1; rows: ClientTuple[] };

export function decodeClients(tuples: ClientTuple[]): ClientRow[] {
  const out: ClientRow[] = new Array(tuples.length);
  for (let i = 0; i < tuples.length; i++) {
    const t = tuples[i];
    out[i] = { id: t[0], name: t[1], phone: t[2], email: t[3], telegramChatId: t[4], notes: t[5], noShowCount: t[6], lastAppointmentAt: t[7] == null ? null : new Date(t[7]).toISOString() };
  }
  return out;
}
