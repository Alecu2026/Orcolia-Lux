// Conturile din portalul clienților (Setări → Conturi portal clienți): tuplul compact din snapshot și decodarea lui (cod partajat server / browser).

export type PortalAccountRow = {
  id: string;
  name: string;
  /** Contul personal (meterSeries), dacă are. */
  account: string | null;
  contract: string | null;
  email: string | null;
  activated: boolean;
  activatedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
};

/** [id, nume, cont personal, contract, email, activat (0/1), activat la (ms), ultima logare (ms), creat la (ms)] */
export type AccountTuple = [string, string, string | null, string | null, string | null, 0 | 1, number | null, number | null, number];

const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());

export function decodeAccount(t: AccountTuple): PortalAccountRow {
  return { id: t[0], name: t[1], account: t[2], contract: t[3], email: t[4], activated: t[5] === 1, activatedAt: iso(t[6]), lastLoginAt: iso(t[7]), createdAt: new Date(t[8]).toISOString() };
}
