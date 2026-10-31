"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MlMap } from "maplibre-gl";
import { useMessages, useT } from "@/lib/i18n/context";
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM, MAP_STYLE_URL, boundsFor, slimMapStyle, setLocalMapWorker } from "@/lib/map-config";

type Props = {
  initialLat?: number | null;
  initialLng?: number | null;
  latName?: string;
  lngName?: string;
};

const inputCls =
  "h-9 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand font-mono";
const btn =
  "tap inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-[var(--color-line)] px-3.5 text-sm font-medium hover:bg-brand-soft disabled:opacity-50";

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Alegerea locației pe hartă, gândită pentru telefon: pinul stă FIX în mijlocul hărții, iar harta se mișcă pe sub el (nu mai trebuie „prins” un pin mic cu degetul);
 * o atingere pe hartă mută pinul acolo; „Locația mea” folosește GPS-ul telefonului; „Mărește harta” o face aproape cât ecranul. Coordonatele salvate sunt cele din vârful pinului.
 */
export default function ProjectMapPicker({
  initialLat,
  initialLng,
  latName = "lat",
  lngName = "lng",
}: Props) {
  const m = useMessages();
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const setRef = useRef(false); // locația e setată: mișcarea hărții o actualizează
  const [failed, setFailed] = useState(false);
  const [big, setBig] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const defaultLat = initialLat ?? 47.0245;
  const defaultLng = initialLng ?? 28.8322;
  const hasInitial = initialLat != null && initialLng != null;

  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(hasInitial ? { lat: initialLat!, lng: initialLng! } : null);

  /** Locația = centrul hărții (vârful pinului). */
  const commit = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    setCoords({ lat: round6(c.lat), lng: round6(c.lng) });
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    let gone = false;
    let raf = 0;
    setRef.current = hasInitial;

    import("maplibre-gl").then((ml) => {
      if (gone || !containerRef.current) return;
      setLocalMapWorker(ml);
      let map: MlMap;
      try {
        map = new ml.Map({
          container: containerRef.current,
          style: MAP_STYLE_URL,
          center: [defaultLng, defaultLat],
          zoom: hasInitial ? 16 : 7,
          minZoom: MAP_MIN_ZOOM,
          maxZoom: MAP_MAX_ZOOM,
          maxBounds: boundsFor(hasInitial ? [{ lat: defaultLat, lng: defaultLng }] : []),
          attributionControl: { compact: true },
          dragRotate: false,
        });
      } catch {
        setFailed(true);
        return;
      }
      mapRef.current = map;
      map.touchZoomRotate.disableRotation();
      map.addControl(new ml.NavigationControl({ showCompass: false }), "bottom-right");
      map.on("load", () => slimMapStyle(map));
      // cât timp se mută harta, coordonatele din dreptul pinului se actualizează (cel mult o dată pe cadru)
      map.on("move", () => {
        if (!setRef.current || raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          commit();
        });
      });
      map.on("moveend", () => {
        if (setRef.current) commit();
      });
      // o atingere pe hartă mută pinul acolo (harta se centrează pe punctul atins)
      map.on("click", (e) => {
        setRef.current = true;
        map.easeTo({ center: e.lngLat, duration: 250 });
        if (!coordsRef.current) setCoords({ lat: round6(e.lngLat.lat), lng: round6(e.lngLat.lng) });
      });
    });

    return () => {
      gone = true;
      if (raf) cancelAnimationFrame(raf);
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const coordsRef = useRef(coords);
  useEffect(() => {
    coordsRef.current = coords;
  }, [coords]);

  // harta mărită / micșorată: se reface dimensiunea pânzei
  useEffect(() => {
    const id = requestAnimationFrame(() => mapRef.current?.resize());
    return () => cancelAnimationFrame(id);
  }, [big]);

  function setHere() {
    setRef.current = true;
    setMsg(null);
    commit();
  }

  function clear() {
    setRef.current = false;
    setCoords(null);
    setMsg(null);
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setMsg(t("Telefonul nu oferă locația."));
      return;
    }
    setBusy(true);
    setMsg(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        const map = mapRef.current;
        if (!map) return;
        setRef.current = true;
        map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 17, duration: 700 });
      },
      () => {
        setBusy(false);
        setMsg(t("Nu am putut lua locația (permite accesul la locație în browser)."));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  // Dacă harta nu se poate afișa (de ex. fără WebGL), coordonatele se pot introduce de mână.
  if (failed) {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <input name={latName} type="number" step="any" defaultValue={initialLat ?? ""} placeholder={m.projects.map.latPlaceholder} className={inputCls} />
          <input name={lngName} type="number" step="any" defaultValue={initialLng ?? ""} placeholder={m.projects.map.lngPlaceholder} className={inputCls} />
        </div>
        <p className="text-xs text-ink-soft">{m.projects.map.unavailable}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <div
          ref={containerRef}
          data-map-picker=""
          className={`w-full overflow-hidden rounded-xl border border-[var(--color-line)] ${big ? "h-[70dvh]" : "h-64"}`}
        />
        {/* pinul fix: vârful lui e exact în mijlocul hărții */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full" aria-hidden>
          <svg width="40" height="48" viewBox="0 0 40 48" className="drop-shadow-md" data-pin={coords ? "set" : "unset"}>
            <path d="M20 47C20 47 3 29.5 3 18a17 17 0 1 1 34 0c0 11.5-17 29-17 29z" fill={coords ? "#2563eb" : "#94a3b8"} stroke="#fff" strokeWidth="2" />
            <circle cx="20" cy="18" r="6" fill="#fff" />
          </svg>
        </div>
      </div>

      <p className="text-xs text-ink-soft">{coords ? t("Mută harta: pinul rămâne în mijloc și arată locația. Atinge un punct ca să muți pinul acolo.") : t("Mută harta până când pinul e pe locul potrivit, apoi apasă „Setează aici locația”.")}</p>

      <div className="flex flex-wrap gap-2">
        {!coords && (
          <button type="button" onClick={setHere} className={`${btn} border-brand bg-brand text-white hover:bg-brand-strong`}>
            📌 {t("Setează aici locația")}
          </button>
        )}
        <button type="button" onClick={useMyLocation} disabled={busy} className={btn}>
          📍 {t("Locația mea")}
        </button>
        <button type="button" onClick={() => setBig((b) => !b)} aria-pressed={big} className={btn}>
          {big ? `⤡ ${t("Micșorează harta")}` : `⤢ ${t("Mărește harta")}`}
        </button>
        {coords && (
          <button type="button" onClick={clear} className={`${btn} text-st-cancelled`}>
            ✕ {m.projects.map.deleteLocation}
          </button>
        )}
      </div>

      {msg && <p className="text-xs text-st-cancelled">{msg}</p>}
      <input type="hidden" name={latName} value={coords?.lat ?? ""} />
      <input type="hidden" name={lngName} value={coords?.lng ?? ""} />
      {coords && (
        <p className="text-xs text-ink-soft">
          ✓ {t("Locație setată")}: <b className="font-mono text-ink">{coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}</b>
        </p>
      )}
    </div>
  );
}
