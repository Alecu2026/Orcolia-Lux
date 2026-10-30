"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { meterAverageAction, reportMeterIssueAction, saveMeterReadingAction, uploadMeterPhotoAction } from "@/app/actions/meter-readings";
import { ISSUE_KINDS, ISSUE_LABELS, MAX_ISSUE_NOTE, isIssueKind } from "@/lib/meter-issues";
import { MAX_ADDRESS, MAX_LOC_ACCURACY, checkConsum, deviationPct, mapsUrl, parseIndex, type ConsumAvg, type MeterLocationDto, type ReadingDto } from "@/lib/meter-readings";
import { optimizeImage } from "@/lib/image-optimize";
import { thumbUrl } from "@/lib/files-url";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";
import { useToast } from "./toast";
import { enqueueReading, useFieldQueue, type QueueItem } from "./field-queue";

type Geo =
  | { state: "asking" }
  | { state: "ok"; lat: number; lng: number; acc: number }
  | { state: "denied" }
  | { state: "unavailable" }
  | { state: "error" };

export type ReadingPatch = Partial<{ value: number; readAt: number; photo: boolean }>;

const addrCls = "h-10 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";

const inputCls = "h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-lg font-semibold tabular-nums outline-none focus:border-brand";

/** Media lunară a fiecărui contor deschis în această sesiune: ca la reluarea formularului (sau fără internet, după ce a fost descărcată) avertismentele să rămână cu medie. */
const avgCache = new Map<string, ConsumAvg | null>();

/**
 * Formularul citirii de luna aceasta pentru UN contor: index (m³), locația luată automat de la telefon (GPS) și poza contorului. Se folosește și în „Citiri teren”,
 * și în pop-up-ul contorului. Locația se pornește când apare formularul (nu înainte), deci telefonul cere permisiunea abia când ajungi la contor.
 * La salvare, indexul intră direct în baza de date; poza se încarcă în stocare și se leagă de citire.
 */
export default function ReadingForm({
  meterId,
  address,
  addressEditable = false,
  meterLat = null,
  meterLng = null,
  meterAcc = null,
  lastIndex,
  lastDate,
  lastEstimated = false,
  initialValue,
  initialPhotoUrl = null,
  onSaved,
  onNext,
  onClose,
  contor,
  meterName,
  onQueued,
  openIssue = null,
  onIssue,
}: {
  meterId: string;
  /** Adresa contorului — se arată ca să fie clar unde se face citirea (locația GPS se salvează împreună cu indexul). */
  address?: string | null;
  /** Contorul n-are adresă în 1C: se poate scrie aici (de pe teren) și rămâne salvată pentru lunile următoare. */
  addressEditable?: boolean;
  /** Locația GPS a contorului, dacă a fost deja salvată. */
  meterLat?: number | null;
  meterLng?: number | null;
  /** Precizia (m) a locației de mai sus. */
  meterAcc?: number | null;
  /** Ultimul index cunoscut (m³) și data lui — pentru consumul calculat pe loc. */
  lastIndex: number | null;
  lastDate: string | null;
  /** Ultimul index e calculat (estimat), nu citit: se arată ca avertisment, cititorul îl verifică. */
  lastEstimated?: boolean;
  /** Indexul deja citit luna aceasta (la corectare). */
  initialValue: number | null;
  initialPhotoUrl?: string | null;
  onSaved?: (patch: ReadingPatch, reading: ReadingDto, location?: MeterLocationDto) => void;
  /** Dacă există: după salvare apare „Următorul contor”. */
  onNext?: () => void;
  onClose?: () => void;
  /** Nr. contorului și abonatul — pentru coada de pe telefon (afișare). */
  contor?: string;
  meterName?: string;
  /** Citirea a fost salvată pe telefon (fără internet): se trimite singură mai târziu. */
  onQueued?: (item: QueueItem) => void;
  /** Neregula deja deschisă pentru contor (cod), dacă există. */
  openIssue?: string | null;
  /** Neregula a fost raportată (rândul din listă se marchează). */
  onIssue?: (kind: string) => void;
}) {
  const t = useT();
  const toast = useToast();
  const tag = dateTag(useLocale());
  const idxId = useId();
  const addrId = useId();
  const nf = (n: number) => n.toLocaleString(tag, { maximumFractionDigits: 3 });
  const [addr, setAddr] = useState(address ?? "");
  const [value, setValue] = useState(initialValue != null ? String(initialValue).replace(".", ",") : "");
  const [geo, setGeo] = useState<Geo>({ state: "asking" });
  const [saved, setSaved] = useState<ReadingDto | null>(null);
  /** Citirea e salvată doar pe telefon (fără internet) și așteaptă trimiterea. */
  const [queued, setQueued] = useState<{ value: number | null } | null>(null);
  /** Starea contorului: gol = normal; altfel codul neregulii găsite + observații. */
  const [issueKind, setIssueKind] = useState<string>("");
  const [issueNote, setIssueNote] = useState("");
  /** Neregula a fost raportată (fără index) — formularul se încheie ca după o salvare. */
  const [issueDone, setIssueDone] = useState<string | null>(null);
  const { online } = useFieldQueue();
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

  /** Consumul mediu lunar al contorului (din ultimele luni); null cât se încarcă, fără internet sau când istoricul e prea scurt. */
  const [avg, setAvg] = useState<ConsumAvg | null>(() => avgCache.get(meterId) ?? null);
  useEffect(() => {
    if (avgCache.has(meterId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAvg(avgCache.get(meterId) ?? null);
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    let alive = true;
    meterAverageAction(meterId)
      .then((a) => {
        avgCache.set(meterId, a);
        if (alive) setAvg(a);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [meterId]);

  const prev = lastIndex;
  const parsed = parseIndex(value);
  const consum = parsed != null && prev != null ? parsed - prev : null;
  /** Abaterea consumului de acum față de medie, în % (semnată), și dacă e neobișnuită. */
  const dev = consum != null && consum >= 0 && avg ? deviationPct(consum, avg.avg) : null;
  const devWarn = checkConsum(consum, avg?.avg) != null;

  /** Textul „Salvezi oricum?” pentru un consum neobișnuit; cu media contorului arată și cu cât se abate (în %). */
  function consumWarning(kind: "high" | "low", c: number, a: ConsumAvg | null, pct: number | null): string {
    if (a && pct != null) {
      return kind === "high"
        ? t("Consumul ar fi de {c} m³ — cu {p}% peste media lunară a contorului ({a} m³). Salvezi oricum?", { c: nf(c), p: nf(Math.abs(pct)), a: nf(a.avg) })
        : t("Consumul ar fi de {c} m³ — cu {p}% sub media lunară a contorului ({a} m³). Salvezi oricum?", { c: nf(c), p: nf(Math.abs(pct)), a: nf(a.avg) });
    }
    return t("Consumul ar fi de {c} m³ într-o lună — neobișnuit de mare. Salvezi oricum?", { c: nf(c) });
  }

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

  /** Fără internet: citirea (cu locația și poza) se salvează pe telefon și pleacă singură când revine conexiunea. */
  async function saveOffline(confirmedAlready: boolean) {
    if (parsed == null && !issueKind) return;
    let conf = confirmedAlready;
    // aceleași avertismente ca pe server, calculate din indexul anterior descărcat
    if (parsed != null && !conf && prev != null) {
      if (parsed < prev) {
        if (!window.confirm(t("Indexul scris ({v} m³) este MAI MIC decât cel anterior ({p} m³). Salvezi oricum (de ex. contor înlocuit)?", { v: nf(parsed), p: nf(prev) }))) return;
        conf = true;
      } else {
        // aceeași regulă ca pe server: față de media contorului (dacă a fost descărcată), altfel față de pragul fix
        const c = parsed - prev;
        const chk = checkConsum(c, avg?.avg);
        if (chk) {
          if (!window.confirm(consumWarning(chk.kind, c, avg, chk.pct))) return;
          conf = true;
        }
      }
    }
    setBusy(true);
    try {
      const small = photo ? await optimizeImage(photo) : null;
      const item = await enqueueReading({
        meterId,
        contor: contor ?? meterId,
        name: meterName ?? "",
        value: parsed,
        issueKind: issueKind || null,
        issueNote: issueKind ? issueNote.trim().slice(0, MAX_ISSUE_NOTE) || null : null,
        lat: geo.state === "ok" ? geo.lat : null,
        lng: geo.state === "ok" ? geo.lng : null,
        accuracy: geo.state === "ok" ? Math.round(geo.acc) : null,
        address: addressEditable && addr.trim() ? addr.trim() : null,
        confirmed: conf,
        photo: small,
        photoName: small?.name ?? null,
      });
      setQueued({ value: parsed });
      toast.success(parsed != null ? t("Citirea e salvată pe telefon.") : t("Neregula e salvată pe telefon."));
      if (issueKind) onIssue?.(issueKind);
      onQueued?.(item);
    } catch {
      setErr(t("Nu am putut salva pe telefon (spațiu insuficient?)."));
    } finally {
      setBusy(false);
    }
  }

  async function save(confirmed = false) {
    setErr(null);
    if (issueKind === "OTHER" && !issueNote.trim()) {
      setErr(t("Descrie problema în observații."));
      return;
    }
    if (parsed == null) {
      if (!issueKind) {
        setErr(t("Index invalid. Scrie un număr (m³), ex. 1234,5."));
        return;
      }
      // doar neregula, fără index (ex. contor inaccesibil)
      if (!navigator.onLine) {
        await saveOffline(true);
        return;
      }
      setBusy(true);
      try {
        const fd = new FormData();
        fd.set("meterId", meterId);
        fd.set("issueKind", issueKind);
        fd.set("issueNote", issueNote.trim());
        const r = await reportMeterIssueAction(fd);
        if (!r.ok) {
          setErr(t(r.error));
          return;
        }
        setIssueDone(issueKind);
        onIssue?.(issueKind);
        toast.success(t("Neregula a fost raportată."));
      } catch (e) {
        if (!navigator.onLine || e instanceof TypeError) {
          setBusy(false);
          await saveOffline(true);
          return;
        }
        setErr(t("Nu am putut salva. Verifică conexiunea și încearcă din nou."));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (geo.state !== "ok" && !confirmed && !window.confirm(t("Locația nu a fost obținută. Salvezi citirea fără locație?"))) return;
    if (!navigator.onLine) {
      await saveOffline(confirmed);
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("meterId", meterId);
      fd.set("value", value);
      if (addressEditable && addr.trim()) fd.set("address", addr.trim());
      if (geo.state === "ok") {
        fd.set("lat", String(geo.lat));
        fd.set("lng", String(geo.lng));
        fd.set("accuracy", String(Math.round(geo.acc)));
      }
      if (confirmed) fd.set("confirmed", "1");
      if (issueKind) {
        fd.set("issueKind", issueKind);
        fd.set("issueNote", issueNote.trim());
      }
      const res = await saveMeterReadingAction(fd);
      if (!res.ok) {
        if (res.confirm) {
          const msg =
            res.confirm === "lower"
              ? t("Indexul scris ({v} m³) este MAI MIC decât cel anterior ({p} m³). Salvezi oricum (de ex. contor înlocuit)?", { v: nf(parsed), p: nf(prev ?? 0) })
              : consumWarning(res.confirm, consum ?? 0, res.avg ?? avg, res.pct ?? null);
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
      onSaved?.({ value: res.reading.value, readAt: new Date(res.reading.readAt).getTime(), photo: !!res.reading.photoUrl }, res.reading, res.location);
      toast.success(t("Citirea a fost salvată."));
      if (res.issue) {
        setIssueDone(res.issue.kind);
        onIssue?.(res.issue.kind);
      } else if (res.issueError) toast.error(t(res.issueError));
      if (photo) await uploadPhoto(res.reading.id, photo, res.reading);
    } catch (e) {
      // conexiunea a căzut chiar la salvare: citirea nu se pierde, se salvează pe telefon
      if (!navigator.onLine || e instanceof TypeError) {
        setBusy(false);
        await saveOffline(confirmed);
        return;
      }
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
      {addressEditable ? (
        <div className="mb-3">
          <label htmlFor={addrId} className="mb-1 block text-xs font-semibold text-ink-soft">
            🏠 {t("Adresa contorului")}
          </label>
          <input
            id={addrId}
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            maxLength={MAX_ADDRESS}
            autoComplete="off"
            disabled={!!saved || !!queued}
            placeholder={t("Localitate, strada, nr. (1C nu are adresa acestui contor)")}
            className={addrCls}
          />
        </div>
      ) : (
        address && (
          <p className="mb-3 flex items-start gap-1.5 text-sm">
            <span aria-hidden>🏠</span>
            <span className="min-w-0">{address}</span>
          </p>
        )
      )}
      {meterLat != null && meterLng != null && (
        <p className="mb-3 text-xs text-ink-soft">
          📌 {t("Locația contorului:")} {meterLat.toFixed(5)}, {meterLng.toFixed(5)}{meterAcc != null ? ` (±${Math.round(meterAcc)} m${meterAcc > MAX_LOC_ACCURACY ? ` — ${t("imprecisă")}` : ""})` : ""} ·{" "}
          <a href={mapsUrl(meterLat, meterLng)} target="_blank" rel="noreferrer" className="font-semibold text-brand underline">{t("Vezi pe hartă")}</a>
        </p>
      )}
      <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-[var(--color-surface-2)] px-3 py-2">
          <p className="text-[11px] text-ink-soft">{t("Index anterior")}</p>
          <p className="font-bold tabular-nums">{prev != null ? `${nf(prev)} m³` : "—"}</p>
          {lastDate && <p className="text-[11px] text-ink-soft">{lastDate.split("-").reverse().join(".")}</p>}
          {lastEstimated && <p className="text-[11px] font-semibold text-st-progress">≈ {t("Index estimat (calculat)")}</p>}
        </div>
        <div className="rounded-xl bg-[var(--color-surface-2)] px-3 py-2">
          <p className="text-[11px] text-ink-soft">{t("Consum")}</p>
          <p className={`font-bold tabular-nums ${(consum != null && consum < 0) || devWarn ? "text-st-cancelled" : ""}`}>{consum != null ? `${devWarn ? "⚠ " : ""}${nf(consum)} m³` : "—"}</p>
          {dev != null && <p className={`text-[11px] font-semibold tabular-nums ${devWarn ? "text-st-cancelled" : "text-ink-soft"}`}>{dev > 0 ? "+" : ""}{nf(dev)}% {t("față de medie")}</p>}
        </div>
        {avg && (
          <div className="col-span-2 rounded-xl bg-[var(--color-surface-2)] px-3 py-2">
            <p className="text-[11px] text-ink-soft">{t("Consum mediu lunar")}</p>
            <p className="font-bold tabular-nums">{t("{v} m³ (din ultimele {n} citiri)", { v: nf(avg.avg), n: avg.count })}</p>
          </div>
        )}
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

      <div className="mt-3">
        <label className="mb-1 block text-xs font-semibold text-ink-soft" htmlFor={`${idxId}-issue`}>
          {t("Starea contorului")}
        </label>
        <select
          id={`${idxId}-issue`}
          value={issueKind}
          onChange={(e) => setIssueKind(e.target.value)}
          disabled={!!saved || !!queued || !!issueDone}
          className={`h-10 w-full rounded-xl border bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand ${issueKind ? "border-st-cancelled/60" : "border-[var(--color-line)]"}`}
        >
          <option value="">{t("Normal — fără probleme")}</option>
          {ISSUE_KINDS.map((k) => (
            <option key={k} value={k}>{t(ISSUE_LABELS[k])}</option>
          ))}
        </select>
        {issueKind && !saved && !queued && !issueDone && (
          <textarea
            value={issueNote}
            onChange={(e) => setIssueNote(e.target.value)}
            maxLength={MAX_ISSUE_NOTE}
            rows={2}
            placeholder={issueKind === "OTHER" ? t("Descrie problema (obligatoriu)") : t("Observații (opțional)")}
            className="mt-2 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-brand"
          />
        )}
        {openIssue && isIssueKind(openIssue) && !issueDone && (
          <p className="mt-1.5 text-xs text-st-cancelled">⚑ {t("Neregulă deschisă la acest contor:")} {t(ISSUE_LABELS[openIssue])}</p>
        )}
      </div>

      <div className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-[13px] ${geo.state === "ok" ? "border-st-done/40 bg-st-done/5" : geo.state === "asking" ? "border-[var(--color-line)]" : "border-st-progress/40 bg-st-progress/10"}`} role="status">
        <span aria-hidden>{geo.state === "ok" ? "📍" : geo.state === "asking" ? "⏳" : "⚠️"}</span>
        <span className="min-w-0 flex-1">
          {geoText}
          {geo.state === "ok" && geo.acc > MAX_LOC_ACCURACY && (
            <span className="mt-0.5 block text-st-progress">{t("Precizie slabă (±{acc} m): nu se salvează ca poziție a contorului. Ieși într-un loc deschis și apasă „Reia”.", { acc: Math.round(geo.acc) })}</span>
          )}
        </span>
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
          <img src={preview ?? (photoUrl ? thumbUrl(photoUrl, 640) : "")} decoding="async" alt={t("Poza contorului")} className="mb-2 max-h-48 w-full rounded-xl border border-[var(--color-line)] object-cover" />
        )}
        <label className="tap inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--color-line)] px-3 text-sm font-medium hover:bg-brand-soft">
          📷 {photo || photoUrl ? t("Schimbă poza") : t("Fă o poză")}
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={onPhotoPicked} disabled={busy || !!queued} />
        </label>
      </div>

      {err && <p className="mt-3 rounded-lg bg-st-cancelled/10 px-3 py-2 text-sm text-st-cancelled">{err}</p>}
      {saved?.distanceM != null && saved.distanceM > 150 && (
        <p className="mt-3 rounded-lg bg-st-progress/10 px-3 py-2 text-sm text-st-progress">{t("Atenție: ești la {n} m de locația citirii anterioare a acestui contor.", { n: saved.distanceM })}</p>
      )}
      {saved && <p className="mt-3 rounded-lg bg-st-done/10 px-3 py-2 text-sm font-medium text-st-done">✓ {t("Citire salvată: {v} m³", { v: nf(saved.value) })}</p>}
      {queued && (
        <p className="mt-3 rounded-lg bg-st-progress/10 px-3 py-2 text-sm font-medium text-st-progress">
          ⏳ {queued.value != null ? t("Salvat pe telefon: {v} m³ — se trimite singur când ai internet.", { v: nf(queued.value) }) : t("Neregula e salvată pe telefon — se trimite singură când ai internet.")}
        </p>
      )}
      {issueDone && isIssueKind(issueDone) && (
        <p className="mt-3 rounded-lg bg-st-cancelled/10 px-3 py-2 text-sm font-medium text-st-cancelled">⚑ {t("Neregulă raportată:")} {t(ISSUE_LABELS[issueDone])}</p>
      )}
      {!online && !saved && !queued && (
        <p className="mt-3 rounded-lg bg-st-progress/10 px-3 py-2 text-xs text-st-progress">📴 {t("Fără internet — citirea se salvează pe telefon și pleacă singură când revine conexiunea.")}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!saved && !queued && !issueDone ? (
          <button type="button" onClick={() => void save()} disabled={busy || (parsed == null && !issueKind)} className="tap h-11 flex-1 cursor-pointer rounded-xl bg-brand px-4 text-base font-semibold text-white hover:bg-brand-strong disabled:opacity-50">
            {busy ? t("Se salvează…") : parsed == null && issueKind ? t("Raportează doar neregula (fără index)") : initialValue != null ? t("Corectează citirea") : t("Salvează citirea")}
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
