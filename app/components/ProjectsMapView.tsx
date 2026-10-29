"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MlMap, Popup as MlPopup } from "maplibre-gl";
import { useMessages, useT } from "@/lib/i18n/context";
import { MAP_DEFAULT_CENTER, MAP_FONT, MAP_MAX_ZOOM, MAP_MIN_ZOOM, MAP_STYLE_URL, boundsFor, slimMapStyle, setLocalMapWorker } from "@/lib/map-config";
import { cardHtml, hoverHtml, listHtml, navHtml } from "@/lib/map-popup";
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
  const mapRef = useRef<MlMap | null>(null);
  const mlRef = useRef<typeof import("maplibre-gl") | null>(null);
  const popupRef = useRef<MlPopup | null>(null);
  const tipRef = useRef<MlPopup | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);

  type Props = Record<string, unknown>;
  const taskUnit = m.projects.taskUnit;

  function pinPopupHtml(p: Props) {
    const status = String(p.status);
    const statusLabel = statusLabels[status as keyof typeof statusLabels] ?? status;
    return cardHtml({
      dot: STATUS_COLOR[status] ?? "#9ca3af",
      tag: p.seq != null ? "#" + String(p.seq).padStart(3, "0") : undefined,
      title: String(p.name),
      pills: [[statusLabel + " · " + p.taskCount + " " + taskUnit, STATUS_COLOR[status] ?? "#6b7280"]],
      lines: p.address ? [["📍", String(p.address)]] : [],
      actions: [[m.projects.map.details, "/projects/" + p.id], [m.nav.tasks, "/tasks?scope=all&proj=" + p.id]],
      footerHtml: navHtml(p.lat as number, p.lng as number, t("Navighează")),
    });
  }

  function meterPopupHtml(p: Props) {
    const st = p.st as MeterPin["st"];
    const stLabel = st === "issue" ? t("Neregulă deschisă") : st === "read" ? t("Citit luna aceasta") : t("Necitit luna aceasta");
    const id = encodeURIComponent(String(p.id));
    const acc = p.acc as number | null;
    const readLine = p.value != null ? String(p.value).replace(".", ",") + " m³" + (p.readAt ? " · " + new Date(p.readAt as number).toLocaleDateString("ro-RO", { timeZone: "Europe/Bucharest" }) : "") + (p.by ? " · " + p.by : "") + (p.portal ? " 🌐" : "") : "";
    const sus = Number(p.suspect);
    const susLabel = sus === 1 ? t("Index mai mic decât cel anterior") : sus === 2 ? t("Consum neobișnuit de mare") : sus === 3 ? t("Citit departe de locația anterioară") : "";
    const pills: [string, string][] = [[stLabel, PIN_COLOR[st]]];
    if (p.issue) pills.push([isIssueKind(p.issue) ? t(ISSUE_LABELS[p.issue]) : String(p.issue), "#dc2626"]);
    if (susLabel) pills.push([susLabel, "#b45309"]);
    const lines: [string, string][] = [];
    if (p.address) lines.push(["📍", String(p.address) + (p.sector ? " · " + p.sector : "")]);
    if (readLine) lines.push(["💧", readLine]);
    if (acc != null) lines.push(["🎯", t("precizie locație") + " ±" + Math.round(acc) + " m"]);
    return cardHtml({
      dot: PIN_COLOR[st],
      title: String(p.contor),
      subtitle: String(p.name ?? ""),
      pills,
      lines,
      actions: [[t("Fișa contorului"), "/contoare/" + id], [t("Citire"), "/contoare/citiri?meter=" + id]],
      footerHtml: navHtml(p.lat as number, p.lng as number, t("Navighează")),
    });
  }

  function clusterPopupHtml(leaves: { properties: Props }[]) {
    return listHtml(
      leaves.length + " " + m.projects.map.inZone,
      leaves.map(({ properties: p }) => {
        const status = String(p.status);
        return {
          dot: STATUS_COLOR[status] ?? "#9ca3af",
          title: (p.seq != null ? "#" + String(p.seq).padStart(3, "0") + " " : "") + p.name,
          subtitle: (statusLabels[status as keyof typeof statusLabels] ?? status) + " · " + p.taskCount + " " + taskUnit,
          href: "/projects/" + p.id,
        };
      }),
    );
  }

  function meterClusterPopupHtml(leaves: { properties: Props }[]) {
    return listHtml(
      leaves.length + " " + t("contoare în această zonă"),
      leaves.map(({ properties: p }) => ({
        dot: PIN_COLOR[p.st as MeterPin["st"]] ?? "#6b7280",
        title: String(p.contor),
        subtitle: String(p.name ?? "") + (p.address ? " · " + p.address : ""),
        href: "/contoare/" + encodeURIComponent(String(p.id)),
      })),
    );
  }

  useEffect(() => {
    if (!containerRef.current || (pins.length === 0 && !meters)) return;

    let map: MlMap | undefined;
    let gone = false;

    import("maplibre-gl").then((ml) => {
      if (gone || !containerRef.current) return;
      mlRef.current = ml;
      setLocalMapWorker(ml);

      try {
        map = new ml.Map({
          container: containerRef.current,
          style: MAP_STYLE_URL,
          center: pins[0] ? [pins[0].lng, pins[0].lat] : MAP_DEFAULT_CENTER,
          zoom: pins[0] ? 7 : 11,
          minZoom: MAP_MIN_ZOOM,
          maxZoom: MAP_MAX_ZOOM,
          // nu se încarcă plăci din afara zonei de lucru
          maxBounds: boundsFor(pins),
          attributionControl: { compact: true },
          // fără rotire / înclinare: harta rămâne simplă și ușoară
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
        });
      } catch {
        setMapFailed(true);
        return;
      }
      const mp0 = map;
      mapRef.current = mp0;
      mp0.touchZoomRotate.disableRotation();
      mp0.addControl(new ml.NavigationControl({ showCompass: false }), "bottom-right");
      if (new URLSearchParams(location.search).has("mapdebug")) (window as unknown as { __crmMap?: MlMap }).__crmMap = mp0;

      const canHover = typeof matchMedia === "function" && matchMedia("(hover: hover)").matches;
      const closeTip = () => { tipRef.current?.remove(); tipRef.current = null; };
      const coordsOf = (feat: { geometry: unknown }) => (feat.geometry as { coordinates: [number, number] }).coordinates;
      const openPopup = (lngLat: [number, number] | { lng: number; lat: number }, html: string, maxWidth = "300px") => {
        closeTip();
        popupRef.current?.remove();
        popupRef.current = new ml.Popup({ className: "mp-pop", maxWidth, offset: 14, focusAfterOpen: false }).setLngLat(lngLat).setHTML(html).addTo(mp0);
      };
      // eticheta cu numele la trecerea mouse-ului (doar unde există mouse; pe telefon se folosește apăsarea)
      const wireHover = (layer: string, html: (p: Props) => string) => {
        mp0.on("mouseenter", layer, (e) => {
          mp0.getCanvas().style.cursor = "pointer";
          const feat = e.features?.[0];
          if (!canHover || !feat) return;
          closeTip();
          tipRef.current = new ml.Popup({ className: "mp-tip", closeButton: false, closeOnClick: false, offset: 16, focusAfterOpen: false })
            .setLngLat(coordsOf(feat))
            .setHTML(html(feat.properties as Props))
            .addTo(mp0);
        });
        mp0.on("mouseleave", layer, () => { mp0.getCanvas().style.cursor = ""; closeTip(); });
      };
      // apăsare pe grup: zoom pe el sau, dacă punctele sunt în același loc, lista lor
      const wireCluster = (layer: string, source: string, listMaxZoom: number, html: (leaves: { properties: Props }[]) => string) => {
        mp0.on("click", layer, async (e) => {
          const feat = e.features?.[0];
          const src = mp0.getSource<GeoJSONSource>(source);
          if (!feat || !src) return;
          const clusterId = feat.properties?.cluster_id as number;
          try {
            const zoom = await src.getClusterExpansionZoom(clusterId);
            if (zoom <= mp0.getZoom() + 0.5 || zoom >= listMaxZoom) {
              const leaves = (await src.getClusterLeaves(clusterId, 100, 0)) as unknown as { properties: Props }[];
              if (leaves?.length) openPopup(e.lngLat, html(leaves), "320px");
            } else {
              mp0.easeTo({ center: coordsOf(feat), zoom });
            }
          } catch {}
        });
        mp0.on("mouseenter", layer, () => { mp0.getCanvas().style.cursor = "pointer"; });
        mp0.on("mouseleave", layer, () => { mp0.getCanvas().style.cursor = ""; });
      };

      mp0.on("load", () => {
        // harta rămâne ușoară: fără puncte de interes, aeroporturi, căi ferate etc.
        slimMapStyle(mp0);

        // ── Fit bounds ──
        if (pins.length > 1) {
          const bounds = pins.reduce((b, p) => b.extend([p.lng, p.lat]), new ml.LngLatBounds([pins[0].lng, pins[0].lat], [pins[0].lng, pins[0].lat]));
          mp0.fitBounds(bounds, { padding: 80, maxZoom: 13, animate: false });
        }

        // ── Proiecte: sursă GeoJSON cu grupare ──
        mp0.addSource("projects", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: pins.map((p) => ({
              type: "Feature",
              geometry: { type: "Point", coordinates: [p.lng, p.lat] },
              properties: { id: p.id, seq: p.seq, name: p.name, status: p.status, address: p.address, taskCount: p.taskCount, lat: p.lat, lng: p.lng },
            })),
          },
          cluster: true,
          // punctele din același loc rămân grupate până la zoom 16: apăsarea lor arată lista (nu un singur punct din grămadă)
          clusterMaxZoom: 16,
          clusterRadius: 45,
        });
        mp0.addLayer({
          id: "clusters",
          type: "circle",
          source: "projects",
          filter: ["has", "point_count"],
          paint: { "circle-color": "#2563eb", "circle-radius": ["step", ["get", "point_count"], 22, 5, 30, 20, 38], "circle-stroke-width": 3, "circle-stroke-color": "#fff", "circle-opacity": 0.9 },
        });
        mp0.addLayer({
          id: "cluster-count",
          type: "symbol",
          source: "projects",
          filter: ["has", "point_count"],
          layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": MAP_FONT, "text-size": 14, "text-allow-overlap": true },
          paint: { "text-color": "#ffffff" },
        });
        mp0.addLayer({
          id: "unclustered-point",
          type: "circle",
          source: "projects",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": ["match", ["get", "status"], "ACTIVE", "#2563eb", "ON_HOLD", "#f59e0b", "DONE", "#22c55e", "ARCHIVED", "#9ca3af", "#6b7280"],
            "circle-radius": 11,
            "circle-stroke-width": 3,
            "circle-stroke-color": "#ffffff",
          },
        });
        wireCluster("clusters", "projects", 17, clusterPopupHtml);
        mp0.on("click", "unclustered-point", (e) => {
          const feat = e.features?.[0];
          if (feat) openPopup(coordsOf(feat), pinPopupHtml(feat.properties as Props));
        });
        wireHover("unclustered-point", (p) => hoverHtml((p.seq != null ? "#" + String(p.seq).padStart(3, "0") + " " : "") + p.name, statusLabels[p.status as keyof typeof statusLabels] ?? String(p.status)));

        // ── Contoare: sursă proprie (cu grupare), punctele se actualizează la filtre ──
        if (meters) {
          mp0.addSource("meters", { type: "geojson", data: { type: "FeatureCollection", features: [] }, cluster: true, clusterMaxZoom: 17, clusterRadius: 40 });
          mp0.addLayer({
            id: "m-clusters",
            type: "circle",
            source: "meters",
            filter: ["has", "point_count"],
            paint: { "circle-color": "#0f766e", "circle-radius": ["step", ["get", "point_count"], 16, 10, 22, 50, 28], "circle-stroke-width": 2, "circle-stroke-color": "#fff", "circle-opacity": 0.92 },
          });
          mp0.addLayer({
            id: "m-cluster-count",
            type: "symbol",
            source: "meters",
            filter: ["has", "point_count"],
            layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": MAP_FONT, "text-size": 12, "text-allow-overlap": true },
            paint: { "text-color": "#ffffff" },
          });
          mp0.addLayer({
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
          wireCluster("m-clusters", "meters", 18, meterClusterPopupHtml);
          mp0.on("click", "m-point", (e) => {
            const feat = e.features?.[0];
            if (feat) openPopup(coordsOf(feat), meterPopupHtml(feat.properties as Props));
          });
          wireHover("m-point", (p) => hoverHtml(String(p.contor), String(p.name ?? "")));
        }
        setMapReady(true);
      });
    });

    return () => { gone = true; setMapReady(false); mapRef.current = null; popupRef.current?.remove(); tipRef.current?.remove(); map?.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // zona permisă include și contoarele (un contor în afara zonei implicite rămâne accesibil)
  useEffect(() => {
    if (!mapReady || !meters || mp.pins.length === 0) return;
    mapRef.current?.setMaxBounds(boundsFor([...pins, ...mp.pins]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, meters, mp.pins]);

  // punctele contoarelor (filtrate) → sursa hărții
  useEffect(() => {
    if (!mapReady || !meters) return;
    const src = mapRef.current?.getSource<GeoJSONSource>("meters");
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
    const ml = mlRef.current;
    if (!map || !ml || shown.length === 0) return;
    const b = shown.reduce((acc, p) => acc.extend([p.lng, p.lat]), new ml.LngLatBounds([shown[0].lng, shown[0].lat], [shown[0].lng, shown[0].lat]));
    map.fitBounds(b, { padding: 80, maxZoom: 17 });
  }

  if (mapFailed) {
    return (
      <div className="card grid place-items-center p-16 text-center text-sm text-ink-soft">
        <p className="font-semibold text-ink">{m.projects.map.unavailable}</p>
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
