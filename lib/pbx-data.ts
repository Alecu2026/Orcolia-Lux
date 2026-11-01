/**
 * Apelurile PBX și coada de apeluri către plătitori (pagina /pbx), ca tupluri compacte: cod partajat server / browser, fără dependențe de server
 * (vezi lib/services/pbx-data.ts și app/components/usePbxDataset.ts).
 *
 * Lista completă vine în browser o singură dată (apoi stă în IndexedDB), iar după aceea se aduc DOAR rândurile schimbate de la ultima sincronizare
 * („delta"): pagina nu mai retrimite zeci de mii de rânduri la fiecare reîmprospătare.
 */

export type PbxCallRow = {
  id: string;
  callId: string;
  direction: string | null;
  phone: string | null;
  phoneE164: string | null;
  diversion: string | null;
  pbxUser: string | null;
  ext: string | null;
  status: string | null;
  state: string | null;
  durationSec: number | null;
  waitSec: number | null;
  at: string;
  lastCmd: string | null;
  eventCount: number;
  clientId: string | null;
  clientName: string | null;
  /** Apelul are înregistrare (linkul în sine rămâne pe server: se ascultă prin /api/pbx/recording). */
  hasRecording: boolean;
  rating: number | null;
  groupName: string | null;
  lineName: string | null;
  note: string | null;
};

export type NotifyCallRow = {
  id: string;
  campaignId: string;
  clientId: string;
  clientName: string;
  phone: string;
  /** Mesajul de transmis, cu datele plătitorului. */
  text: string;
  /** Când a fost pus în coadă. */
  at: string;
  dialedAt: string | null;
  operator: string | null;
  callId: string | null;
  /** queued (în coadă) | dialing (apel pornit) | exported (în ZIP-ul pentru autoinformare) */
  status: string;
  note: string | null;
  userName: string;
  // din apelul PBX cu același callId (webhook-ul /api/pbx)
  pbxStatus: string | null;
  pbxState: string | null;
  durationSec: number | null;
  hasRecording: boolean;
  rating: number | null;
};

type S = string | null;
type N = number | null;
export type PbxTuple = [
  id: string, callId: string, dir: S, phone: S, e164: S, diversion: S, pbxUser: S, ext: S, status: S, state: S, dur: N, wait: N, atMs: number, lastCmd: S, events: number,
  clientId: S, clientName: S, rec: 0 | 1, rating: N, group: S, line: S, note: S, updatedMs: number,
];
export type NotifyTuple = [
  id: string, campaignId: string, clientId: string, clientName: string, phone: string, text: string, atMs: number, dialedMs: N, operator: S, callId: S, status: string, note: S,
  userName: string, pbxStatus: S, pbxState: S, dur: N, rec: 0 | 1, rating: N, updatedMs: number,
];

export type PbxKind = "calls" | "notify";
/** Lista completă (sau diferența față de un moment): `cursor` = momentul la care s-a citit (ms), `count` = câte rânduri există în baza de date, `reset` = prea multe schimbări, se cere lista completă. */
export type PbxPayload<T> = { v: 1; rows: T[]; cursor: number; count: number; reset?: boolean };

/** Până la atâtea rânduri (cele mai recent modificate) intră în lista completă; pagina primește doar `PBX_HEAD_ROWS`. */
export const PBX_DATASET_MAX = 50_000;
export const PBX_HEAD_ROWS = 150;
/** Peste atâtea rânduri schimbate de la ultima sincronizare nu se mai trimite diferența: browserul cere lista completă. */
export const PBX_DELTA_MAX = 3000;

export function decodeCall(t: PbxTuple): PbxCallRow {
  return {
    id: t[0], callId: t[1], direction: t[2], phone: t[3], phoneE164: t[4], diversion: t[5], pbxUser: t[6], ext: t[7], status: t[8], state: t[9], durationSec: t[10], waitSec: t[11],
    at: new Date(t[12]).toISOString(), lastCmd: t[13], eventCount: t[14], clientId: t[15], clientName: t[16], hasRecording: t[17] === 1, rating: t[18], groupName: t[19], lineName: t[20], note: t[21],
  };
}

export function decodeNotify(t: NotifyTuple): NotifyCallRow {
  return {
    id: t[0], campaignId: t[1], clientId: t[2], clientName: t[3], phone: t[4], text: t[5], at: new Date(t[6]).toISOString(), dialedAt: t[7] == null ? null : new Date(t[7]).toISOString(),
    operator: t[8], callId: t[9], status: t[10], note: t[11], userName: t[12], pbxStatus: t[13], pbxState: t[14], durationSec: t[15], hasRecording: t[16] === 1, rating: t[17],
  };
}
