// Contoarele pe hartă: forma compactă a unui punct, starea (citit / necitit / neregulă) și filtrele (cod partajat server / browser).

/** [id, contor, abonat, adresă, lat, lng, precizie (m), index citit luna aceasta, momentul citirii (ms), sector, neregulă, id rută, cine a citit, portal (0/1), suspect (0 nimic, 1 mai mic, 2 prea mare, 3 departe, 4 prea mic față de medie)] */
export type MeterPinTuple = [string, string, string, string | null, number, number, number | null, number | null, number | null, string | null, string | null, string | null, string | null, 0 | 1, 0 | 1 | 2 | 3 | 4];

export type MeterPinsResponse = {
  /** luna curentă „YYYY-MM” */
  period: string;
  pins: MeterPinTuple[];
  routes: { id: string; name: string }[];
  /** contoarele active în total (ca să se vadă câte nu au încă locație) */
  total: number;
};

export type MeterPin = {
  id: string;
  contor: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  acc: number | null;
  value: number | null;
  readAt: number | null;
  sector: string | null;
  issue: string | null;
  routeId: string | null;
  by: string | null;
  portal: boolean;
  suspect: 0 | 1 | 2 | 3 | 4;
  /** stare pentru culoare: neregulă (roșu) / citit luna aceasta (verde) / necitit */
  st: "issue" | "read" | "unread";
  locality: string;
  _h: string;
};

/** Precizie peste care locația unui contor e „nesigură”. */
export const PIN_FUZZY_M = 100;
/** Precizie sub care locația e „precisă”. */
export const PIN_PRECISE_M = 30;

const SERIOUS = new Set(["DEFECT", "REVERSE", "FRAUD", "LEAK"]);
export const isSeriousIssue = (k: string | null) => !!k && SERIOUS.has(k);

export function decodePins(t: MeterPinTuple[]): MeterPin[] {
  return t.map((x) => ({
    id: x[0],
    contor: x[1],
    name: x[2],
    address: x[3],
    lat: x[4],
    lng: x[5],
    acc: x[6],
    value: x[7],
    readAt: x[8],
    sector: x[9],
    issue: x[10],
    routeId: x[11],
    by: x[12],
    portal: x[13] === 1,
    suspect: x[14],
    st: x[10] ? "issue" : x[7] != null ? "read" : "unread",
    locality: x[3] ? x[3].split(",")[0].trim() : "",
    _h: `${x[1]}\n${x[2]}\n${x[3] ?? ""}`.toLowerCase(),
  }));
}

export type MeterMapFilters = {
  q: string;
  /** citire luna aceasta */
  read: "" | "read" | "unread";
  /** neregulă */
  issue: "" | "any" | "serious" | "none";
  sector: string;
  locality: string;
  /** id rută, „none” = fără rută */
  route: string;
  by: string;
  source: "" | "portal" | "field";
  /** precizia locației */
  accuracy: "" | "precise" | "fuzzy";
  suspect: "" | "any" | "lower" | "high" | "low" | "far";
};

export const EMPTY_METER_FILTERS: MeterMapFilters = { q: "", read: "", issue: "", sector: "", locality: "", route: "", by: "", source: "", accuracy: "", suspect: "" };

export const countMeterFilters = (f: MeterMapFilters): number =>
  (f.q ? 1 : 0) + (f.read ? 1 : 0) + (f.issue ? 1 : 0) + (f.sector ? 1 : 0) + (f.locality ? 1 : 0) + (f.route ? 1 : 0) + (f.by ? 1 : 0) + (f.source ? 1 : 0) + (f.accuracy ? 1 : 0) + (f.suspect ? 1 : 0);

export function filterPins(pins: MeterPin[], f: MeterMapFilters): MeterPin[] {
  const tokens = f.q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5);
  return pins.filter((p) => {
    if (f.read === "read" ? p.value == null : f.read === "unread" ? p.value != null : false) return false;
    if (f.issue === "any" ? !p.issue : f.issue === "serious" ? !isSeriousIssue(p.issue) : f.issue === "none" ? !!p.issue : false) return false;
    if (f.sector && p.sector !== f.sector) return false;
    if (f.locality && p.locality !== f.locality) return false;
    if (f.route === "none" ? p.routeId : f.route ? p.routeId !== f.route : false) return false;
    if (f.by && p.by !== f.by) return false;
    if (f.source === "portal" ? !(p.value != null && p.portal) : f.source === "field" ? !(p.value != null && !p.portal) : false) return false;
    if (f.accuracy === "precise" ? !(p.acc != null && p.acc <= PIN_PRECISE_M) : f.accuracy === "fuzzy" ? !(p.acc == null || p.acc > PIN_FUZZY_M) : false) return false;
    if (f.suspect === "any" ? !p.suspect : f.suspect === "lower" ? p.suspect !== 1 : f.suspect === "high" ? p.suspect !== 2 : f.suspect === "far" ? p.suspect !== 3 : f.suspect === "low" ? p.suspect !== 4 : false) return false;
    for (const tk of tokens) if (!p._h.includes(tk)) return false;
    return true;
  });
}

export const PIN_COLOR: Record<MeterPin["st"], string> = { issue: "#dc2626", read: "#16a34a", unread: "#f59e0b" };
