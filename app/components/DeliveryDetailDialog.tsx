"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CHANNEL_CLS,
  CHANNEL_ICON,
  CHANNEL_LABEL,
  STATUS_CLS,
  STATUS_LABEL,
  deliveryObjectHref,
  kindLabel,
  sourceLabel,
  stripTags,
} from "@/lib/delivery-meta";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";
import { IconChevronLeft, IconChevronRight, IconX } from "./icons";
import { useToast } from "./toast";
import { fmtStamp } from "./audit-shared";
import type { DeliveryRow } from "./DeliveryLogsClient";

type FullRow = DeliveryRow & { body: string | null; bodyHtml: string | null; providerId: string | null; fromAddr: string | null };
type Detail = {
  row: FullRow;
  sameRecipient: DeliveryRow[];
  sameObject: DeliveryRow[];
  campaign: { total: number; sent: number; failed: number; skipped: number } | null;
};

/** Detaliile deja aduse în această sesiune (revenirea la un rând deschis e instantanee). */
const cache = new Map<string, Detail>();

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--color-line)] p-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{title}</h3>
      {children}
    </section>
  );
}
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-0.5 text-[13px]">
      <dt className="w-28 shrink-0 text-ink-soft">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  );
}

function MiniList({ rows, onOpen, tag }: { rows: DeliveryRow[]; onOpen: (id: string) => void; tag: string }) {
  const t = useT();
  return (
    <ul className="divide-y divide-[var(--color-line)] text-[12px]">
      {rows.map((r) => (
        <li key={r.id}>
          <button type="button" onClick={() => onOpen(r.id)} className="flex w-full cursor-pointer items-baseline gap-2 py-1 text-left hover:text-brand">
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-soft">{fmtStamp(r.createdAt, tag)}</span>
            <span className={`shrink-0 rounded px-1 text-[10px] font-semibold ${STATUS_CLS[r.status] ?? ""}`}>{t(STATUS_LABEL[r.status] ?? r.status)}</span>
            <span className="min-w-0 flex-1 truncate">
              {CHANNEL_ICON[r.channel]} {r.subject ?? r.preview ?? "—"}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Pop-up cu tot ce se știe despre o trimitere: mesajul întreg (emailul și ca previzualizare HTML, într-un cadru izolat), rezultatul și eroarea, destinatarul,
 * cine a declanșat-o, obiectul legat, campania și celelalte mesaje către același destinatar / pentru același obiect. ← → trec la mesajul vecin, Esc închide.
 */
export default function DeliveryDetailDialog({
  id,
  preview,
  onClose,
  onPrev,
  onNext,
  onOpen,
  onFilter,
  apiBase = "/api/admin/delivery",
}: {
  apiBase?: string;
  id: string;
  preview: DeliveryRow | null;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onOpen: (id: string) => void;
  /** „Vezi toată campania” etc.: aplică un filtru în pagină și închide pop-up-ul. */
  onFilter: (patch: { campaign?: string; recipient?: string; q?: string }) => void;
}) {
  const t = useT();
  const toast = useToast();
  const tag = dateTag(useLocale());
  const [detail, setDetail] = useState<Detail | null>(() => cache.get(id) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"html" | "text">("html");
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (cache.has(id)) return;
    const ctl = new AbortController();
    fetch(`${apiBase}/${id}`, { signal: ctl.signal })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Eroare la încărcare.");
        return j as Detail;
      })
      .then((j) => {
        cache.set(id, j);
        if (cache.size > 60) cache.delete(cache.keys().next().value as string);
        setDetail(j);
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => ctl.abort();
  }, [id, apiBase]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt && /^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName)) return;
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && onPrev) onPrev();
      else if (e.key === "ArrowRight" && onNext) onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);

  const row: (DeliveryRow & Partial<FullRow>) | null = detail?.row ?? preview;
  const text = useMemo(() => {
    const b = detail?.row.body;
    if (b == null) return null;
    return detail?.row.channel === "TELEGRAM" ? stripTags(b) : b;
  }, [detail]);
  if (!row) return null;

  const when = new Date(row.createdAt);
  const rel = (() => {
    const diff = (when.getTime() - now) / 1000;
    const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
    const a = Math.abs(diff);
    if (a < 60) return rtf.format(Math.round(diff), "second");
    if (a < 3600) return rtf.format(Math.round(diff / 60), "minute");
    if (a < 86400) return rtf.format(Math.round(diff / 3600), "hour");
    return rtf.format(Math.round(diff / 86400), "day");
  })();
  const objHref = deliveryObjectHref(row.objectType, row.objectId);
  const html = detail?.row.bodyHtml ?? null;
  const showHtml = row.channel === "EMAIL" && html && view === "html";

  async function copy() {
    if (!detail) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(detail.row, null, 2));
      toast.success(t("Copiat în clipboard."));
    } catch {
      toast.error(t("Nu am putut copia."));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card flex max-h-[94dvh] w-full max-w-3xl flex-col rounded-b-none rounded-t-2xl sm:rounded-2xl" role="dialog" aria-modal="true" aria-label={t("Detalii trimitere")}>
        <div className="flex items-start gap-3 border-b border-[var(--color-line)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-px text-[11px] font-semibold ${CHANNEL_CLS[row.channel] ?? ""}`}>{CHANNEL_ICON[row.channel]} {t(CHANNEL_LABEL[row.channel] ?? row.channel)}</span>
              <span className={`rounded-full px-2 py-px text-[11px] font-semibold ${STATUS_CLS[row.status] ?? ""}`}>{t(STATUS_LABEL[row.status] ?? row.status)}</span>
              <h2 className="min-w-0 truncate text-base font-bold">{kindLabel(row.kind, t)}</h2>
            </div>
            <p className="mt-0.5 text-xs text-ink-soft">{fmtStamp(row.createdAt, tag)} · {rel}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={onPrev} disabled={!onPrev} aria-label={t("Mesajul anterior din listă")} title={t("Anterior (←)")} className="tap grid size-8 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-30">
              <IconChevronLeft className="size-4" />
            </button>
            <button type="button" onClick={onNext} disabled={!onNext} aria-label={t("Mesajul următor din listă")} title={t("Următor (→)")} className="tap grid size-8 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-30">
              <IconChevronRight className="size-4" />
            </button>
            <button type="button" onClick={onClose} aria-label={t("Închide")} className="tap grid size-8 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]">
              <IconX className="size-4" />
            </button>
          </div>
        </div>

        <div className="space-y-3 overflow-auto px-4 py-3">
          {error && <p className="rounded-lg bg-st-cancelled/10 px-3 py-2 text-sm text-st-cancelled">{t(error)}</p>}
          {!detail && !error && <p className="text-sm text-ink-soft">{t("se încarcă…")}</p>}

          {row.error && (
            <div className="rounded-xl border border-st-cancelled/40 bg-st-cancelled/10 px-3 py-2 text-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-st-cancelled">{row.status === "SKIPPED" ? t("De ce a fost omis") : t("Eroarea")}</p>
              <p className="mt-0.5 whitespace-pre-wrap break-words font-mono text-[12px] text-ink">{row.error}</p>
            </div>
          )}

          <Section title={t("Mesajul")}>
            {(row.subject || detail) && <p className="mb-2 break-words text-sm font-semibold">{row.subject ?? "—"}</p>}
            {detail && row.channel === "EMAIL" && html && (
              <div className="mb-2 flex gap-1" role="tablist">
                {(["html", "text"] as const).map((k) => (
                  <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)} className={`tap h-7 rounded-lg px-3 text-xs font-medium ${view === k ? "bg-brand text-white" : "border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)]"}`}>
                    {k === "html" ? t("Previzualizare") : t("Text")}
                  </button>
                ))}
              </div>
            )}
            {showHtml ? (
              // cadru izolat (fără scripturi, fără linkuri active): emailul se vede exact cum a plecat
              <iframe title={t("Previzualizare email")} sandbox="" srcDoc={html ?? ""} className="h-80 w-full rounded-lg border border-[var(--color-line)] bg-white" />
            ) : text != null ? (
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--color-surface-2)] p-2.5 font-sans text-[13px]">{text || "—"}</pre>
            ) : detail ? (
              <p className="text-sm italic text-ink-soft">{t("(fără conținut)")}</p>
            ) : null}
          </Section>

          <div className="grid gap-3 sm:grid-cols-2">
            <Section title={t("Către")}>
              <dl>
                <Fact label={t("Destinatar")}>
                  <b className="font-semibold">{row.toName ?? "—"}</b>
                  {row.toClientId && (
                    <>
                      {" "}
                      <Link href={`/platitori/${row.toClientId}`} className="text-xs font-semibold text-brand underline">{t("Plătitor")} →</Link>
                    </>
                  )}
                </Fact>
                <Fact label={t("Adresă")}><span className="font-mono text-[12px]">{row.to ?? "—"}</span></Fact>
                {row.toUserId && <Fact label={t("Utilizator")}><span className="font-mono text-[11px]">{row.toUserId}</span></Fact>}
              </dl>
            </Section>
            <Section title={t("De la")}>
              <dl>
                <Fact label={t("Declanșat de")}>{row.fromName ?? "—"}</Fact>
                <Fact label={t("Sursa")}>{sourceLabel(row.source, t)} <span className="font-mono text-[11px] text-ink-soft">({row.source})</span></Fact>
                {detail?.row.fromAddr && <Fact label={t("Expeditor")}><span className="font-mono text-[12px]">{detail.row.fromAddr}</span></Fact>}
              </dl>
            </Section>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Section title={t("Rezultat")}>
              <dl>
                <Fact label={t("Status")}>{t(STATUS_LABEL[row.status] ?? row.status)}</Fact>
                <Fact label={t("Durată")}>{row.durationMs != null ? `${row.durationMs} ms` : "—"}</Fact>
                {detail?.row.providerId && <Fact label={t("ID furnizor")}><span className="break-all font-mono text-[11px]">{detail.row.providerId}</span></Fact>}
              </dl>
            </Section>
            <Section title={t("Context")}>
              <dl>
                <Fact label={t("Tip")}>{kindLabel(row.kind, t)}{row.kind && <span className="ml-1 font-mono text-[11px] text-ink-soft">({row.kind})</span>}</Fact>
                {row.objectType && (
                  <Fact label={t("Obiect")}>
                    {row.objectName ?? row.objectType}
                    {objHref && (
                      <>
                        {" "}
                        <Link href={objHref} className="text-xs font-semibold text-brand underline">{t("Deschide")} →</Link>
                      </>
                    )}
                  </Fact>
                )}
                {row.campaignId && (
                  <Fact label={t("Campanie")}>
                    <span className="break-all font-mono text-[11px]">{row.campaignId}</span>
                    {detail?.campaign && (
                      <span className="mt-0.5 block text-xs text-ink-soft">
                        {t("{total} mesaje: {sent} trimise, {failed} eșuate, {skipped} omise", detail.campaign)}{" "}
                        <button type="button" onClick={() => onFilter({ campaign: row.campaignId ?? "" })} className="font-semibold text-brand underline">{t("Vezi toată campania")}</button>
                      </span>
                    )}
                  </Fact>
                )}
                <Fact label="UTC"><span className="font-mono text-[11px]">{when.toISOString()}</span></Fact>
                <Fact label="ID"><span className="break-all font-mono text-[11px]">{row.id}</span></Fact>
              </dl>
            </Section>
          </div>

          {detail && detail.sameRecipient.length > 0 && (
            <Section title={t("Alte mesaje către același destinatar ({n})", { n: detail.sameRecipient.length })}>
              <MiniList rows={detail.sameRecipient} onOpen={onOpen} tag={tag} />
            </Section>
          )}
          {detail && detail.sameObject.length > 0 && (
            <Section title={t("Alte mesaje pentru același obiect ({n})", { n: detail.sameObject.length })}>
              <MiniList rows={detail.sameObject} onOpen={onOpen} tag={tag} />
            </Section>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--color-line)] px-4 py-2.5">
          <button type="button" onClick={() => void copy()} disabled={!detail} className="tap h-8 cursor-pointer rounded-lg border border-[var(--color-line)] px-3 text-xs text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40">
            ⧉ {t("Copiază ca JSON")}
          </button>
          <span className="hidden text-[11px] text-ink-soft sm:inline">{t("← → trec la mesajul vecin · Esc închide")}</span>
          <button type="button" onClick={onClose} className="tap h-8 cursor-pointer rounded-lg bg-brand px-4 text-xs font-semibold text-white hover:bg-brand-strong">
            {t("Închide")}
          </button>
        </div>
      </div>
    </div>
  );
}
