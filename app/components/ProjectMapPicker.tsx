"use client";

import { useEffect, useRef, useState } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import { useMessages } from "@/lib/i18n/context";

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
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  const defaultLat = initialLat ?? 47.0245;
  const defaultLng = initialLng ?? 28.8322;
  const hasInitial = initialLat != null && initialLng != null;

  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    hasInitial ? { lat: initialLat!, lng: initialLng! } : null,
  );

  useEffect(() => {
    if (!token || !containerRef.current) return;

    let map: import("mapbox-gl").Map | undefined;
    let marker: import("mapbox-gl").Marker | undefined;

    import("mapbox-gl").then((mbgl) => {
      if (!containerRef.current) return;
      mbgl.default.accessToken = token;

      map = new mbgl.default.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [defaultLng, defaultLat],
        zoom: hasInitial ? 14 : 7,
      });

      marker = new mbgl.default.Marker({ color: "#2563eb", draggable: true })
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
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!token) {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <input name={latName} type="number" step="any" defaultValue={initialLat ?? ""} placeholder={m.projects.map.latPlaceholder} className={inputCls} />
          <input name={lngName} type="number" step="any" defaultValue={initialLng ?? ""} placeholder={m.projects.map.lngPlaceholder} className={inputCls} />
        </div>
        <p className="text-xs text-ink-soft">{m.projects.map.missingToken}</p>
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
