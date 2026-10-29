"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MlMap, Marker as MlMarker } from "maplibre-gl";
import { useMessages } from "@/lib/i18n/context";
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM, MAP_STYLE_URL, boundsFor, slimMapStyle, setLocalMapWorker } from "@/lib/map-config";

type Props = {
  initialLat?: number | null;
  initialLng?: number | null;
  latName?: string;
  lngName?: string;
};

const inputCls =
  "h-9 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand font-mono";

export default function ProjectMapPicker({
  initialLat,
  initialLng,
  latName = "lat",
  lngName = "lng",
}: Props) {
  const m = useMessages();
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  const defaultLat = initialLat ?? 47.0245;
  const defaultLng = initialLng ?? 28.8322;
  const hasInitial = initialLat != null && initialLng != null;

  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    hasInitial ? { lat: initialLat!, lng: initialLng! } : null,
  );

  useEffect(() => {
    if (!containerRef.current) return;

    let map: MlMap | undefined;
    let marker: MlMarker | undefined;
    let gone = false;

    import("maplibre-gl").then((ml) => {
      if (gone || !containerRef.current) return;
      setLocalMapWorker(ml);

      try {
        map = new ml.Map({
          container: containerRef.current,
          style: MAP_STYLE_URL,
          center: [defaultLng, defaultLat],
          zoom: hasInitial ? 14 : 7,
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
      map.touchZoomRotate.disableRotation();
      map.addControl(new ml.NavigationControl({ showCompass: false }), "bottom-right");
      map.on("load", () => map && slimMapStyle(map));

      marker = new ml.Marker({ color: "#2563eb", draggable: true })
        .setLngLat([defaultLng, defaultLat])
        .addTo(map);

      if (hasInitial) {
        setCoords({ lat: defaultLat, lng: defaultLng });
      }

      function updateCoords() {
        if (!marker) return;
        const { lat, lng } = marker.getLngLat();
        const rounded = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
        setCoords(rounded);
      }

      marker.on("dragend", updateCoords);

      map.on("click", (e) => {
        if (!marker) return;
        marker.setLngLat(e.lngLat);
        const { lat, lng } = e.lngLat;
        const rounded = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
        setCoords(rounded);
      });
    });

    return () => {
      gone = true;
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      <div
        ref={containerRef}
        className="h-56 w-full overflow-hidden rounded-xl border border-[var(--color-line)]"
      />
      <p className="text-xs text-ink-soft">
        {m.projects.map.pickerHint}
      </p>
      <input type="hidden" name={latName} value={coords?.lat ?? ""} />
      <input type="hidden" name={lngName} value={coords?.lng ?? ""} />
      <div className="grid grid-cols-2 gap-2">
        <input
          type="text"
          value={coords ? coords.lat.toFixed(6) : ""}
          placeholder={m.projects.map.latPlaceholder}
          className={inputCls}
          readOnly
        />
        <input
          type="text"
          value={coords ? coords.lng.toFixed(6) : ""}
          placeholder={m.projects.map.lngPlaceholder}
          className={inputCls}
          readOnly
        />
      </div>
      {coords && (
        <button
          type="button"
          onClick={() => setCoords(null)}
          className="text-xs text-ink-soft hover:text-st-cancelled"
        >
          {m.projects.map.deleteLocation}
        </button>
      )}
    </div>
  );
}
