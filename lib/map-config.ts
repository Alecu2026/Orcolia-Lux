// Harta: furnizorul de hartă (gratuit, fără cheie), zona permisă și straturile de stil pe care nu le afișăm (cod partajat, fără server-only).
//
// Se folosește MapLibre GL (bibliotecă liberă, același API ca Mapbox GL) cu plăci vectoriale OpenFreeMap (gratuit, fără cont și fără cheie API, folosibil comercial; date OpenStreetMap).
// Stilul „positron” e deschis și minimal: drumuri, ape, localități și nume de străzi — FĂRĂ restaurante, magazine și alte puncte de interes, deci harta rămâne curată și ușoară.

/** Stilul hărții. Implicit OpenFreeMap „positron” (fără puncte de interes); se poate schimba cu NEXT_PUBLIC_MAP_STYLE_URL (alt stil MapLibre / TileJSON, de ex. propriul server de plăci). */
export const MAP_STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/positron";

/** Centrul implicit (Cahul) și zoom-ul. */
export const MAP_DEFAULT_CENTER: [number, number] = [28.19, 45.9];

/** Zona în care se poate naviga: Republica Moldova + o marjă. Nu se încarcă plăci din afara ei. Se poate schimba cu NEXT_PUBLIC_MAP_BOUNDS = „vest,sud,est,nord”. */
export const MAP_BOUNDS: [[number, number], [number, number]] = (() => {
  const raw = process.env.NEXT_PUBLIC_MAP_BOUNDS;
  const p = raw ? raw.split(",").map(Number) : [];
  return p.length === 4 && p.every(Number.isFinite) ? [[p[0], p[1]], [p[2], p[3]]] : [[26.3, 45.2], [30.5, 48.7]];
})();

export const MAP_MIN_ZOOM = 6;
export const MAP_MAX_ZOOM = 19;

/**
 * Straturile din stil care nu ne interesează și se scot după încărcare (nu se mai randează): aeroporturi, scuturile numerelor de drum, granițe contestate, căi ferate, puncte de interes și transport în comun.
 * Rămân: fundal, ape, parcuri, clădiri, drumuri, numele străzilor, localitățile și apele (nume).
 */
export const MAP_HIDE_LAYERS = /^(aeroway|airport|highway-shield|road_shield|boundary_disputed|railway|poi|transit|housenumber)/i;

type Pt = { lat: number; lng: number };

/** Zona permisă extinsă ca să includă toate punctele date (un proiect sau un contor în afara zonei implicite rămâne accesibil). */
export function boundsFor(points: Pt[], pad = 0.05): [[number, number], [number, number]] {
  let [[w, s], [e, n]] = MAP_BOUNDS;
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    w = Math.min(w, p.lng - pad);
    e = Math.max(e, p.lng + pad);
    s = Math.min(s, p.lat - pad);
    n = Math.max(n, p.lat + pad);
  }
  return [[w, s], [e, n]];
}

/** Scoate din hartă straturile inutile (vezi MAP_HIDE_LAYERS). */
export function slimMapStyle(map: { getStyle: () => { layers?: { id: string }[] }; getLayer: (id: string) => unknown; removeLayer: (id: string) => void }): void {
  try {
    for (const l of map.getStyle().layers ?? []) if (MAP_HIDE_LAYERS.test(l.id) && map.getLayer(l.id)) map.removeLayer(l.id);
  } catch {
    /* un stil personalizat poate avea alte nume: rămâne cum e */
  }
}

/** Fontul textelor din cluster: același ca în stil (glifele vin odată cu stilul). */
export const MAP_FONT = ["Noto Sans Bold"];

/** Adresa lucrătorului MapLibre (copiat în public/ de scripts/copy-maplibre-worker.mjs): împachetat de webpack, și-ar pierde adresa și harta ar rămâne goală. Se apelează o dată, după import("maplibre-gl"). */
export function setLocalMapWorker(ml: { setWorkerUrl: (url: string) => void }): void {
  ml.setWorkerUrl(location.origin + "/maplibre-gl-worker.mjs");
}
