import "server-only";
import { DEMO } from "../demo";
import { getFieldList } from "./meter-readings";
import { checkConsum, fieldConsum, FAR_METERS } from "../meter-readings";
import { prepareRoutes, routeOf } from "../meter-routes";
import type { MeterPinsResponse, MeterPinTuple } from "../map-meters";

/**
 * Contoarele cu locație, pentru hartă: doar cele care au coordonate (locația salvată a contorului sau GPS-ul unei citiri), din aceeași listă ca „Citiri teren”
 * (nimic în plus de citit din baza de date). Fiecare punct are starea lunii (citit / necitit / neregulă), ruta, sectorul și, dacă e cazul, avertismentul de verificare.
 */
let memo: { at: number; value: MeterPinsResponse } | null = null;
const TTL_MS = 20_000;

export async function getMeterPins(): Promise<MeterPinsResponse> {
  if (memo && Date.now() - memo.at < TTL_MS) return memo.value;
  if (DEMO) return { period: "", pins: [], routes: [], total: 0 };
  const list = await getFieldList();
  const prepared = prepareRoutes(list.routes);
  const pins: MeterPinTuple[] = [];
  for (const t of list.rows) {
    const lat = t[12];
    const lng = t[13];
    if (lat == null || lng == null) continue;
    const consum = fieldConsum(t[6], t[4]);
    const dist = t[10];
    const chk = checkConsum(consum, t[19]);
    const suspect = consum != null && consum < 0 ? 1 : chk?.kind === "high" ? 2 : dist != null && dist > FAR_METERS ? 3 : chk?.kind === "low" ? 4 : 0;
    pins.push([t[0], t[1], t[2], t[3], lat, lng, t[15], t[6], t[7], t[16], t[17], routeOf({ sector: t[16], address: t[3] }, prepared), t[9], t[18] === 1 ? 1 : 0, suspect]);
  }
  const value: MeterPinsResponse = { period: list.period, pins, routes: list.routes.map((r) => ({ id: r.id, name: r.name })), total: list.rows.length };
  memo = { at: Date.now(), value };
  return value;
}
