"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { saveMeterReadingAction, uploadMeterPhotoAction } from "@/app/actions/meter-readings";
import { decodeField, parseIndex, type FieldRow, type FieldTuple, type ReadingDto } from "@/lib/meter-readings";
import { optimizeImage } from "@/lib/image-optimize";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";
import { IconX } from "./icons";
import { useToast } from "./toast";
import VirtualList from "./VirtualList";

type Tab = "unread" | "read" | "all";
type Geo =
  | { state: "asking" }
  | { state: "ok"; lat: number; lng: number; acc: number }
  | { state: "denied" }
  | { state: "unavailable" }
  | { state: "error" };

const inputCls = "h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-lg font-semibold tabular-nums outline-none focus:border-brand";

/**
 * „Citiri teren": persoana responsabilă parcurge contoarele (în ordinea adreselor), scrie indexul lunii curente (m³), locația se ia automat de la telefon,
 * iar poza contorului se poate adăuga pe loc. Tot ce se salvează intră direct în baza de date (nu modifică facturile).
 */
export default function FieldReadings({ openId, canViewMeter }: { openId: string | null; canViewMeter: boolean }) {
  const t = useT();
  const tag = dateTag(useLocale());
  const [data, setData] = useState<{ period: string; rows: FieldRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("unread");
  const [selId, setSelId] = useState<string | null>(openId);
  const dq = useDeferredValue(q);

  useEffect(() => {
    const ctl = new AbortController();
    fetch("/api/contoare/teren", { signal: ctl.signal })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Eroare la încărcare.");
        return j as { period: string; rows: FieldTuple[] };
      })
      .then((j) => setData({ period: j.period, rows: decodeField(j.rows) }))
      .catch((e: Error) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => ctl.abort();
  }, [tick]);

  const done = useMemo(() => (data ? data.rows.reduce((n, r) => (r.value != null ? n + 1 : n), 0) : 0), [data]);
  const list = useMemo(() => {
    if (!data) return [];
    const tokens = dq.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5);
    return data.rows.filter((r) => {
      if (tab === "unread" ? r.value != null : tab === "read" ? r.value == null : false) return false;
      for (const tk of tokens) if (!r._h.includes(tk)) return false;
      return true;
    });
  }, [data, dq, tab]);

  const selected = selId && data ? (data.rows.find((r) => r.id === selId) ?? null) : null;

  const onSaved = useCallback((id: string, patch: Partial<{ value: number; readAt: number; photo: boolean }>) => {
    setData((d) => (d ? { ...d, rows: d.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) } : d));
  }, []);

  /** Următorul contor necitit după cel dat: întâi în lista curentă (filtre), apoi — dacă n-a mai rămas niciunul acolo — în toată lista (ordinea adreselor). */
  const nextUnread = useCallback(
    (afterId: string) => {
      const find = (rows: FieldRow[]) => {
        const i = rows.findIndex((r) => r.id === afterId);
        for (let k = i + 1; k < rows.length; k++) if (rows[k].value == null) return rows[k].id;
        for (let k = 0; k < i; k++) if (rows[k].value == null) return rows[k].id;
        return null;
      };
      return find(list) ?? (data ? find(data.rows) : null);
    },
    [list, data],
  );

  const monthLabel = data
    ? (() => {
        const s = new Date(Number(data.period.slice(0, 4)), Number(data.period.slice(5, 7)) - 1, 1).toLocaleDateString(tag, { month: "long", year: "numeric" });
        return s.charAt(0).toUpperCase() + s.slice(1);
      })()
    : "";
  const total = data?.rows.length ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div>
      <div className="card mb-3 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold">{monthLabel || "…"}</p>
          <p className="text-sm">
            <b className="tabular-nums">{done.toLocaleString(tag)}</b> {t("din")} <span className="tabular-nums">{total.toLocaleString(tag)}</span> {t("contoare citite")} · <b className="tabular-nums">{pct}%</b>
          </p>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("Caută nr. contor, adresă, abonat…")}
          aria-label={t("Căutare")}
          className="h-10 min-w-48 flex-1 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-sm outline-none focus:border-brand"
        />
        <div className="flex overflow-hidden rounded-xl border border-[var(--color-line)] text-sm" role="tablist">
          {(["unread", "read", "all"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`tap h-10 px-3 font-medium ${tab === k ? "bg-brand text-white" : "bg-[var(--color-surface)] text-ink-soft hover:bg-[var(--color-surface-2)]"}`}
            >
              {k === "unread" ? t("Necitite") : k === "read" ? t("Citite") : t("Toate")}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="mb-2 flex items-center justify-between gap-3 rounded-lg bg-st-cancelled/10 px-3 py-2 text-sm text-st-cancelled">
          {t(error)}
          <button type="button" onClick={() => { setError(null); setTick((n) => n + 1); }} className="tap shrink-0 font-semibold underline">
            {t("Reîncearcă")}
          </button>
        </p>
      )}

      {!data && !error ? (
        <div className="card p-8 text-center text-ink-soft">{t("se încarcă lista completă…")}</div>
      ) : list.length === 0 ? (
        <div className="card p-8 text-center text-ink-soft">{tab === "unread" && !q ? t("Toate contoarele au fost citite luna aceasta. 🎉") : t("Niciun contor cu filtrele acestea.")}</div>
      ) : (
        <VirtualList
          count={list.length}
          estimate={68}
          gap={6}
          itemKey={(i) => list[i].id}
          render={(i) => {
            const r = list[i];
            return (
              <button
                type="button"
                onClick={() => setSelId(r.id)}
                className={`tap flex w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-left ${r.value != null ? "border-st-done/40 bg-st-done/5" : "border-[var(--color-line)] bg-[var(--color-surface)] hover:bg-brand-soft/40"}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-[15px] font-bold">{r.contor}</span>
                  <span className="block truncate text-[13px]">{r.address ?? "—"}</span>
                  <span className="block truncate text-[11px] text-ink-soft">{r.name}</span>
                </span>
                <span className="shrink-0 text-right text-[12px]">
                  {r.value != null ? (
                    <>
                      <span className="block text-base font-bold tabular-nums text-st-done">✓ {r.value.toLocaleString(tag, { maximumFractionDigits: 3 })} m³</span>
                      <span className="block text-ink-soft">{r.readAt ? new Date(r.readAt).toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" }) : ""}{r.photo ? " · 📷" : ""}</span>
                    </>
                  ) : (
                    <>
                      <span className="block text-ink-soft">{t("Anterior")}</span>
                      <span className="block font-semibold tabular-nums">{r.lastIndex != null ? `${r.lastIndex.toLocaleString(tag, { maximumFractionDigits: 3 })} m³` : "—"}</span>
                    </>
                  )}
                </span>
              </button>
            );
          }}
        />
      )}

      {selected && (
        <ReadingDialog
          key={selected.id}
          row={selected}
          canViewMeter={canViewMeter}
          onClose={() => setSelId(null)}
          onSaved={onSaved}
          onNext={() => setSelId(nextUnread(selected.id))}
        />
      )}
    </div>
  );
}

/** Fereastra de citire a unui contor: index (m³), locația luată automat, poză. */
function ReadingDialog({
  row,
  canViewMeter,
  onClose,
  onSaved,
  onNext,
}: {
  row: FieldRow;
  canViewMeter: boolean;
  onClose: () => void;
  onSaved: (id: string, patch: Partial<{ value: number; readAt: number; photo: boolean }>) => void;
  onNext: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const tag = dateTag(useLocale());
  const nf = (n: number) => n.toLocaleString(tag, { maximumFractionDigits: 3 });
  const [value, setValue] = useState(row.value != null ? String(row.value).replace(".", ",") : "");
  const [geo, setGeo] = useState<Geo>({ state: "asking" });
  const [saved, setSaved] = useState<ReadingDto | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
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
    locate(); // locația se pornește singură la deschiderea ferestrei, pentru contorul respectiv
    return stopLocate;
  }, [locate, stopLocate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const prev = row.lastIndex;
  const parsed = parseIndex(value);
  const consum = parsed != null && prev != null ? parsed - prev : null;

  async function uploadPhoto(readingId: string, file: File) {
    const small = await optimizeImage(file);
    const fd = new FormData();
    fd.set("readingId", readingId);
    fd.set("file", small);
    const res = await uploadMeterPhotoAction(fd);
    if (res.ok) {
      setPhotoUrl(res.photoUrl);
      setPhoto(null);
      onSaved(row.id, { photo: true });
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
      fd.set("meterId", row.id);
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
      onSaved(row.id, { value: res.reading.value, readAt: new Date(res.reading.readAt).getTime(), photo: !!res.reading.photoUrl });
      toast.success(t("Citirea a fost salvată."));
      if (photo) await uploadPhoto(res.reading.id, photo);
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
      await uploadPhoto(saved.id, f);
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card max-h-[94dvh] w-full max-w-md overflow-auto rounded-b-none rounded-t-2xl p-4 sm:rounded-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-mono text-xl font-bold">{row.contor}</h2>
            <p className="text-sm">{row.address ?? "—"}</p>
            <p className="text-xs text-ink-soft">{row.name}</p>
          </div>
          <button onClick={onClose} className="tap grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={t("Închide")}>
            <IconX className="size-4" />
          </button>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl bg-[var(--color-surface-2)] px-3 py-2">
            <p className="text-[11px] text-ink-soft">{t("Index anterior")}</p>
            <p className="font-bold tabular-nums">{prev != null ? `${nf(prev)} m³` : "—"}</p>
            {row.lastDate && <p className="text-[11px] text-ink-soft">{row.lastDate.split("-").reverse().join(".")}</p>}
          </div>
          <div className="rounded-xl bg-[var(--color-surface-2)] px-3 py-2">
            <p className="text-[11px] text-ink-soft">{t("Consum")}</p>
            <p className={`font-bold tabular-nums ${consum != null && consum < 0 ? "text-st-cancelled" : ""}`}>{consum != null ? `${nf(consum)} m³` : "—"}</p>
          </div>
        </div>

        <label className="mb-1 block text-xs font-semibold text-ink-soft" htmlFor="idx">
          {t("Indexul contorului (m³) — luna aceasta")}
        </label>
        <input
          id="idx"
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
              {busy ? t("Se salvează…") : row.value != null ? t("Corectează citirea") : t("Salvează citirea")}
            </button>
          ) : (
            <>
              <button type="button" onClick={onNext} className="tap h-11 flex-1 cursor-pointer rounded-xl bg-brand px-4 text-base font-semibold text-white hover:bg-brand-strong">
                {t("Următorul contor")} →
              </button>
              <button type="button" onClick={onClose} className="tap h-11 cursor-pointer rounded-xl border border-[var(--color-line)] px-4 text-sm font-medium hover:bg-[var(--color-surface-2)]">
                {t("Închide")}
              </button>
            </>
          )}
        </div>
        {canViewMeter && (
          <Link href={`/contoare/${encodeURIComponent(row.id)}`} className="mt-3 block text-center text-xs text-brand underline">
            {t("Pagina contorului →")}
          </Link>
        )}
      </div>
    </div>
  );
}
