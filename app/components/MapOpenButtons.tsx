"use client";

import { appleMapsUrl, googleMapsUrl, wazeUrl, type Place } from "@/lib/map-links";
import { useT } from "@/lib/i18n/context";

/**
 * Butoanele „Deschide în …” pentru o locație: Google Maps, Apple Maps, Waze. Fiecare se deschide într-o fereastră nouă (pe telefon pornește aplicația, dacă e instalată).
 * Un buton apare doar dacă se poate construi linkul (fie adresă, fie coordonate).
 */
export default function MapOpenButtons({ place, className = "", size = "md" }: { place: Place; className?: string; size?: "sm" | "md" }) {
  const t = useT();
  const items = [
    { key: "g", href: googleMapsUrl(place), label: "🗺 Google Maps" },
    { key: "a", href: appleMapsUrl(place), label: "🍎 Apple Maps" },
    { key: "w", href: wazeUrl(place), label: "🚗 Waze" },
  ].filter((i): i is { key: string; href: string; label: string } => !!i.href);
  if (items.length === 0) return null;
  const cls =
    size === "sm"
      ? "tap inline-flex h-7 cursor-pointer items-center rounded-lg border border-[var(--color-line)] px-2 text-[11px] font-medium hover:bg-brand-soft"
      : "tap inline-flex h-9 cursor-pointer items-center rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium hover:bg-brand-soft";
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {items.map((i) => (
        <a key={i.key} href={i.href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className={cls}>
          {t(i.label)}
        </a>
      ))}
    </div>
  );
}
