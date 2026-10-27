"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { saveMeterReadingAction, uploadMeterPhotoAction } from "@/app/actions/meter-readings";
import { parseIndex, type ReadingDto } from "@/lib/meter-readings";
import { optimizeImage } from "@/lib/image-optimize";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";
import { useToast } from "./toast";

type Geo =
  | { state: "asking" }
  | { state: "ok"; lat: number; lng: number; acc: number }
  | { state: "denied" }
  | { state: "unavailable" }
  | { state: "error" };

export type ReadingPatch = Partial<{ value: number; readAt: number; photo: boolean }>;

const inputCls = "h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-lg font-semibold tabular-nums outline-none focus:border-brand";

/**
 * Formularul citirii de luna aceasta pentru UN contor: index (m³), locația luată automat de la telefon (GPS) și poza contorului. Se folosește și în „Citiri teren”,
 * și în pop-up-ul contorului. Locația se pornește când apare formularul (nu înainte), deci telefonul cere permisiunea abia când ajungi la contor.
 * La salvare, indexul intră direct în baza de date; poza se încarcă în stocare și se leagă de citire.
 */
export default function ReadingForm({
  meterId,
  address,
  lastIndex,
  lastDate,
  initialValue,
  initialPhotoUrl = null,
  onSaved,
  onNext,
  onClose,
}: {
  meterId: string;
  /** Adresa contorului — se arată ca să fie clar unde se face citirea (locația GPS se salvează împreună cu indexul). */
  address?: string | null;
  /** Ultimul index cunoscut (m³) și data lui — pentru consumul calculat pe loc. */
  lastIndex: number | null;
  lastDate: string | null;
  /** Indexul deja citit luna aceasta (la corectare). */
  initialValue: number | null;
  initialPhotoUrl?: string | null;
  onSaved?: (patch: ReadingPatch, reading: ReadingDto) => void;
  /** Dacă există: după salvare apare „Următorul contor”. */
  onNext?: () => void;
  onClose?: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const tag = dateTag(useLocale());
  const idxId = useId();
  const nf = (n: number) => n.toLocaleString(tag, { maximumFractionDigits: 3 });
  const [value, setValue] = useState(initialValue != null ? String(initialValue).replace(".", ",") : "");
  const [geo, setGeo] = useState<Geo>({ state: "asking" });
  const [saved, setSaved] = useState<ReadingDto | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(initialPhotoUrl);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const best = useRef<{ lat: number; lng: number; acc: number } | null>(null);
  const watch = useRef<number | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopLocate = useCallback(() => {
    if (watch.current != null && typeof navigator !== "undefined" && navigator.geolocation) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = null;
  }, []);

  /** Pornește locația (GPS precis): păstrează cea mai bună poziție și se oprește singură după ~15 s sau la o precizie de ≤ 15 m. */
  const locate = useCallback(() => {
    stopLocate();
    best.current = null;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeo({ state: "unavailable" });
      return;
    }
    setGeo({ state: "asking" });
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        const cur = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
        if (!best.current || cur.acc <= best.current.acc) best.current = cur;
        setGeo({ state: "ok", ...best.current });
        if (best.current.acc <= 15) stopLocate();
      },
      (e) => {
        if (best.current) return; // avem deja o poziție; ignorăm erorile ulterioare
        setGeo({ state: e.code === 1 ? "denied" : "error" });
        stopLocate();
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
    stopTimer.current = setTimeout(stopLocate, 15_000);
  }, [stopLocate]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    locate(); // locația se pornește singură când apare formularul, pentru contorul respectiv
    return stopLocate;
  }, [locate, stopLocate]);

  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const prev = lastIndex;
  const parsed = parseIndex(value);
  const consum = parsed != null && prev != null ? parsed - prev : null;

  async function uploadPhoto(readingId: string, file: File, reading: ReadingDto) {
    const small = await optimizeImage(file);
    const fd = new FormData();
    fd.set("readingId", readingId);
    fd.set("file", small);
    const res = await uploadMeterPhotoAction(fd);
    if (res.ok) {
      setPhotoUrl(res.photoUrl);
      setPhoto(null);
      onSaved?.({ photo: true }, { ...reading, photoUrl: res.photoUrl });
      toast.success(t("Poza a fost salvată."));
    } else {
      toast.error(t(res.error));
    }
    return res.ok;
  }

  async function save(confirmed = false) {
    setErr(null);
    if (parsed == null) {
      setErr(t("Index invalid. Scrie un număr (m³), ex. 1234,5."));
      return;
    }
    if (geo.state !== "ok" && !confirmed && !window.confirm(t("Locația nu a fost obținută. Salvezi citirea fără locație?"))) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("meterId", meterId);
      fd.set("value", value);
      if (geo.state === "ok") {
        fd.set("lat", String(geo.lat));
        fd.set("lng", String(geo.lng));
        fd.set("accuracy", String(Math.round(geo.acc)));
      }
      if (confirmed) fd.set("confirmed", "1");
      const res = await saveMeterReadingAction(fd);
      if (!res.ok) {
        if (res.confirm) {
          const msg =
            res.confirm === "lower"
              ? t("Indexul scris ({v} m³) este MAI MIC decât cel anterior ({p} m³). Salvezi oricum (de ex. contor înlocuit)?", { v: nf(parsed), p: nf(prev ?? 0) })
              : t("Consumul ar fi de {c} m³ într-o lună — neobișnuit de mare. Salvezi oricum?", { c: nf(consum ?? 0) });
          if (window.confirm(msg)) {
            setBusy(false);
            await save(true);
          }
          return;
        }
        setErr(t(res.error));
        return;
      }
      setSaved(res.reading);
      setPhotoUrl(res.reading.photoUrl);
      onSaved?.({ value: res.reading.value, readAt: new Date(res.reading.readAt).getTime(), photo: !!res.reading.photoUrl }, res.reading);
      toast.success(t("Citirea a fost salvată."));
      if (photo) await uploadPhoto(res.reading.id, photo, res.reading);
    } catch {
      setErr(t("Nu am putut salva. Verifică conexiunea și încearcă din nou."));
    } finally {
      setBusy(false);
    }
  }

  async function onPhotoPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (saved) {
      setBusy(true);
      setPhoto(f);
      await uploadPhoto(saved.id, f, saved);
      setBusy(false);
    } else {
      setPhoto(f);
    }
  }

  const geoText =
    geo.state === "ok"
      ? t("Locație obținută: {lat}, {lng} (±{acc} m)", { lat: geo.lat.toFixed(5), lng: geo.lng.toFixed(5), acc: Math.round(geo.acc) })
      : geo.state === "asking"
        ? t("Se caută locația…")
        : geo.state === "denied"
          ? t("Locația este blocată. Permite accesul la locație pentru acest site în setările telefonului.")
          : geo.state === "unavailable"
            ? t("Acest telefon nu poate furniza locația.")
            : t("Nu am putut obține locația.");

  return (
    <div>
      {address && (
        <p className="mb-3 flex items-start gap-1.5 text-sm">
          <span aria-hidden>🏠</span>
          <span className="min-w-0">{address}</span>
        </p>
      )}
      <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-[var(--color-surface-2)] px-3 py-2">
          <p className="text-[11px] text-ink-soft">{t("Index anterior")}</p>
          <p className="font-bold tabular-nums">{prev != null ? `${nf(prev)} m³` : "—"}</p>
          {lastDate && <p className="text-[11px] text-ink-soft">{lastDate.split("-").reverse().join(".")}</p>}
        </div>
        <div className="rounded-xl bg-[var(--color-surface-2)] px-3 py-2">
          <p className="text-[11px] text-ink-soft">{t("Consum")}</p>
          <p className={`font-bold tabular-nums ${consum != null && consum < 0 ? "text-st-cancelled" : ""}`}>{consum != null ? `${nf(consum)} m³` : "—"}</p>
        </div>
      </div>

      <label className="mb-1 block text-xs font-semibold text-ink-soft" htmlFor={idxId}>
        {t("Indexul contorului (m³) — luna aceasta")}
      </label>
      <input
        id={idxId}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && !busy && void save()}
        inputMode="decimal"
        autoFocus
        autoComplete="off"
        placeholder={prev != null ? nf(prev) : "0"}
        className={inputCls}
      />

      <div className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-[13px] ${geo.state === "ok" ? "border-st-done/40 bg-st-done/5" : geo.state === "asking" ? "border-[var(--color-line)]" : "border-st-progress/40 bg-st-progress/10"}`} role="status">
        <span aria-hidden>{geo.state === "ok" ? "📍" : geo.state === "asking" ? "⏳" : "⚠️"}</span>
        <span className="min-w-0 flex-1">{geoText}</span>
        {geo.state !== "asking" && (
          <button type="button" onClick={locate} className="tap shrink-0 font-semibold text-brand underline">
            {t("Reia")}
          </button>
        )}
      </div>

      <div className="mt-3">
        <p className="mb-1 text-xs font-semibold text-ink-soft">{t("Poza contorului (opțional)")}</p>
        {(preview || photoUrl) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview ?? photoUrl ?? ""} alt={t("Poza contorului")} className="mb-2 max-h-48 w-full rounded-xl border border-[var(--color-line)] object-cover" />
        )}
        <label className="tap inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--color-line)] px-3 text-sm font-medium hover:bg-brand-soft">
          📷 {photo || photoUrl ? t("Schimbă poza") : t("Fă o poză")}
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={onPhotoPicked} disabled={busy} />
        </label>
      </div>

      {err && <p className="mt-3 rounded-lg bg-st-cancelled/10 px-3 py-2 text-sm text-st-cancelled">{err}</p>}
      {saved?.distanceM != null && saved.distanceM > 150 && (
        <p className="mt-3 rounded-lg bg-st-progress/10 px-3 py-2 text-sm text-st-progress">{t("Atenție: ești la {n} m de locația citirii anterioare a acestui contor.", { n: saved.distanceM })}</p>
      )}
      {saved && <p className="mt-3 rounded-lg bg-st-done/10 px-3 py-2 text-sm font-medium text-st-done">✓ {t("Citire salvată: {v} m³", { v: nf(saved.value) })}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!saved ? (
          <button type="button" onClick={() => void save()} disabled={busy || parsed == null} className="tap h-11 flex-1 cursor-pointer rounded-xl bg-brand px-4 text-base font-semibold text-white hover:bg-brand-strong disabled:opacity-50">
            {busy ? t("Se salvează…") : initialValue != null ? t("Corectează citirea") : t("Salvează citirea")}
          </button>
        ) : (
          <>
            {onNext && (
              <button type="button" onClick={onNext} className="tap h-11 flex-1 cursor-pointer rounded-xl bg-brand px-4 text-base font-semibold text-white hover:bg-brand-strong">
                {t("Următorul contor")} →
              </button>
            )}
            {onClose && (
              <button type="button" onClick={onClose} className="tap h-11 cursor-pointer rounded-xl border border-[var(--color-line)] px-4 text-sm font-medium hover:bg-[var(--color-surface-2)]">
                {t("Închide")}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
