"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { actionLabel, describeAgent, moduleLabel, objectHref, parseDetails, parseJsonObject, type AuditChange } from "@/lib/audit-meta";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";
import { IconChevronLeft, IconChevronRight, IconX } from "./icons";
import { useToast } from "./toast";
import { fmtStamp, moduleCls, roleCls, roleLabel, type AuditRow } from "./audit-shared";

type FullRow = AuditRow & { userAgent: string | null; details: string | null; path: string | null; oldValue: string | null; newValue: string | null };
type Detail = { row: FullRow; history: AuditRow[]; sameUser: AuditRow[] };

/** Detaliile deja aduse în această sesiune (revenirea la un rând deschis e instantanee). */
const cache = new Map<string, Detail>();

/** Din valorile vechi / noi (JSON de obiect, la jurnalele mai vechi) → listă de câmpuri schimbate. */
function changesFromValues(oldV: string | null, newV: string | null): AuditChange[] {
  const a = parseJsonObject(oldV);
  const b = parseJsonObject(newV);
  if (!a && !b) return [];
  const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])];
  const show = (v: unknown) => (v == null || v === "" ? null : typeof v === "object" ? JSON.stringify(v) : String(v));
  const out: AuditChange[] = [];
  for (const k of keys) {
    const o = show(a?.[k]);
    const n = show(b?.[k]);
    // la jurnalele vechi „noua” valoare conține doar câmpurile trimise: un câmp lipsă din ea nu înseamnă „șters”
    if (b && !(k in b)) continue;
    if (o !== n) out.push({ field: k, label: k, old: o, new: n });
  }
  return out;
}

function ValueBox({ v, kind }: { v: string | null; kind: "old" | "new" }) {
  const t = useT();
  if (v == null) return <span className="italic text-ink-soft">{t("(gol)")}</span>;
  return (
    <span className={`whitespace-pre-wrap break-words rounded px-1 py-px ${kind === "old" ? "bg-st-cancelled/10 text-st-cancelled line-through decoration-st-cancelled/40" : "bg-st-done/10 text-st-done"}`}>{v}</span>
  );
}

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

function MiniList({ rows, onOpen, tag }: { rows: AuditRow[]; onOpen: (id: string) => void; tag: string }) {
  const t = useT();
  return (
    <ul className="divide-y divide-[var(--color-line)] text-[12px]">
      {rows.map((r) => (
        <li key={r.id}>
          <button type="button" onClick={() => onOpen(r.id)} className="flex w-full cursor-pointer items-baseline gap-2 py-1 text-left hover:text-brand">
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-soft">{fmtStamp(r.createdAt, tag)}</span>
            <span className="min-w-0 flex-1 truncate">
              <b className="font-medium">{r.userName}</b> · {t(actionLabel(r.action))}
              {r.objectName ? <span className="text-ink-soft"> — {r.objectName}</span> : null}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Pop-up cu tot ce se știe despre un jurnal: ce s-a schimbat (câmp cu câmp), cine, când, de unde (IP, dispozitiv, pagină), obiectul (cu link) și istoricul lui.
 * Se deschide din listă; săgețile ← → trec la jurnalul vecin din aceeași pagină, Esc închide.
 */
export default function AuditDetailDialog({
  id,
  preview,
  onClose,
  onPrev,
  onNext,
  onOpen,
}: {
  id: string;
  /** Rândul din listă (se arată imediat, cât vin detaliile). */
  preview: AuditRow | null;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onOpen: (id: string) => void;
}) {
  const t = useT();
  const toast = useToast();
  const tag = dateTag(useLocale());
  const [detail, setDetail] = useState<Detail | null>(() => cache.get(id) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now()); // „acum X” se socotește față de deschiderea ferestrei

  useEffect(() => {
    if (cache.has(id)) return;
    const ctl = new AbortController();
    fetch(`/api/admin/audit/${id}`, { signal: ctl.signal })
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
  }, [id]);

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

  const row: (AuditRow & Partial<FullRow>) | null = detail?.row ?? preview;
  const parsed = useMemo(() => (detail ? parseDetails(detail.row.details) : null), [detail]);
  const changes = useMemo(() => {
    if (!detail) return [];
    if (parsed?.changes?.length) return parsed.changes;
    return changesFromValues(detail.row.oldValue, detail.row.newValue);
  }, [detail, parsed]);
  const agent = describeAgent(detail?.row.userAgent);
  const href = row ? objectHref(row.module, row.objectId, row.action) : null;

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

  const oldRaw = detail?.row.oldValue ?? null;
  const newRaw = detail?.row.newValue ?? null;
  const plainValues = changes.length === 0 && (oldRaw != null || newRaw != null);

  async function copy() {
    if (!detail) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify({ ...detail.row, details: parsed }, null, 2));
      toast.success(t("Copiat în clipboard."));
    } catch {
      toast.error(t("Nu am putut copia."));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card flex max-h-[94dvh] w-full max-w-3xl flex-col rounded-b-none rounded-t-2xl sm:rounded-2xl" role="dialog" aria-modal="true" aria-label={t("Detalii jurnal")}>
        {/* antet */}
        <div className="flex items-start gap-3 border-b border-[var(--color-line)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold">{t(actionLabel(row.action))}</h2>
              <span className={`rounded-full px-2 py-px text-[10px] font-semibold ${moduleCls(row.module)}`}>{moduleLabel(row.module, t)}</span>
            </div>
            <p className="mt-0.5 text-xs text-ink-soft">
              {fmtStamp(row.createdAt, tag)} · {rel}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={onPrev} disabled={!onPrev} aria-label={t("Jurnalul anterior din listă")} title={t("Anterior (←)")} className="tap grid size-8 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-30">
              <IconChevronLeft className="size-4" />
            </button>
            <button type="button" onClick={onNext} disabled={!onNext} aria-label={t("Jurnalul următor din listă")} title={t("Următor (→)")} className="tap grid size-8 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-30">
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

          {detail && (changes.length > 0 || plainValues || (parsed?.extra?.length ?? 0) > 0) && (
            <Section title={t("Ce s-a schimbat")}>
              {changes.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-[13px]">
                    <thead>
                      <tr className="text-left text-[11px] text-ink-soft">
                        <th className="w-40 pb-1 font-medium">{t("Câmp")}</th>
                        <th className="pb-1 font-medium">{t("Înainte")}</th>
                        <th className="pb-1 font-medium">{t("După")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {changes.map((c, i) => (
                        <tr key={`${c.field}-${i}`} className="border-t border-[var(--color-line)] align-top">
                          <td className="py-1 pr-2 font-medium">{t(c.label)}</td>
                          <td className="py-1 pr-2"><ValueBox v={c.old} kind="old" /></td>
                          <td className="py-1"><ValueBox v={c.new} kind="new" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {plainValues && (
                <dl>
                  <Fact label={t("Înainte")}><ValueBox v={oldRaw} kind="old" /></Fact>
                  <Fact label={t("După")}><ValueBox v={newRaw} kind="new" /></Fact>
                </dl>
              )}
              {(parsed?.extra?.length ?? 0) > 0 && (
                <dl className={changes.length > 0 || plainValues ? "mt-2 border-t border-[var(--color-line)] pt-2" : ""}>
                  {parsed?.extra?.map((x, i) => (
                    <Fact key={i} label={t(x.label)}>{x.value}</Fact>
                  ))}
                </dl>
              )}
            </Section>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Section title={t("Cine")}>
              <dl>
                <Fact label={t("Utilizator")}>
                  <b className="font-semibold">{row.userName}</b>{" "}
                  <span className={`rounded px-1 py-px text-[10px] font-semibold ${roleCls(row.userRole)}`}>{roleLabel(row.userRole)}</span>
                </Fact>
                {row.userId && <Fact label="ID"><span className="font-mono text-[11px]">{row.userId}</span></Fact>}
                <Fact label="IP"><span className="font-mono text-[12px]">{row.ip ?? "—"}</span></Fact>
                <Fact label={t("Dispozitiv")}>
                  {agent ? `${agent.browser} · ${agent.os} · ${t(agent.device)}` : detail ? "—" : "…"}
                </Fact>
                {detail?.row.path && <Fact label={t("Pagina")}><span className="font-mono text-[12px]">{detail.row.path}</span></Fact>}
              </dl>
              {detail?.row.userAgent && (
                <details className="mt-1 text-[11px] text-ink-soft">
                  <summary className="cursor-pointer">{t("User-agent complet")}</summary>
                  <p className="mt-1 break-all font-mono">{detail.row.userAgent}</p>
                </details>
              )}
            </Section>

            <Section title={t("Obiect și moment")}>
              <dl>
                <Fact label={t("Modul")}>{moduleLabel(row.module, t)}</Fact>
                <Fact label={t("Acțiune")}><span className="font-mono text-[12px]">{row.action}</span></Fact>
                <Fact label={t("Obiect")}>
                  {row.objectName ?? "—"}
                  {href && (
                    <>
                      {" "}
                      <Link href={href} className="text-xs font-semibold text-brand underline">{t("Deschide")} →</Link>
                    </>
                  )}
                </Fact>
                {row.objectId && <Fact label="ID"><span className="break-all font-mono text-[11px]">{row.objectId}</span></Fact>}
                <Fact label={t("Ora (fusul firmei)")}>{fmtStamp(row.createdAt, tag)}</Fact>
                <Fact label="UTC"><span className="font-mono text-[11px]">{when.toISOString()}</span></Fact>
              </dl>
            </Section>
          </div>

          {detail && detail.history.length > 0 && (
            <Section title={t("Istoricul obiectului ({n})", { n: detail.history.length })}>
              <MiniList rows={detail.history} onOpen={onOpen} tag={tag} />
            </Section>
          )}
          {detail && detail.sameUser.length > 0 && (
            <Section title={t("Ce a mai făcut {name} în jurul acestui moment", { name: row.userName })}>
              <MiniList rows={detail.sameUser} onOpen={onOpen} tag={tag} />
            </Section>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--color-line)] px-4 py-2.5">
          <button type="button" onClick={() => void copy()} disabled={!detail} className="tap h-8 cursor-pointer rounded-lg border border-[var(--color-line)] px-3 text-xs text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40">
            ⧉ {t("Copiază ca JSON")}
          </button>
          <span className="text-[11px] text-ink-soft">{t("← → trec la jurnalul vecin · Esc închide")}</span>
          <button type="button" onClick={onClose} className="tap h-8 cursor-pointer rounded-lg bg-brand px-4 text-xs font-semibold text-white hover:bg-brand-strong">
            {t("Închide")}
          </button>
        </div>
      </div>
    </div>
  );
}
