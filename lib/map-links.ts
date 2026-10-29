// Locația unei programări: adresă + coordonate + linkul Google Maps, și linkurile de deschidere în Google Maps / Apple Maps / Waze (cod partajat server / browser).

export type Place = { lat?: number | null; lng?: number | null; address?: string | null; mapUrl?: string | null };

export const MAX_ADDRESS_LEN = 300;
export const MAX_MAP_URL_LEN = 500;

/** Serverele de hărți ale căror linkuri se acceptă (și se urmăresc la linkurile scurte, ex. maps.app.goo.gl). Nimic altceva nu se deschide de pe server. */
export const MAP_HOSTS = [
  "maps.app.goo.gl",
  "goo.gl",
  "google.com",
  "www.google.com",
  "maps.google.com",
  "google.md",
  "www.google.md",
  "maps.apple.com",
  "waze.com",
  "www.waze.com",
  "ul.waze.com",
];

export function isMapUrl(u: string): boolean {
  try {
    const x = new URL(u);
    return x.protocol === "https:" && MAP_HOSTS.includes(x.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Latitudine / longitudine valide, rotunjite la 6 zecimale (~10 cm); altfel null. */
export function normalizeLatLng(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const a = typeof lat === "number" ? lat : Number(lat);
  const b = typeof lng === "number" ? lng : Number(lng);
  if (lat === null || lat === "" || lng === null || lng === "" || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return { lat: Math.round(a * 1e6) / 1e6, lng: Math.round(b * 1e6) / 1e6 };
}

const dec = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/**
 * Coordonatele dintr-un text: „47.0245, 28.8322” (și cu virgulă zecimală: „47,0245; 28,8322”) sau dintr-un link de hartă
 * (`@lat,lng`, `!3dLAT!4dLNG`, `?q=lat,lng`, `ll=`, `query=`, `center=`, `destination=`). Nimic găsit ⇒ null.
 */
export function parseCoordinates(text: string): { lat: number; lng: number } | null {
  const raw = (text ?? "").trim();
  if (!raw) return null;
  // coordonate scrise direct
  const plain = raw.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)$/) ?? raw.match(/^(-?\d{1,2}(?:[.,]\d+)?)\s*[;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)$/);
  if (plain) {
    const r = normalizeLatLng(plain[1].replace(",", "."), plain[2].replace(",", "."));
    if (r) return r;
  }
  // linkuri (decodate de până la două ori: linkurile din pagina de consimțământ Google conțin linkul original codat)
  const variants = [raw, dec(raw), dec(dec(raw))];
  const num = "(-?\\d{1,3}\\.\\d+)";
  const pats = [
    new RegExp(`@${num},${num}`),
    new RegExp(`!3d${num}!4d${num}`),
    new RegExp(`[?&](?:q|ll|query|center|destination|daddr|saddr)=${num}(?:,|%2C)\\s*${num}`, "i"),
    new RegExp(`/maps/(?:place|search|dir)/[^@]*?${num},\\s*${num}`),
  ];
  for (const v of variants) {
    for (const re of pats) {
      const m = v.match(re);
      if (m) {
        const r = normalizeLatLng(m[1], m[2]);
        if (r) return r;
      }
    }
  }
  return null;
}

const enc = encodeURIComponent;
const coordsOf = (p: Place) => (p.lat != null && p.lng != null ? `${p.lat},${p.lng}` : null);
const addr = (p: Place) => (p.address ?? "").replace(/\s+/g, " ").trim();

/** Are locație (adresă, coordonate sau link)? */
export function hasPlace(p: Place): boolean {
  return coordsOf(p) != null || addr(p) !== "" || !!p.mapUrl;
}

/** Google Maps: linkul lipit de utilizator (locul exact, cu nume), altfel coordonatele, altfel căutarea după adresă. */
export function googleMapsUrl(p: Place): string | null {
  if (p.mapUrl && isMapUrl(p.mapUrl)) return p.mapUrl;
  const c = coordsOf(p);
  if (c) return `https://www.google.com/maps?q=${c}`;
  const a = addr(p);
  return a ? `https://www.google.com/maps/search/?api=1&query=${enc(a)}` : null;
}

/** Apple Maps (se deschide în aplicația Hărți pe iPhone / Mac). */
export function appleMapsUrl(p: Place): string | null {
  const c = coordsOf(p);
  const a = addr(p);
  if (c) return `https://maps.apple.com/?ll=${c}${a ? `&q=${enc(a)}` : ""}`;
  return a ? `https://maps.apple.com/?q=${enc(a)}` : null;
}

/** Waze: pornește navigarea spre locul respectiv. */
export function wazeUrl(p: Place): string | null {
  const c = coordsOf(p);
  if (c) return `https://waze.com/ul?ll=${c}&navigate=yes`;
  const a = addr(p);
  return a ? `https://waze.com/ul?q=${enc(a)}&navigate=yes` : null;
}

/** Textul scurt al locației pentru afișare: adresa, altfel coordonatele. */
export function placeLabel(p: Place): string {
  return addr(p) || (p.lat != null && p.lng != null ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : "");
}
