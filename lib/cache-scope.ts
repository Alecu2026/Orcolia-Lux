/**
 * Cache-urile din browser (IndexedDB: liste de plătitori, facturi, sarcini, notificări, contoare…) sunt ale CONTULUI curent, nu ale browserului:
 * numele bazei de date poartă id-ul utilizatorului (setat de <CacheScope> din layout). Altfel, la o simulare de login (sau la schimbarea contului în același browser)
 * ai fi văzut o clipă listele celuilalt cont, înainte să sosească cele ale contului curent.
 */
export const cacheScope = (): string => (typeof window === "undefined" ? "" : ((window as unknown as { __crmScope?: string }).__crmScope ?? ""));

export const idbName = (base: string): string => {
  const s = cacheScope();
  return s ? `${base}:${s}` : base;
};
