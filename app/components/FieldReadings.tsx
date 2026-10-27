"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { decodeField, type FieldRow, type FieldTuple } from "@/lib/meter-readings";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";
import { IconX } from "./icons";
import ReadingForm from "./ReadingForm";
import VirtualList from "./VirtualList";

type Tab = "unread" | "read" | "all";
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

/** Fereastra de citire a unui contor (pentru telefon): formularul de citire într-un pop-up de jos. */
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card max-h-[94dvh] w-full max-w-md overflow-auto rounded-b-none rounded-t-2xl p-4 sm:rounded-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-mono text-xl font-bold">{row.contor}</h2>
            <p className="text-xs text-ink-soft">{row.name}</p>
          </div>
          <button onClick={onClose} className="tap grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={t("Închide")}>
            <IconX className="size-4" />
          </button>
        </div>
        <ReadingForm
          meterId={row.id}
          address={row.address}
          lastIndex={row.lastIndex}
          lastDate={row.lastDate}
          initialValue={row.value}
          onSaved={(patch) => onSaved(row.id, patch)}
          onNext={onNext}
          onClose={onClose}
        />
        {canViewMeter && (
          <Link href={`/contoare/${encodeURIComponent(row.id)}`} className="mt-3 block text-center text-xs text-brand underline">
            {t("Pagina contorului →")}
          </Link>
        )}
      </div>
    </div>
  );
}
