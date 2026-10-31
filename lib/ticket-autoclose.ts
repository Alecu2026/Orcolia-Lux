// Închiderea automată a cererilor din email (fără răspuns de la client după răspunsul operatorului): limitele și textele în funcție de numărul de ore setat (cod partajat server / browser).

export const AUTOCLOSE_DEFAULT_HOURS = 48;
export const AUTOCLOSE_MIN_HOURS = 1;
export const AUTOCLOSE_MAX_HOURS = 24 * 90;

/** Numărul de ore valid (întreg, în limite) sau null. */
export function cleanAutoCloseHours(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < AUTOCLOSE_MIN_HOURS || n > AUTOCLOSE_MAX_HOURS) return null;
  return n;
}

/** „1 oră”, „5 ore”, „48 de ore”, „1 zi”, „2 zile”, „21 de zile”: durata în română, cu acordul corect (se închide pe zile întregi când se poate). */
export function roSpan(hours: number): string {
  if (hours >= 24 && hours % 24 === 0) {
    const d = hours / 24;
    return d === 1 ? "1 zi" : d % 100 >= 1 && d % 100 < 20 ? `${d} zile` : `${d} de zile`;
  }
  return hours === 1 ? "1 oră" : hours % 100 >= 1 && hours % 100 < 20 ? `${hours} ore` : `${hours} de ore`;
}

/** „în ultima oră” / „în ultima zi” / „în ultimele 48 de ore”: complementul pentru textul „nu am primit niciun răspuns …”. */
export function roLast(hours: number): string {
  if (hours === 1) return "ultima oră";
  if (hours === 24) return "ultima zi";
  return `ultimele ${roSpan(hours)}`;
}
