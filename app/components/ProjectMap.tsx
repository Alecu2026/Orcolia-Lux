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

      const marker = new mbgl.default.Marker({ color: "#2563eb" })
        .setLngLat([lng, lat])
        .addTo(map);

      if (address) {
        marker
          .setPopup(new mbgl.default.Popup({ offset: 28 }).setText(address))
          .togglePopup();
      }
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
