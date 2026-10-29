"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import { useMessages } from "@/lib/i18n/context";
import { useT } from "@/lib/i18n/context";
import { EMPTY_METER_FILTERS, PIN_COLOR, PIN_FUZZY_M, filterPins, type MeterMapFilters, type MeterPin } from "@/lib/map-meters";
import MeterMapPanel from "./MeterMapPanel";
import { ISSUE_LABELS, isIssueKind } from "@/lib/meter-issues";
import { useMeterPins } from "./useMeterPins";

type ProjectPin = {
  id: string;
  seq: number | null;
  name: string;
  status: string;
  address: string | null;
  taskCount: number;
  lat: number;
  lng: number;
};

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "#2563eb",
  ON_HOLD: "#f59e0b",
  DONE: "#22c55e",
  ARCHIVED: "#9ca3af",
};

const FILTERS_KEY = "map-meter-filters-v1";
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Punctele contoarelor ca GeoJSON (proprietățile necesare pentru culoare și ferestra cu detalii). */
function meterFeatures(pins: MeterPin[]) {
  return {
    type: "FeatureCollection" as const,
    features: pins.map((p) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      properties: {
        id: p.id, contor: p.contor, name: p.name, address: p.address, st: p.st, value: p.value, readAt: p.readAt, sector: p.sector, issue: p.issue, by: p.by, portal: p.portal ? 1 : 0,
        suspect: p.suspect, acc: p.acc, fuzzy: p.acc == null || p.acc > PIN_FUZZY_M ? 1 : 0, lat: p.lat, lng: p.lng,
      },
    })),
  };
}

export default function ProjectsMapView({ pins, meters = false }: { pins: ProjectPin[]; meters?: boolean }) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const m = useMessages();

  const statusLabels = m.projects.status;

  // ── Straturi + filtre pentru contoare ──
  const [showProjects, setShowProjects] = useState(true);
  const [showMeters, setShowMeters] = useState(meters);
  const [filters, setFilters] = useState<MeterMapFilters>(EMPTY_METER_FILTERS);
  const [filtersReady, setFiltersReady] = useState(false);
  const mp = useMeterPins(meters && showMeters);
  const [draftQ, setDraftQ] = useState("");
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FILTERS_KEY);
      if (raw) {
        const s = JSON.parse(raw) as { filters?: Partial<MeterMapFilters>; showProjects?: boolean; showMeters?: boolean };
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (s.filters) setFilters({ ...EMPTY_METER_FILTERS, ...s.filters, q: "" });
        if (typeof s.showProjects === "boolean") setShowProjects(s.showProjects);
        if (meters && typeof s.showMeters === "boolean") setShowMeters(s.showMeters);
      }
    } catch {}
    setFiltersReady(true);
  }, [meters]);
  useEffect(() => {
    if (!filtersReady) return;
    try { localStorage.setItem(FILTERS_KEY, JSON.stringify({ filters: { ...filters, q: "" }, showProjects, showMeters })); } catch {}
  }, [filters, showProjects, showMeters, filtersReady]);
  // căutarea se aplică după o scurtă pauză
  useEffect(() => {
    const id = setTimeout(() => setFilters((cur) => (cur.q === draftQ ? cur : { ...cur, q: draftQ })), 160);
    return () => clearTimeout(id);
  }, [draftQ]);
  const shown = useMemo(() => filterPins(mp.pins, filters), [mp.pins, filters]);

  // ── Harta ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  const mbglRef = useRef<typeof import("mapbox-gl").default | null>(null);
  const [mapReady, setMapReady] = useState(false);

  function pinPopupHtml(pin: { id: string; seq?: number | null; name: string; status: string; address: string | null; taskCount: number; lat: number; lng: number }) {
    const seq = pin.seq != null ? `<span style="font-family:monospace;font-size:11px;background:#eff6ff;color:#2563eb;padding:1px 6px;border-radius:4px;margin-right:6px">#${String(pin.seq).padStart(3, "0")}</span>` : "";
    const statusLabel = statusLabels[pin.status as keyof typeof statusLabels] ?? pin.status;
    return `
      <div style="font-family:system-ui,sans-serif;padding:4px 0;min-width:180px">
        <div style="font-weight:700;font-size:14px;margin-bottom:4px">${seq}${esc(pin.name)}</div>
        <div style="font-size:12px;color:#6b7280;margin-bottom:2px">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${STATUS_COLOR[pin.status] ?? "#9ca3af"};margin-right:4px"></span>
          ${statusLabel} · ${pin.taskCount} ${m.projects.taskUnit}
        </div>
        ${pin.address ? `<div style="font-size:12px;color:#6b7280;margin-bottom:8px">${esc(pin.address)}</div>` : ""}
        <div style="display:flex;gap:8px;margin-top:8px">
          <a href="/projects/${pin.id}" style="font-size:12px;font-weight:600;color:#2563eb;text-decoration:none">${m.projects.map.details} →</a>
          <a href="/tasks?scope=all&proj=${pin.id}" style="font-size:12px;font-weight:600;color:#2563eb;text-decoration:none">${m.nav.tasks} →</a>
        </div>
        <div style="display:flex;gap:10px;margin-top:6px;padding-top:6px;border-top:1px solid #f3f4f6">
          <a href="https://waze.com/ul?ll=${pin.lat},${pin.lng}&navigate=yes" target="_blank" rel="noopener noreferrer" style="font-size:11px;font-weight:600;color:#2563eb;text-decoration:none">🚗 Waze</a>
          <a href="https://www.google.com/maps?q=${pin.lat},${pin.lng}" target="_blank" rel="noopener noreferrer" style="font-size:11px;font-weight:600;color:#2563eb;text-decoration:none">🗺️ Maps</a>
          <a href="https://maps.apple.com/?ll=${pin.lat},${pin.lng}" target="_blank" rel="noopener noreferrer" style="font-size:11px;font-weight:600;color:#2563eb;text-decoration:none">🍎 Apple</a>
        </div>
      </div>
    `;
  }

  function meterPopupHtml(p: Record<string, unknown>) {
    const st = p.st as MeterPin["st"];
    const stLabel = st === "issue" ? t("Neregulă deschisă") : st === "read" ? t("Citit luna aceasta") : t("Necitit luna aceasta");
    const lat = p.lat as number;
    const lng = p.lng as number;
    const id = encodeURIComponent(String(p.id));
    const acc = p.acc as number | null;
    const readLine = p.value != null ? `${String(p.value).replace(".", ",")} m³${p.readAt ? ` · ${new Date(p.readAt as number).toLocaleDateString("ro-RO", { timeZone: "Europe/Bucharest" })}` : ""}${p.by ? ` · ${esc(p.by)}` : ""}${p.portal ? " 🌐" : ""}` : "";
    const sus = Number(p.suspect);
    const susLabel = sus === 1 ? t("Index mai mic decât cel anterior") : sus === 2 ? t("Consum neobișnuit de mare") : sus === 3 ? t("Citit departe de locația anterioară") : "";
    return `
      <div style="font-family:system-ui,sans-serif;padding:4px 0;min-width:200px">
        <div style="font-weight:700;font-size:14px;margin-bottom:2px"><span style="font-family:monospace">${esc(p.contor)}</span></div>
        <div style="font-size:12px;margin-bottom:2px">${esc(p.name)}</div>
        ${p.address ? `<div style="font-size:12px;color:#6b7280;margin-bottom:4px">${esc(p.address)}${p.sector ? ` · ${esc(p.sector)}` : ""}</div>` : ""}
        <div style="font-size:12px;margin-bottom:2px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${PIN_COLOR[st]};margin-right:4px"></span>${stLabel}${readLine ? ` · ${readLine}` : ""}</div>
        ${p.issue ? `<div style="font-size:12px;color:#dc2626;margin-bottom:2px">⚑ ${esc(isIssueKind(p.issue) ? t(ISSUE_LABELS[p.issue]) : p.issue)}</div>` : ""}
        ${susLabel ? `<div style="font-size:12px;color:#b45309;margin-bottom:2px">⚠ ${esc(susLabel)}</div>` : ""}
        ${acc != null ? `<div style="font-size:11px;color:#6b7280">${t("precizie locație")} ±${Math.round(acc)} m</div>` : ""}
        <div style="display:flex;gap:10px;margin-top:8px">
          <a href="/contoare/${id}" style="font-size:12px;font-weight:600;color:#2563eb;text-decoration:none">${t("Fișa contorului")} →</a>
          <a href="/contoare/citiri?meter=${id}" style="font-size:12px;font-weight:600;color:#2563eb;text-decoration:none">${t("Citire")} →</a>
        </div>
        <div style="display:flex;gap:10px;margin-top:6px;padding-top:6px;border-top:1px solid #f3f4f6">
          <a href="https://waze.com/ul?ll=${lat},${lng}&navigate=yes" target="_blank" rel="noopener noreferrer" style="font-size:11px;font-weight:600;color:#2563eb;text-decoration:none">🚗 Waze</a>
          <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener noreferrer" style="font-size:11px;font-weight:600;color:#2563eb;text-decoration:none">🗺️ Maps</a>
          <a href="https://maps.apple.com/?ll=${lat},${lng}" target="_blank" rel="noopener noreferrer" style="font-size:11px;font-weight:600;color:#2563eb;text-decoration:none">🍎 Apple</a>
        </div>
      </div>
    `;
  }

  function clusterPopupHtml(leaves: { properties: Record<string, unknown> }[]) {
    const items = leaves
      .map((f) => {
        const p = f.properties;
        const seq = p.seq != null ? `<span style="font-family:monospace;font-size:10px;background:#eff6ff;color:#2563eb;padding:1px 5px;border-radius:4px;margin-right:5px">#${String(p.seq).padStart(3, "0")}</span>` : "";
        const statusLabel = statusLabels[p.status as keyof typeof statusLabels] ?? (p.status as string);
        return `
          <div style="padding:6px 0;border-bottom:1px solid #f3f4f6;display:flex;align-items:center;gap:6px">
            <span style="display:inline-block;width:8px;height:8px;flex-shrink:0;border-radius:50%;background:${STATUS_COLOR[p.status as string] ?? "#9ca3af"}"></span>
            <div style="min-width:0;flex:1">
              <div style="font-size:13px;font-weight:600">${seq}${esc(p.name)}</div>
              <div style="font-size:11px;color:#6b7280">${statusLabel} · ${p.taskCount} ${m.projects.taskUnit}</div>
            </div>
            <a href="/projects/${p.id}" style="font-size:12px;font-weight:600;color:#2563eb;text-decoration:none;flex-shrink:0">→</a>
          </div>
        `;
      })
      .join("");
    return `
      <div style="font-family:system-ui,sans-serif;padding:4px 0;min-width:220px;max-height:300px;overflow-y:auto">
        <div style="font-size:12px;font-weight:700;color:#6b7280;margin-bottom:4px">${leaves.length} ${m.projects.map.inZone}</div>
        ${items}
      </div>
    `;
  }

  function meterClusterPopupHtml(leaves: { properties: Record<string, unknown> }[]) {
    const items = leaves
      .map((f) => {
        const p = f.properties;
        return `
          <div style="padding:5px 0;border-bottom:1px solid #f3f4f6;display:flex;align-items:center;gap:6px">
            <span style="display:inline-block;width:8px;height:8px;flex-shrink:0;border-radius:50%;background:${PIN_COLOR[p.st as MeterPin["st"]] ?? "#6b7280"}"></span>
            <div style="min-width:0;flex:1">
              <div style="font-size:12px;font-weight:600;font-family:monospace">${esc(p.contor)}</div>
              <div style="font-size:11px;color:#6b7280">${esc(p.name)}${p.address ? ` · ${esc(p.address)}` : ""}</div>
            </div>
            <a href="/contoare/${encodeURIComponent(String(p.id))}" style="font-size:12px;font-weight:600;color:#2563eb;text-decoration:none;flex-shrink:0">→</a>
          </div>
        `;
      })
      .join("");
    return `
      <div style="font-family:system-ui,sans-serif;padding:4px 0;min-width:240px;max-height:300px;overflow-y:auto">
        <div style="font-size:12px;font-weight:700;color:#6b7280;margin-bottom:4px">${leaves.length} ${t("contoare în această zonă")}</div>
        ${items}
      </div>
    `;
  }

  useEffect(() => {
    if (!token || !containerRef.current || (pins.length === 0 && !meters)) return;

    let map: import("mapbox-gl").Map;
    let gone = false;

    import("mapbox-gl").then((mbgl) => {
      if (gone || !containerRef.current) return;
      mbgl.default.accessToken = token;
      mbglRef.current = mbgl.default;

      map = new mbgl.default.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: pins[0] ? [pins[0].lng, pins[0].lat] : [28.19, 45.9],
        zoom: pins[0] ? 7 : 11,
      });
      mapRef.current = map;

      map.on("load", () => {
        // ── Fit bounds ──
        if (pins.length > 1) {
          const bounds = pins.reduce(
            (b, p) => b.extend([p.lng, p.lat]),
            new mbgl.default.LngLatBounds([pins[0].lng, pins[0].lat], [pins[0].lng, pins[0].lat]),
          );
          map.fitBounds(bounds, { padding: 80, maxZoom: 13 });
        }

        // ── GeoJSON source cu clustering ──
        map.addSource("projects", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: pins.map((p) => ({
              type: "Feature",
              geometry: { type: "Point", coordinates: [p.lng, p.lat] },
              properties: {
                id: p.id,
                seq: p.seq,
                name: p.name,
                status: p.status,
                address: p.address,
                taskCount: p.taskCount,
                lat: p.lat,
                lng: p.lng,
              },
            })),
          },
          cluster: true,
          clusterMaxZoom: 15,
          clusterRadius: 45,
        });

        // ── Layer: cercuri cluster ──
        map.addLayer({
          id: "clusters",
          type: "circle",
          source: "projects",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": "#2563eb",
            "circle-radius": ["step", ["get", "point_count"], 22, 5, 30, 20, 38],
            "circle-stroke-width": 3,
            "circle-stroke-color": "#fff",
            "circle-opacity": 0.9,
          },
        });

        // ── Layer: numărul din cluster ──
        map.addLayer({
          id: "cluster-count",
          type: "symbol",
          source: "projects",
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
            "text-size": 14,
          },
          paint: { "text-color": "#ffffff" },
        });

        // ── Layer: punct individual ──
        map.addLayer({
          id: "unclustered-point",
          type: "circle",
          source: "projects",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": [
              "match", ["get", "status"],
              "ACTIVE",   "#2563eb",
              "ON_HOLD",  "#f59e0b",
              "DONE",     "#22c55e",
              "ARCHIVED", "#9ca3af",
              "#6b7280",
            ],
            "circle-radius": 11,
            "circle-stroke-width": 3,
            "circle-stroke-color": "#ffffff",
          },
        });

        // ── Click pe cluster → zoom in sau popup cu lista ──
        map.on("click", "clusters", (e) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] }) as any[];
          if (!features.length) return;
          const clusterId = features[0].properties?.cluster_id as number;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const coords = (features[0].geometry as any).coordinates as [number, number];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const source = map.getSource("projects") as any;

          // getClusterExpansionZoom e callback-based în Mapbox GL v2
          source.getClusterExpansionZoom(clusterId, (err: Error | null, expansionZoom: number) => {
            if (err) return;

            if (expansionZoom <= map.getZoom() + 0.5 || expansionZoom >= 16) {
              // Punctele sunt în același loc — zoom nu ajută, afișăm lista
              source.getClusterLeaves(clusterId, 100, 0, (leafErr: Error | null, leaves: { properties: Record<string, unknown> }[]) => {
                if (leafErr || !leaves?.length) return;
                new mbgl.default.Popup({ maxWidth: "280px" })
                  .setLngLat(e.lngLat)
                  .setHTML(clusterPopupHtml(leaves))
                  .addTo(map);
              });
            } else {
              // Punctele sunt în locuri diferite — zoomăm să le desfacem
              map.easeTo({ center: coords, zoom: expansionZoom });
            }
          });
        });

        // ── Click pe punct individual → popup ──
        map.on("click", "unclustered-point", (e) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const features = map.queryRenderedFeatures(e.point, { layers: ["unclustered-point"] }) as any[];
          if (!features.length) return;
          const p = features[0].properties as Record<string, unknown>;
          new mbgl.default.Popup({ maxWidth: "280px" })
            .setLngLat(e.lngLat)
            .setHTML(pinPopupHtml({
              id: p.id as string,
              seq: p.seq as number | null,
              name: p.name as string,
              status: p.status as string,
              address: p.address as string | null,
              taskCount: p.taskCount as number,
              lat: p.lat as number,
              lng: p.lng as number,
            }))
            .addTo(map);
        });

        // ── Cursor pointer la hover ──
        map.on("mouseenter", "clusters", () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "clusters", () => { map.getCanvas().style.cursor = ""; });
        map.on("mouseenter", "unclustered-point", () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "unclustered-point", () => { map.getCanvas().style.cursor = ""; });

        // ── Contoare: sursă proprie (cu clustering), punctele se actualizează la filtre ──
        if (meters) {
          map.addSource("meters", { type: "geojson", data: { type: "FeatureCollection", features: [] }, cluster: true, clusterMaxZoom: 16, clusterRadius: 40 });
          map.addLayer({
            id: "m-clusters",
            type: "circle",
            source: "meters",
            filter: ["has", "point_count"],
            paint: { "circle-color": "#0f766e", "circle-radius": ["step", ["get", "point_count"], 16, 10, 22, 50, 28], "circle-stroke-width": 2, "circle-stroke-color": "#fff", "circle-opacity": 0.92 },
          });
          map.addLayer({
            id: "m-cluster-count",
            type: "symbol",
            source: "meters",
            filter: ["has", "point_count"],
            layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"], "text-size": 12 },
            paint: { "text-color": "#ffffff" },
          });
          map.addLayer({
            id: "m-point",
            type: "circle",
            source: "meters",
            filter: ["!", ["has", "point_count"]],
            paint: {
              "circle-color": ["match", ["get", "st"], "issue", PIN_COLOR.issue, "read", PIN_COLOR.read, "unread", PIN_COLOR.unread, "#6b7280"],
              "circle-radius": 7,
              "circle-stroke-width": 2,
              // locația nesigură (> 100 m) are contur gri, ca să se vadă că punctul e aproximativ
              "circle-stroke-color": ["case", ["==", ["get", "fuzzy"], 1], "#6b7280", "#ffffff"],
            },
          });
          map.on("click", "m-clusters", (e) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const features = map.queryRenderedFeatures(e.point, { layers: ["m-clusters"] }) as any[];
            if (!features.length) return;
            const clusterId = features[0].properties?.cluster_id as number;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const coords = (features[0].geometry as any).coordinates as [number, number];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const source = map.getSource("meters") as any;
            source.getClusterExpansionZoom(clusterId, (err: Error | null, zoom: number) => {
              if (err) return;
              if (zoom <= map.getZoom() + 0.5 || zoom >= 18) {
                source.getClusterLeaves(clusterId, 100, 0, (leafErr: Error | null, leaves: { properties: Record<string, unknown> }[]) => {
                  if (leafErr || !leaves?.length) return;
                  new mbgl.default.Popup({ maxWidth: "300px" }).setLngLat(e.lngLat).setHTML(meterClusterPopupHtml(leaves)).addTo(map);
                });
              } else map.easeTo({ center: coords, zoom });
            });
          });
          map.on("click", "m-point", (e) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const features = map.queryRenderedFeatures(e.point, { layers: ["m-point"] }) as any[];
            if (!features.length) return;
            new mbgl.default.Popup({ maxWidth: "300px" }).setLngLat(e.lngLat).setHTML(meterPopupHtml(features[0].properties as Record<string, unknown>)).addTo(map);
          });
          for (const l of ["m-clusters", "m-point"]) {
            map.on("mouseenter", l, () => { map.getCanvas().style.cursor = "pointer"; });
            map.on("mouseleave", l, () => { map.getCanvas().style.cursor = ""; });
          }
        }
        setMapReady(true);
      });
    });

    return () => { gone = true; setMapReady(false); mapRef.current = null; map?.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // punctele contoarelor (filtrate) → sursa hărții
  useEffect(() => {
    if (!mapReady || !meters) return;
    const src = mapRef.current?.getSource("meters");
    if (src) src.setData(meterFeatures(shown));
  }, [mapReady, meters, shown]);

  // straturile pornite / oprite
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const vis = (ids: string[], on: boolean) => { for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); };
    vis(["clusters", "cluster-count", "unclustered-point"], showProjects);
    vis(["m-clusters", "m-cluster-count", "m-point"], showMeters);
  }, [mapReady, showProjects, showMeters]);

  function fitMeters() {
    const map = mapRef.current;
    const mbgl = mbglRef.current;
    if (!map || !mbgl || shown.length === 0) return;
    const b = shown.reduce((acc, p) => acc.extend([p.lng, p.lat]), new mbgl.LngLatBounds([shown[0].lng, shown[0].lat], [shown[0].lng, shown[0].lat]));
    map.fitBounds(b, { padding: 80, maxZoom: 17 });
  }

  if (!token) {
    return (
      <div className="card grid place-items-center p-16 text-center text-sm text-ink-soft">
        <p className="mb-1 font-semibold text-ink">{m.projects.map.unavailable}</p>
        <p>
          {t("Variabila")} <code className="rounded bg-[var(--color-surface-2)] px-1">{t("NEXT_PUBLIC_MAPBOX_TOKEN")}</code> {m.projects.map.varNotSet}
        </p>
      </div>
    );
  }

  if (pins.length === 0 && !meters) {
    return (
      <div className="card grid place-items-center p-16 text-center text-sm text-ink-soft">
        <p className="mb-1 font-semibold text-ink">{m.projects.map.noPins}</p>
        <p>{m.projects.map.noPinsDesc}</p>
      </div>
    );
  }

  return (
    <div className="relative" data-meters-source={mp.source ?? ""}>
      <div
        ref={containerRef}
        className="h-[calc(100dvh-8rem)] w-full overflow-hidden rounded-2xl border border-[var(--color-line)]"
      />

      {meters && (
        <MeterMapPanel
          data={mp.data}
          pins={mp.pins}
          shown={shown}
          filters={{ ...filters, q: draftQ }}
          setFilters={(f) => { setDraftQ(f.q); setFilters(f); }}
          projectsCount={pins.length}
          showProjects={showProjects}
          setShowProjects={setShowProjects}
          showMeters={showMeters}
          setShowMeters={setShowMeters}
          loading={mp.loading}
          error={mp.error}
          onFit={fitMeters}
        />
      )}

      {/* Legendă */}
      <div className="absolute bottom-4 left-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3 shadow-lg">
        <p className="mb-2 text-xs font-semibold text-ink-soft">{m.projects.map.legend}</p>
        <div className="flex flex-col gap-1.5">
          {showProjects && Object.entries(statusLabels).map(([k, label]) => (
            <div key={k} className="flex items-center gap-2">
              <span className="size-3 rounded-full" style={{ background: STATUS_COLOR[k] ?? "#9ca3af" }} />
              <span className="text-xs">{label}</span>
            </div>
          ))}
          {showProjects && (
            <div className="mt-1 flex items-center gap-2 border-t border-[var(--color-line)] pt-1.5">
              <span className="flex size-5 items-center justify-center rounded-full bg-brand text-[9px] font-bold text-white">N</span>
              <span className="text-xs text-ink-soft">{m.projects.map.clusterLabel}</span>
            </div>
          )}
          {meters && showMeters && (
            <div className={`flex flex-col gap-1.5 ${showProjects ? "mt-1 border-t border-[var(--color-line)] pt-1.5" : ""}`}>
              <div className="flex items-center gap-2"><span className="size-3 rounded-full" style={{ background: PIN_COLOR.read }} /><span className="text-xs">{t("Contor citit luna aceasta")}</span></div>
              <div className="flex items-center gap-2"><span className="size-3 rounded-full" style={{ background: PIN_COLOR.unread }} /><span className="text-xs">{t("Contor necitit")}</span></div>
              <div className="flex items-center gap-2"><span className="size-3 rounded-full" style={{ background: PIN_COLOR.issue }} /><span className="text-xs">{t("Contor cu neregulă")}</span></div>
              <div className="flex items-center gap-2"><span className="flex size-5 items-center justify-center rounded-full bg-[#0f766e] text-[9px] font-bold text-white">N</span><span className="text-xs text-ink-soft">{t("Grup de contoare")}</span></div>
            </div>
          )}
        </div>
      </div>

      {/* Contor */}
      <div className="absolute right-4 top-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 shadow-lg">
        {showProjects && (
          <div>
            <span className="text-sm font-semibold">{pins.length}</span>
            <span className="ml-1 text-xs text-ink-soft">{m.projects.map.onMap}</span>
          </div>
        )}
        {meters && showMeters && (
          <div>
            <span className="text-sm font-semibold">{shown.length}</span>
            <span className="ml-1 text-xs text-ink-soft">{t("contoare pe hartă")}</span>
          </div>
        )}
      </div>
    </div>
  );
}
