"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MlMap } from "maplibre-gl";
import { useMessages, useT } from "@/lib/i18n/context";
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM, MAP_STYLE_URL, boundsFor, slimMapStyle, setLocalMapWorker } from "@/lib/map-config";
import { cardHtml, navHtml } from "@/lib/map-popup";

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
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    let map: MlMap | undefined;
    let gone = false;

    import("maplibre-gl").then((ml) => {
      if (gone || !containerRef.current) return;
      setLocalMapWorker(ml);
      try {
        map = new ml.Map({
          container: containerRef.current,
          style: MAP_STYLE_URL,
          center: [lng, lat],
          zoom: 14,
          minZoom: MAP_MIN_ZOOM,
          maxZoom: MAP_MAX_ZOOM,
          maxBounds: boundsFor([{ lat, lng }]),
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

      const popup = new ml.Popup({ className: "mp-pop", offset: 28, maxWidth: "300px", focusAfterOpen: false }).setHTML(
        cardHtml({ title: address || t("Locație"), footerHtml: navHtml(lat, lng, t("Navighează")) }),
      );
      new ml.Marker({ color: "#2563eb" }).setLngLat([lng, lat]).setPopup(popup).addTo(map);
    });

    return () => {
      gone = true;
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, address]);

  if (failed) {
    return (
      <div className="grid h-40 place-items-center rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] text-center text-sm text-ink-soft">
        <p>{m.projects.map.unavailable}</p>
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
