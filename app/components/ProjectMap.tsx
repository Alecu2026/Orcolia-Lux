"use client";

import { useEffect, useRef } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import { useMessages } from "@/lib/i18n/context";

export default function ProjectMap({
  lat,
  lng,
  address,
}: {
  lat: number;
  lng: number;
  address?: string | null;
}) {
  const m = useMessages();
  const containerRef = useRef<HTMLDivElement>(null);

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  useEffect(() => {
    if (!token || !containerRef.current) return;

    let map: import("mapbox-gl").Map | undefined;

    import("mapbox-gl").then((mbgl) => {
      if (!containerRef.current) return;
      mbgl.default.accessToken = token;
      map = new mbgl.default.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [lng, lat],
        zoom: 14,
      });

      const navHtml = `
        <div style="font-family:system-ui,sans-serif;padding:2px 0;min-width:180px">
          ${address ? `<p style="font-size:13px;font-weight:600;margin:0 0 8px">${address}</p>` : ""}
          <div style="display:flex;flex-direction:column;gap:5px">
            <a href="https://waze.com/ul?ll=${lat},${lng}&navigate=yes" target="_blank" rel="noopener noreferrer"
              style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#2563eb;text-decoration:none">
              🚗 Waze
            </a>
            <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener noreferrer"
              style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#2563eb;text-decoration:none">
              🗺️ Google Maps
            </a>
            <a href="https://maps.apple.com/?ll=${lat},${lng}" target="_blank" rel="noopener noreferrer"
              style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#2563eb;text-decoration:none">
              🍎 Apple Maps
            </a>
          </div>
        </div>
      `;

      const marker = new mbgl.default.Marker({ color: "#2563eb" })
        .setLngLat([lng, lat])
        .setPopup(new mbgl.default.Popup({ offset: 28 }).setHTML(navHtml))
        .addTo(map);

      marker.togglePopup();
    });

    return () => {
      map?.remove();
    };
  }, [lat, lng, address]);

  if (!token) {
    return (
      <div className="grid h-40 place-items-center rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] text-center text-sm text-ink-soft">
        <p>{m.projects.map.missingToken}</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-64 w-full overflow-hidden rounded-xl border border-[var(--color-line)]"
    />
  );
}
