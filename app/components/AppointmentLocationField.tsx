"use client";

import { useRef, useState } from "react";
import { resolveMapLinkAction } from "@/app/actions/appointments";
import { isMapUrl, parseCoordinates } from "@/lib/map-links";
import AddressInput from "./AddressInput";
import MapOpenButtons from "./MapOpenButtons";
import { useT } from "@/lib/i18n/context";

const fld = "h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";
const btn = "tap h-9 cursor-pointer rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium hover:bg-brand-soft disabled:opacity-50";

/**
 * „Locație” a programării (opțional): adresa scrisă (cu sugestii din adresele plătitorilor), locația GPS a telefonului, sau coordonate / linkul Google Maps lipit
 * (inclusiv linkuri scurte de la „Distribuie” din aplicația Google Maps). Se trimit prin câmpurile `address`, `lat`, `lng`, `mapUrl`. Pentru locația aleasă se arată
 * butoanele de deschidere în Google Maps, Apple Maps și Waze.
 */
export default function AppointmentLocationField({
  initial,
}: {
  initial?: { address?: string; lat?: number | null; lng?: number | null; mapUrl?: string };
}) {
  const t = useT();
  const [address, setAddress] = useState(initial?.address ?? "");
  const [geo, setGeo] = useState<{ lat: number; lng: number; acc?: number } | null>(initial?.lat != null && initial?.lng != null ? { lat: initial.lat, lng: initial.lng } : null);
  const [mapUrl, setMapUrl] = useState(initial?.mapUrl ?? "");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const seq = useRef(0);

  function useMyLocation() {
    if (!navigator.geolocation) {
      setMsg({ ok: false, text: t("Telefonul nu oferă locația.") });
      return;
    }
    setBusy(true);
    setMsg(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({ lat: Math.round(pos.coords.latitude * 1e6) / 1e6, lng: Math.round(pos.coords.longitude * 1e6) / 1e6, acc: Math.round(pos.coords.accuracy) });
        setMapUrl("");
        setBusy(false);
        setMsg({ ok: true, text: t("Locația curentă a fost setată.") });
      },
      () => {
        setBusy(false);
        setMsg({ ok: false, text: t("Nu am putut lua locația (permite accesul la locație în browser).") });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  /** Aplică un link / coordonate: direct din text dacă se poate; altfel linkul scurt se rezolvă pe server. */
  async function apply(text: string) {
    const v = text.trim();
    if (!v) return;
    const my = ++seq.current;
    const direct = parseCoordinates(v);
    if (direct && !/^https?:\/\//i.test(v)) {
      setGeo(direct);
      setMapUrl("");
      setLink("");
      setMsg({ ok: true, text: t("Coordonatele au fost setate.") });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await resolveMapLinkAction(v);
      if (my !== seq.current) return;
      if (res.ok) {
        setGeo({ lat: res.lat, lng: res.lng });
        setMapUrl(res.mapUrl ?? (isMapUrl(v) ? v : ""));
        setLink("");
        setMsg({ ok: true, text: t("Locația din link a fost setată.") });
      } else setMsg({ ok: false, text: t(res.error) });
    } catch {
      setMsg({ ok: false, text: t("A apărut o eroare. Încearcă din nou.") });
    } finally {
      if (my === seq.current) setBusy(false);
    }
  }

  const clear = () => {
    setGeo(null);
    setMapUrl("");
    setMsg(null);
  };
  const place = { address, lat: geo?.lat ?? null, lng: geo?.lng ?? null, mapUrl };

  return (
    <div className="flex flex-col gap-2">
      <label className="block text-xs font-semibold text-ink-soft">{t("Locație (opțional)")}</label>
      <input type="hidden" name="lat" value={geo ? String(geo.lat) : ""} />
      <input type="hidden" name="lng" value={geo ? String(geo.lng) : ""} />
      <input type="hidden" name="mapUrl" value={mapUrl} />
      <AddressInput name="address" defaultValue={initial?.address ?? ""} onChange={setAddress} placeholder={t("Adresa (începe să scrii pentru sugestii)")} className={fld} />

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={useMyLocation} disabled={busy} className={btn}>📍 {t("Locația mea")}</button>
        {geo && <button type="button" onClick={clear} className={`${btn} text-st-cancelled`}>✕ {t("Șterge coordonatele")}</button>}
      </div>

      <div className="flex gap-2">
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onPaste={(e) => {
            const txt = e.clipboardData.getData("text");
            if (txt) { e.preventDefault(); setLink(txt); void apply(txt); }
          }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void apply(link); } }}
          placeholder={t("Link Google Maps sau coordonate (47.0245, 28.8322)")}
          className={`${fld} min-w-0 flex-1`}
          inputMode="url"
        />
        <button type="button" onClick={() => void apply(link)} disabled={busy || !link.trim()} className={btn}>{t("Aplică")}</button>
      </div>

      {msg && <p className={`text-xs ${msg.ok ? "text-ink-soft" : "text-st-cancelled"}`}>{msg.text}</p>}
      {geo && (
        <p className="text-xs text-ink-soft">
          ✓ {t("Coordonate")}: <b className="font-mono text-ink">{geo.lat.toFixed(6)}, {geo.lng.toFixed(6)}</b>
          {geo.acc != null && ` (±${geo.acc} m)`}
        </p>
      )}
      {(geo || address.trim() || mapUrl) && <MapOpenButtons place={place} size="sm" />}
    </div>
  );
}
