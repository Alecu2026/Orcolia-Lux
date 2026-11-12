"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/context";
import { ONEC_SOURCE, type FailedItem, type OneCSource, type PingResult, type SendBatchLog, type SendLogEntry, type SendPreview, type SendResult, type SourceCount } from "@/lib/onec-readings";
import { IconX } from "./icons";

/**
 * „Trimite către 1C” din Citiri teren: întâi (opțional) extrage din 1C ca să pună la zi contoarele, abonații și facturile, apoi trimite citirile (cititor, portal, LoRaWAN)
 * în documente separate pe surse. Arată ce s-a găsit, ce s-a trimis, câte documente a confirmat 1C (lungimea listei primite) și ce NU s-a trimis, cu motivul.
 */

const SOURCE_LABEL: Record<OneCSource, string> = {
  [ONEC_SOURCE.CONTROLLER]: "Cititor din teren (Контролер)",
  [ONEC_SOURCE.SUBSCRIBER]: "Din portal (Абонент)",
  [ONEC_SOURCE.LORAWAN]: "LoRaWAN",
  [ONEC_SOURCE.ESTIMATED]: "Estimate (Расчетный)",
  [ONEC_SOURCE.ACT]: "Act (Акт)",
};

type Step = { text: string; kind: "info" | "ok" | "err" };
type Totals = {
  sent: number;
  failed: number;
  confirmed: number;
  readings: number;
  unmatched: number;
  markErrors: number;
  ms: number;
  bySource: Map<OneCSource, SourceCount>;
  failedItems: FailedItem[];
  batches: SendBatchLog[];
};

const nf = (n: number) => n.toLocaleString("ro-RO");

export default function SendTo1cButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<SendPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [pullFirst, setPullFirst] = useState(true);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pinging, setPinging] = useState(false);
  const [ping, setPing] = useState<PingResult | null>(null);
  const [logs, setLogs] = useState<SendLogEntry[] | null>(null);
  const [showLog, setShowLog] = useState(false);
  const stop = useRef(false);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/contoare/send-1c", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "preview" }) });
      const j = (await r.json().catch(() => null)) as (SendPreview & { error?: string }) | null;
      if (!r.ok || !j || j.error) throw new Error(j?.error ?? String(r.status));
      setPreview(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    stop.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPreview();
    return () => {
      stop.current = true;
    };
  }, [open, loadPreview]);

  const push = (s: Step) => setSteps((a) => [...a, s]);

  async function run() {
    setRunning(true);
    setError(null);
    setSteps([]);
    setTotals(null);
    stop.current = false;
    try {
      if (pullFirst) {
        push({ kind: "info", text: t("Extrag mai întâi datele din 1C (contoare, abonați, facturi)…") });
        const r = await fetch("/api/contoare/send-1c", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "pull" }) });
        const j = (await r.json().catch(() => null)) as { status?: string; message?: string; error?: string } | null;
        if (!r.ok || !j) throw new Error(j?.error ?? String(r.status));
        if (j.status === "error" || j.status === "locked") {
          push({ kind: "err", text: `${t("Extragerea din 1C a eșuat — nu trimit citirile.")} ${j.message ?? ""}` });
          return;
        }
        push({ kind: j.status === "not_configured" ? "info" : "ok", text: j.message ?? "" });
      }

      const tot: Totals = { sent: 0, failed: 0, confirmed: 0, readings: 0, unmatched: 0, markErrors: 0, ms: 0, bySource: new Map(), failedItems: [], batches: [] };
      let exclude: string[] = [];
      push({ kind: "info", text: t("Trimit citirile către 1C…") });
      for (let round = 0; round < 60 && !stop.current; round++) {
        const r = await fetch("/api/contoare/send-1c", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "send", exclude, first: round === 0 }) });
        const j = (await r.json().catch(() => null)) as (SendResult & { error?: string }) | null;
        if (!r.ok || !j || j.error) throw new Error(j?.error ?? String(r.status));
        tot.sent += j.sent;
        tot.failed += j.failed;
        tot.confirmed += j.confirmed;
        tot.readings += j.readingsSent;
        tot.markErrors += j.markErrors;
        tot.ms += j.ms;
        if (round === 0) tot.unmatched = j.unmatched;
        for (const b of j.batches) if (tot.batches.length < 400) tot.batches.push({ ...b, batch: tot.batches.length + 1 });
        for (const s of j.bySource) {
          const c = tot.bySource.get(s.source) ?? { source: s.source, readings: 0, documents: 0 };
          c.readings += s.readings;
          c.documents += s.documents;
          tot.bySource.set(s.source, c);
        }
        for (const f of j.failedItems) if (tot.failedItems.length < 300) tot.failedItems.push(f);
        exclude = [...exclude, ...j.failedReadingIds];
        setTotals({ ...tot, bySource: new Map(tot.bySource), failedItems: [...tot.failedItems] });
        if (j.aborted) {
          push({ kind: "err", text: j.message ?? t("Trimiterea s-a oprit.") });
          break;
        }
        if (j.remaining === 0 || (j.sent === 0 && j.failed === 0)) {
          if (j.message && j.sent === 0 && j.failed === 0) push({ kind: "info", text: j.message });
          break;
        }
      }
      push({ kind: tot.failed > 0 || tot.markErrors > 0 ? "err" : "ok", text: tot.failed > 0 || tot.markErrors > 0 ? t("Gata, dar unele documente nu au fost confirmate de 1C (vezi mai jos).") : t("Gata: toate documentele au fost confirmate de 1C.") });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Eroare"));
    } finally {
      setRunning(false);
      void loadPreview();
      if (showLog) void loadLogs();
    }
  }

  async function runPing() {
    setPinging(true);
    setPing(null);
    try {
      const r = await fetch("/api/contoare/send-1c", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "ping" }) });
      const j = (await r.json().catch(() => null)) as (PingResult & { error?: string }) | null;
      if (!r.ok || !j || j.error) throw new Error(j?.error ?? String(r.status));
      setPing(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Eroare"));
    } finally {
      setPinging(false);
    }
  }

  async function loadLogs() {
    try {
      const r = await fetch("/api/contoare/send-1c", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "log" }) });
      const j = (await r.json().catch(() => null)) as { logs?: SendLogEntry[] } | null;
      if (r.ok && j?.logs) setLogs(j.logs);
    } catch {}
  }

  const lbl = (s: OneCSource) => t(SOURCE_LABEL[s]);
  const canSend = !!preview && preview.configured && !running && !loading && preview.documents > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("Trimite citirile către 1C: cititor, portal și LoRaWAN, în documente separate pe surse")}
        data-send-1c=""
        className="tap ml-auto inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-brand/50 bg-[var(--color-surface)] px-2 text-[12px] font-medium text-brand hover:bg-brand-soft"
      >
        {t("Trimite către 1C")}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={() => !running && setOpen(false)}>
          <div className="max-h-[92vh] w-full max-w-xl overflow-auto rounded-t-2xl bg-[var(--color-surface)] p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">{t("Trimite citirile către 1C")}</h2>
                <p className="mt-1 text-xs text-ink-soft">
                  {t("Citirile lunii (cititor, portal, LoRaWAN) se trimit ca documente „Introducerea indicilor contoarelor pentru un abonat”, câte unul pentru fiecare abonat și sursă. 1C întoarce lungimea listei primite, iar aici se compară cu cea trimisă.")}
                </p>
              </div>
              <button type="button" disabled={running} onClick={() => setOpen(false)} className="tap grid size-9 shrink-0 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40" aria-label={t("Închide")}>
                <IconX className="size-4" />
              </button>
            </div>

            {loading && !preview && <p className="py-6 text-center text-sm text-ink-soft">{t("Se încarcă…")}</p>}

            {preview && (
              <div className="flex flex-col gap-3">
                {!preview.configured && (
                  <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                    {t("Trimiterea nu e configurată: lipsește codul de acces (ONEC_READINGS_TOKEN) în setările serverului.")}
                  </p>
                )}

                <div className="rounded-xl border border-[var(--color-line)] p-3">
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-soft">{t("De trimis acum")}</div>
                  {preview.documents === 0 ? (
                    <p className="text-sm text-ink-soft">{t("Nu e nimic de trimis.")}</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[11px] text-ink-soft">
                          <th className="py-0.5 font-medium">{t("Sursa")}</th>
                          <th className="py-0.5 text-right font-medium">{t("Documente")}</th>
                          <th className="py-0.5 text-right font-medium">{t("Citiri")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.bySource.map((s) => (
                          <tr key={s.source} className="border-t border-[var(--color-line)]">
                            <td className="py-1">{lbl(s.source)}</td>
                            <td className="py-1 text-right tabular-nums">{nf(s.documents)}</td>
                            <td className="py-1 text-right tabular-nums">{nf(s.readings)}</td>
                          </tr>
                        ))}
                        <tr className="border-t border-[var(--color-line)] font-semibold">
                          <td className="py-1">{t("Total")}</td>
                          <td className="py-1 text-right tabular-nums">{nf(preview.documents)}</td>
                          <td className="py-1 text-right tabular-nums">{nf(preview.bySource.reduce((s, x) => s + x.readings, 0))}</td>
                        </tr>
                      </tbody>
                    </table>
                  )}
                  <ul className="mt-2 space-y-0.5 text-xs text-ink-soft">
                    <li>{t("Citiri deja trimise (nu se mai trimit): {n}", { n: nf(preview.alreadySent) })}</li>
                    {preview.correctedReadings > 0 && <li>{t("Corectate după trimitere (se retrimit): {n}", { n: nf(preview.correctedReadings) })}</li>}
                    {preview.unmatched > 0 && <li className="text-amber-700 dark:text-amber-300">{t("Care nu pot fi trimise (lipsește contul / contractul sau contorul): {n}", { n: nf(preview.unmatched) })}</li>}
                    <li>{t("Estimate (Расчетный): 0 — aplicația nu generează citiri estimate, ele rămân calculate de 1C.")}</li>
                    <li>{t("Luni verificate: {a}", { a: preview.periods.join(", ") })}</li>
                  </ul>
                </div>

                {preview.sample.length > 0 && (
                  <details className="rounded-xl border border-[var(--color-line)] p-3 text-xs">
                    <summary className="cursor-pointer font-medium">{t("Vezi exact ce se trimite (primele documente)")}</summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[var(--color-surface-2)] p-2 text-[11px] leading-snug">{JSON.stringify(preview.sample, null, 2)}</pre>
                  </details>
                )}

                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input type="checkbox" checked={pullFirst} onChange={(e) => setPullFirst(e.target.checked)} disabled={running} className="mt-0.5 size-4 accent-[var(--color-brand)]" />
                  <span>
                    {t("Extrage mai întâi din 1C (recomandat)")}
                    <span className="block text-xs text-ink-soft">{t("Pune la zi contoarele, abonații și facturile din CRM, apoi trimite citirile. Dacă extragerea eșuează, citirile nu se trimit.")}</span>
                  </span>
                </label>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void run()}
                    disabled={!canSend}
                    className="tap inline-flex h-10 items-center rounded-xl bg-brand px-4 text-sm font-semibold text-white disabled:cursor-default disabled:opacity-40"
                  >
                    {running ? t("Se trimite…") : t("Trimite acum")}
                  </button>
                  {running && (
                    <button type="button" onClick={() => (stop.current = true)} className="tap inline-flex h-10 items-center rounded-xl border border-[var(--color-line)] px-3 text-sm text-ink-soft hover:bg-[var(--color-surface-2)]">
                      {t("Oprește după lotul curent")}
                    </button>
                  )}
                  {!running && (
                    <button type="button" onClick={() => void loadPreview()} disabled={loading} className="tap inline-flex h-10 items-center rounded-xl border border-[var(--color-line)] px-3 text-sm text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40">
                      {t("Reîncarcă")}
                    </button>
                  )}
                  {!running && (
                    <button
                      type="button"
                      onClick={() => void runPing()}
                      disabled={pinging || !preview.configured}
                      title={t("Trimite o listă goală către 1C: nu creează nimic, doar arată dacă serviciul răspunde și ce răspunde")}
                      className="tap inline-flex h-10 items-center rounded-xl border border-[var(--color-line)] px-3 text-sm text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40"
                    >
                      {pinging ? t("Se testează…") : t("Testează conexiunea")}
                    </button>
                  )}
                </div>

                {ping && (
                  <p className={`rounded-lg border px-3 py-2 text-xs ${ping.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" : "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"}`}>
                    {ping.ok ? "✓ " : "✗ "}
                    {ping.host} · HTTP {ping.status ?? "—"} · {ping.ms} ms · {t("răspuns")}: {ping.body ? `„${ping.body}”` : "—"}
                    {ping.message && <span className="block">{ping.message}</span>}
                  </p>
                )}
              </div>
            )}

            {steps.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {steps.map((s, i) => (
                  <li key={i} className={s.kind === "err" ? "text-red-700 dark:text-red-300" : s.kind === "ok" ? "text-emerald-700 dark:text-emerald-300" : "text-ink-soft"}>
                    {s.kind === "ok" ? "✓ " : s.kind === "err" ? "✗ " : "• "}
                    {s.text}
                  </li>
                ))}
              </ul>
            )}

            {totals && (
              <div className="mt-3 rounded-xl border border-[var(--color-line)] p-3 text-sm">
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-soft">{t("Rezultat")}</div>
                <ul className="space-y-0.5">
                  <li>{t("Documente trimise și confirmate: {n}", { n: nf(totals.sent) })} <span className="text-xs text-ink-soft">({t("citiri: {n}", { n: nf(totals.readings) })})</span></li>
                  <li>{t("Lungimea listei confirmată de 1C (total): {n}", { n: nf(totals.confirmed) })}</li>
                  <li className={totals.failed > 0 ? "font-semibold text-red-700 dark:text-red-300" : ""}>{t("Netrimise / neconfirmate: {n}", { n: nf(totals.failed) })}</li>
                  {totals.unmatched > 0 && <li className="text-amber-700 dark:text-amber-300">{t("Care nu pot fi trimise (lipsește contul / contractul sau contorul): {n}", { n: nf(totals.unmatched) })}</li>}
                  {totals.markErrors > 0 && <li className="font-semibold text-red-700 dark:text-red-300">{t("Loturi primite de 1C, dar nemarcate în CRM (NU le retrimite): {n}", { n: nf(totals.markErrors) })}</li>}
                  <li className="text-xs text-ink-soft">{t("Durată: {s} s", { s: (totals.ms / 1000).toFixed(1) })}</li>
                </ul>
                {totals.batches.length > 0 && (
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer font-medium">{t("Detalii pe loturi ({n})", { n: nf(totals.batches.length) })}</summary>
                    <div className="mt-1 max-h-48 overflow-auto rounded-lg bg-[var(--color-surface-2)] p-2">
                      {totals.batches.map((b) => (
                        <div key={b.batch} className="border-b border-[var(--color-line)] py-0.5 last:border-0">
                          #{b.batch} · {b.documents} {t("documente")} · HTTP {b.status ?? "—"} · {t("confirmat")} {b.confirmed ?? "—"} · {b.ms} ms · {b.ok ? "✓" : <span className="text-red-700 dark:text-red-300">✗ {b.message}</span>}
                          {!b.ok && b.body ? <span className="block text-ink-soft">{t("răspuns")}: „{b.body}”</span> : null}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {totals.bySource.size > 0 && (
                  <ul className="mt-1.5 space-y-0.5 text-xs text-ink-soft">
                    {[...totals.bySource.values()].map((s) => (
                      <li key={s.source}>{lbl(s.source)}: {nf(s.documents)} {t("documente")}, {nf(s.readings)} {t("citiri")}</li>
                    ))}
                  </ul>
                )}
                {totals.failedItems.length > 0 && (
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer font-medium">{t("Care nu s-au trimis ({n})", { n: nf(totals.failedItems.length) })}</summary>
                    <div className="mt-1 max-h-56 overflow-auto rounded-lg bg-[var(--color-surface-2)] p-2">
                      {totals.failedItems.map((f, i) => (
                        <div key={i} className="border-b border-[var(--color-line)] py-1 last:border-0">
                          <b>{f.contor}</b> {f.abonat && <span>· {f.abonat}</span>} · {lbl(f.sursa)} · {f.indice} — <span className="text-red-700 dark:text-red-300">{t(f.reason)}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}

            {preview && (
              <details
                className="mt-3 rounded-xl border border-[var(--color-line)] p-3 text-xs"
                onToggle={(e) => {
                  const o = (e.currentTarget as HTMLDetailsElement).open;
                  setShowLog(o);
                  if (o) void loadLogs();
                }}
              >
                <summary className="cursor-pointer font-medium">{t("Jurnal trimiteri (ultimele)")}</summary>
                {!logs ? (
                  <p className="mt-2 text-ink-soft">{t("Se încarcă…")}</p>
                ) : logs.length === 0 ? (
                  <p className="mt-2 text-ink-soft">{t("Nu a fost trimis nimic încă.")}</p>
                ) : (
                  <div className="mt-2 max-h-64 overflow-auto">
                    {logs.map((l) => (
                      <details key={l.id} className="border-b border-[var(--color-line)] py-1 last:border-0">
                        <summary className="cursor-pointer">
                          {new Date(l.at).toLocaleString("ro-RO")} · {l.userName} · {t("trimise")} {l.sent} {t("documente")} ({l.readings} {t("citiri")}) · {t("confirmat")} {l.confirmed}
                          {l.failed > 0 && <span className="text-red-700 dark:text-red-300"> · {t("eșuate")} {l.failed} {t("documente")}</span>}
                          {l.details?.aborted && <span className="text-red-700 dark:text-red-300"> · {t("oprit")}</span>}
                        </summary>
                        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[var(--color-surface-2)] p-2 text-[11px] leading-snug">{JSON.stringify(l.details, null, 2)}</pre>
                      </details>
                    ))}
                  </div>
                )}
              </details>
            )}

            {error && <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</p>}
          </div>
        </div>
      )}
    </>
  );
}
