// MapLibre GL 6: lucrătorul (worker) hărții trebuie servit ca fișier separat, de pe același domeniu.
// Împachetat de webpack, își pierde adresa proprie și harta rămâne goală („Worker failed to load”),
// de aceea îl copiem din node_modules în public/ (rulează la `npm install` și la `npm run build`; fișierul nu se commit-ează).
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs");
const dest = resolve(root, "public/maplibre-gl-worker.mjs");

if (!existsSync(src)) {
  console.warn("copy-maplibre-worker: maplibre-gl nu e instalat — se omite.");
  process.exit(0);
}
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log("copy-maplibre-worker: public/maplibre-gl-worker.mjs actualizat.");
