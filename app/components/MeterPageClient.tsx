"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { MeterPageMeter, MeterPagePayer } from "@/app/api/contoare/page/route";
import { addressKey, averageConsum, enumLabel, type MeterRow, type MeterRowBase } from "@/lib/meters";
import { FAR_METERS, mapsUrl } from "@/lib/meter-readings";
import { INVOICE_STATUS, type InvoiceStatusKey } from "./invoice-meta";
import InvoiceViewButton from "./InvoiceViewButton";
import MeterMonthView from "./MeterMonthView";
import { Item, Section, Skeleton } from "./MeterBits";
import { IconChevronLeft } from "./icons";
import { useMeterDataset } from "./useMeterDataset";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";

const CARD_BTN = "tap inline-flex h-9 items-center gap-1 rounded-xl border border-[var(--color-line)] px-3 text-sm font-medium hover:bg-brand-soft";

type Keyed<T> = { key: string; data: T } | null;

/**
 * Pagina unui contor, construită din ce ESTE DEJA în browser: rândul contorului și al plătitorului (nume, adresă, telefon, factura curentă, ultima citire,
 * apă/canal…) vin din lista de contoare încărcată pentru /contoare (memorie / IndexedDB), deci antetul și secțiunile de bază apar în aceeași clipă cu click-ul,
 * fără nicio cerere. De pe server se cer DOAR datele care lipsesc din listă: detaliile din 1C și citirile din teren (o cerere), facturile și sarcinile
 * plătitorului (alta). Cele două pornesc în paralel, iar fiecare secțiune se completează când sosesc datele ei.
 */
export default function MeterPageClient({
  id,
  currentPeriod,
  canTask,
  canEditInvoices,
  canRead,
  canViewTasks,
}: {
  id: string;
  currentPeriod: string;
  canTask: boolean;
  canEditInvoices: boolean;
  canRead: boolean;
  canViewTasks: boolean;
}) {
  const t = useT();
  const tag = dateTag(useLocale());
  const fmt = useMemo(() => {
    const n = new Intl.NumberFormat(tag, { maximumFractionDigits: 3 });
    const m = new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return { nf: (x: number) => n.format(x), money: (x: number, cur = "MDL") => `${m.format(x)} ${cur}` };
  }, [tag]);
  const { nf, money } = fmt;
  const dmy = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join(".") : null);

  // 1) rândul contorului din lista deja încărcată (instant când venim din /contoare)
  const ds = useMeterDataset(true);
  const rowDs = useMemo(() => ds.rows?.find((r) => r.id === id) ?? null, [ds.rows, id]);
  const [wantRow] = useState(() => !rowDs); // fără rând în browser: serverul îl trimite împreună cu detaliile

  // 2) ce lipsește din listă: detaliile contorului + citirile din teren
  const [meterState, setMeterState] = useState<Keyed<MeterPageMeter>>(null);
  const [meterErr, setMeterErr] = useState<{ key: string; msg: string } | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/contoare/page?part=meter&id=${encodeURIComponent(id)}${wantRow ? "&row=1" : ""}`, { signal: ctl.signal })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Eroare.");
        return j as MeterPageMeter;
      })
      .then((data) => setMeterState({ key: id, data }))
      .catch((e: Error) => {
        if (e.name !== "AbortError") setMeterErr({ key: id, msg: e.message });
      });
    return () => ctl.abort();
  }, [id, wantRow]);
  const meter = meterState?.key === id ? meterState.data : null;
  const row: MeterRowBase | null = rowDs ?? meter?.row ?? null;
  const detail = meter?.detail ?? null;

  // 3) facturile și sarcinile plătitorului — pornesc imediat ce știm plătitorul (din rândul din listă)
  const clientId = row?.clientId ?? null;
  const [payerState, setPayerState] = useState<Keyed<MeterPagePayer>>(null);
  useEffect(() => {
    if (!clientId) return;
    const ctl = new AbortController();
    fetch(`/api/contoare/page?part=payer&client=${encodeURIComponent(clientId)}`, { signal: ctl.signal })
      .then(async (r) => (r.ok ? ((await r.json()) as MeterPagePayer) : null))
      .then((data) => data && setPayerState({ key: clientId, data }))
      .catch(() => {});
    return () => ctl.abort();
  }, [clientId]);
  const payer = clientId && payerState?.key === clientId ? payerState.data : null;

  // Contoarele aceluiași abonat și cele de la aceeași adresă — din lista din browser.
  const related = useMemo(() => {
    if (!ds.rows || !row) return { siblings: [] as MeterRow[], sameAddress: [] as MeterRow[] };
    const subKey = id.startsWith("a:") ? null : id.slice(0, id.lastIndexOf("~", id.lastIndexOf("~") - 1));
    const siblings = ds.rows.filter((r) => r.id !== id && (row.clientId ? r.clientId === row.clientId : !!subKey && r.id.startsWith(`${subKey}~`)));
    const sib = new Set(siblings.map((r) => r.id));
    const key = addressKey(row.address);
    return { siblings, sameAddress: key ? ds.rows.filter((r) => r._a === key && r.id !== id && !sib.has(r.id)) : [] };
  }, [ds.rows, row, id]);

  const notFound = !row && !detail && (meter != null || meterErr?.key === id) && (ds.rows != null || ds.error != null);
  if (notFound) {
    return (
      <div className="flex w-full flex-col gap-4">
        <Back />
        <div className="card p-8 text-center text-ink-soft">
          <p className="mb-3 text-base font-semibold text-ink">{t("Contorul nu mai există în ultima sincronizare. Reîncarcă lista.")}</p>
          <Link href="/contoare" className="font-semibold text-brand underline">{t("Înapoi la contoare")}</Link>
        </div>
      </div>
    );
  }

  const contor = row?.contor ?? detail?.meter?.contor ?? "";
  const removedAt = row?.removedAt ?? detail?.meter?.dataScoatere ?? null;
  const m = detail?.meter ?? null;
  const sub = detail?.subscriber ?? null;
  const cons = detail?.consumer ?? null;
  const inv = row?.invoice ?? null;
  const st = inv ? INVOICE_STATUS[inv.status as InvoiceStatusKey] : null;
  const hasSub = !!m && !!(m.subAbonat || m.subContract || m.subCont || m.subConsumator || m.subContor);
  const history = detail?.history ?? [];
  const avg = averageConsum(history);
  const bars = [...history].reverse().slice(-24);
  const maxConsum = Math.max(1, ...bars.map((h) => h.consum));
  const taskHref = clientId && canTask
    ? `/tasks?${new URLSearchParams({ create: "task", client: clientId, desc: [`${t("Contor")} ${contor}`, row?.name, row?.account ?? row?.contract, row?.phone].filter(Boolean).join(" · ") }).toString()}`
    : null;
  const metaLoading = !meter;

  return (
    <div className="flex w-full flex-col gap-4">
      <Back />

      {/* ── antet: din lista din browser, instant ── */}
      {row || contor ? (
        <div className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-bold">
                {t("Contor")} <span className="font-mono">{contor}</span>
              </h1>
              <p className="mt-1 text-sm text-ink-soft">
                {row?.name ?? "—"}
                {row?.account ? <> · {t("Cont personal {n}", { n: row.account })}</> : row?.contract ? <> · {t("Contract {n}", { n: row.contract })}</> : null}
                {row?.address ? <> · {row.address}</> : null}
              </p>
            </div>
            {removedAt ? (
              <span className="rounded-full bg-st-cancelled/12 px-2.5 py-1 text-xs font-medium text-st-cancelled">{t("scos la {date}", { date: dmy(removedAt) ?? "" })}</span>
            ) : (
              <span className="rounded-full bg-st-done/12 px-2.5 py-1 text-xs font-medium text-st-done">{t("Activ")}</span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--color-line)] pt-3">
            {clientId && (
              <Link href={`/platitori/${clientId}`} className="tap inline-flex h-9 items-center rounded-xl bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong">
                {t("Pagina plătitorului →")}
              </Link>
            )}
            {taskHref && (
              <Link href={taskHref} prefetch={false} className={CARD_BTN}>
                + {t("Sarcină")}
              </Link>
            )}
          </div>
        </div>
      ) : (
        <Skeleton className="h-32" />
      )}

      {/* ── date pe lună: au nevoie de detaliile din 1C ── */}
      {meter ? (
        <MeterMonthView meterId={id} months={detail?.months ?? []} field={meter.field} invoices={payer?.invoices ?? []} currentPeriod={currentPeriod} canEditInvoices={canEditInvoices} canRead={canRead} />
      ) : (
        <Skeleton className="h-96" />
      )}

      {/* ── informații de bază: din lista din browser (instant); câmpurile doar din 1C se completează la sosirea detaliilor ── */}
      {row ? (
        <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-4">
          <div className="flex flex-col gap-4">
            <Section title={t("Contor")}>
              <Item label={t("Nr. contor")} value={<span className="font-mono">{row.contor}</span>} />
              <Item label={t("Status")} value={removedAt ? <span className="text-st-cancelled">{t("Scos")}</span> : <span className="text-st-done">{t("Activ")}</span>} />
              <Item label={t("Instalat")} value={dmy(row.installedAt)} />
              <Item label={t("Scos la")} value={dmy(removedAt)} />
              <Item label={t("Nr. sigiliu")} value={row.sigiliu} />
              <Item label={t("Consumator")} value={row.consumator} />
              <Item label={t("IDNO")} value={row.inn} />
              <Item label={t("Perioada în registrul 1C")} value={dmy(m?.perioada)} loading={metaLoading} />
              <Item label={t("Sursa datelor")} value={row.source === "axioma" ? "Axioma" : "1C"} />
            </Section>
            {hasSub && m && (
              <Section title={t("Sub-abonat / sub-contor (1C)")}>
                <Item label={t("Sub-abonat")} value={m.subAbonat} />
                <Item label={t("Sub-contract")} value={m.subContract} />
                <Item label={t("Sub-cont personal")} value={m.subCont} />
                <Item label={t("Sub-consumator")} value={m.subConsumator} />
                <Item label={t("Sub-contor")} value={m.subContor} />
              </Section>
            )}
          </div>

          <Section title={t("Abonat")}>
            <Item label={t("Nume")} value={row.name} />
            <Item label={t("Cont personal")} value={row.account} />
            <Item label={t("Contract")} value={row.contract} />
            <Item label={t("Tip")} value={row.person ? t("Persoană fizică") : t("Firmă / instituție")} />
            <Item label={t("Sector")} value={enumLabel(row.sector, t)} />
            <Item label={t("Tip sector (1C)")} value={enumLabel(sub?.tipSector, t)} loading={metaLoading} />
            <Item label={t("Adresă")} value={row.address} />
            <Item label={t("Telefon")} value={row.phone} />
            <Item label={t("Email")} value={row.email} />
            <Item label={t("Cont portal")} value={row.activated ? <span className="text-st-done">{t("activat")}</span> : t("neactivat")} />
            <Item label={t("Contoare active")} value={String(row.meterCount)} />
          </Section>

          <div className="flex flex-col gap-4">
            <Section title={t("Factura curentă")}>
              {inv ? (
                <>
                  <Item label={t("Număr")} value={inv.number} />
                  <Item label={t("Status")} value={st ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{t(st.label)}</span> : null} />
                  <Item label={t("De achitat")} value={<b>{money(inv.grandTotal, inv.currency)}</b>} />
                  <Item label={t("Scadență")} value={dmy(inv.dueDate)} />
                </>
              ) : (
                <p className="px-3 py-2.5 text-sm text-ink-soft">{t("Nicio factură.")}</p>
              )}
            </Section>
            <Section title={t("Document 1C")}>
              <Item label={t("Document 1C")} value={dmy(sub?.dataDoc ?? row.docDate)} />
              <Item label={t("Calculat (1C)")} value={sub?.calculat != null ? money(sub.calculat) : null} loading={metaLoading} />
              <Item label={t("Datorie / avans (1C)")} value={sub?.datorieAvans != null ? money(sub.datorieAvans) : null} loading={metaLoading} />
              <Item label={t("De achitat (1C)")} value={sub?.deAchitat != null ? <b>{money(sub.deAchitat)}</b> : null} loading={metaLoading} />
            </Section>
          </div>

          {(cons || hasSub || metaLoading) && (
            <Section title={t("Consumator (1C)")}>
              <Item label={t("Nume")} value={cons?.nume} loading={metaLoading} />
              <Item label={t("Zonă presiune apă")} value={cons?.zona} loading={metaLoading} />
              <Item label={t("Sector de deservire")} value={cons?.sector} loading={metaLoading} />
              <Item label={t("Nr. persoane")} value={cons ? String(cons.nrPersoane) : null} loading={metaLoading} />
              <Item label={t("Suprafață")} value={cons ? nf(cons.suprafata) : null} loading={metaLoading} />
              <Item label={t("Început consum")} value={dmy(cons?.inceput)} loading={metaLoading} />
              <Item label={t("Sfârșit consum")} value={dmy(cons?.sfarsit)} loading={metaLoading} />
            </Section>
          )}
        </div>
      ) : (
        <Skeleton className="h-72" />
      )}

      {/* ── istoric + citiri din teren ── */}
      <div className="grid items-start gap-4 xl:grid-cols-2">
        {meter ? (
          <Section title={`${t("Istoric citiri")} (${history.length})`}>
            {history.length === 0 ? (
              <p className="px-3 py-2.5 text-sm text-ink-soft">{t("Nicio citire în istoric.")}</p>
            ) : (
              <>
                <div className="border-b border-[var(--color-line)] px-3 py-3">
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-[11px] text-ink-soft">
                    <span>{t("Consum pe citiri (m³)")}</span>
                    {avg && (
                      <span>
                        {t("Consum mediu lunar")}: <b className="text-ink">{nf(avg.avg)} m³</b> ({t("din ultimele {n} citiri", { n: avg.count })})
                      </span>
                    )}
                  </div>
                  <div className="flex h-28 items-end gap-1" role="img" aria-label={t("Consum pe citiri (m³)")}>
                    {bars.map((h, i) => (
                      <div key={i} className="flex h-full min-w-[8px] max-w-[56px] flex-1 flex-col justify-end" title={`${dmy(h.currDate ?? h.docDate) ?? "—"} · ${nf(h.consum)} m³`}>
                        <span className="mb-0.5 text-center text-[9px] leading-none text-ink-soft">{nf(h.consum)}</span>
                        <div className="w-full rounded-t bg-brand/70" style={{ height: `${Math.max(3, (h.consum / maxConsum) * 80)}%` }} />
                      </div>
                    ))}
                  </div>
                  <div className="mt-1 flex gap-1">
                    {bars.map((h, i) => (
                      <span key={i} className="min-w-[8px] max-w-[56px] flex-1 truncate text-center text-[9px] text-ink-soft">{(dmy(h.currDate ?? h.docDate) ?? "").slice(3, 5)}</span>
                    ))}
                  </div>
                </div>
                <div className="max-h-96 overflow-auto">
                  <table className="w-full min-w-[520px] text-[13px]">
                    <thead className="sticky top-0 bg-[var(--color-surface-2)] text-left text-[11px] text-ink-soft">
                      <tr>
                        <th className="px-3 py-1.5 font-semibold">{t("Data citirii")}</th>
                        <th className="px-3 py-1.5 text-right font-semibold">{t("Citire anterioară")}</th>
                        <th className="px-3 py-1.5 text-right font-semibold">{t("Citire curentă")}</th>
                        <th className="px-3 py-1.5 text-right font-semibold">{t("Consum (m³)")}</th>
                        <th className="px-3 py-1.5 font-semibold">{t("Sursa citirii")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-line)]">
                      {history.map((h, i) => (
                        <tr key={i}>
                          <td className="whitespace-nowrap px-3 py-1.5">{dmy(h.currDate ?? h.docDate) ?? "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums" title={dmy(h.prevDate) ?? undefined}>{nf(h.prev)}</td>
                          <td className="px-3 py-1.5 text-right font-medium tabular-nums">{nf(h.curr)}</td>
                          <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{nf(h.consum)} m³</td>
                          <td className="px-3 py-1.5 text-ink-soft">{enumLabel(h.sursa, t) || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Section>
        ) : (
          <Skeleton className="h-72" />
        )}

        {meter ? (
          <Section title={`${t("Citiri din teren")} (${meter.field.length})`}>
            {meter.field.length === 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 text-sm text-ink-soft">
                <span>{t("Nicio citire din teren încă.")}</span>
                {canRead && (
                  <Link href={`/contoare/citiri?meter=${encodeURIComponent(id)}`} className="tap inline-flex h-8 items-center rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong">
                    {t("Introdu citirea din teren")}
                  </Link>
                )}
              </div>
            ) : (
              <div className="max-h-[28rem] overflow-auto">
                <table className="w-full min-w-[560px] text-[13px]">
                  <thead className="sticky top-0 bg-[var(--color-surface-2)] text-left text-[11px] text-ink-soft">
                    <tr>
                      <th className="px-3 py-1.5 font-semibold">{t("Luna")}</th>
                      <th className="px-3 py-1.5 text-right font-semibold">{t("Index (m³)")}</th>
                      <th className="px-3 py-1.5 text-right font-semibold">{t("Consum (m³)")}</th>
                      <th className="px-3 py-1.5 font-semibold">{t("Citit de")}</th>
                      <th className="px-3 py-1.5 font-semibold">{t("Locație")}</th>
                      <th className="px-3 py-1.5 font-semibold">{t("Poza")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-line)]">
                    {meter.field.map((f) => (
                      <tr key={f.id}>
                        <td className="whitespace-nowrap px-3 py-1.5">{f.period.split("-").reverse().join(".")}</td>
                        <td className="px-3 py-1.5 text-right font-medium tabular-nums">{nf(f.value)}</td>
                        <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{f.prevValue != null ? `${nf(f.value - f.prevValue)} m³` : "—"}</td>
                        <td className="px-3 py-1.5 text-ink-soft">
                          {f.userName}
                          <span className="block text-[11px]">{new Date(f.readAt).toLocaleString(tag, { dateStyle: "short", timeStyle: "short" })}</span>
                        </td>
                        <td className="px-3 py-1.5">
                          {f.lat != null && f.lng != null ? (
                            <a href={mapsUrl(f.lat, f.lng)} target="_blank" rel="noreferrer" className="text-brand hover:underline">{t("Harta")}</a>
                          ) : (
                            <span className="text-ink-soft/60">—</span>
                          )}
                          {f.accuracy != null && <span className="text-[11px] text-ink-soft"> ±{f.accuracy} m</span>}
                          {f.distanceM != null && f.distanceM > FAR_METERS && <span className="block text-[11px] text-st-progress">{t("La {n} m de locația citirii anterioare", { n: f.distanceM })}</span>}
                        </td>
                        <td className="px-3 py-1.5">
                          {f.photoUrl ? <a href={f.photoUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">{t("Vezi poza")}</a> : <span className="text-ink-soft/60">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        ) : (
          <Skeleton className="h-72" />
        )}
      </div>

      {/* ── facturile și sarcinile plătitorului ── */}
      {clientId && (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          {payer ? (
            <Section title={`${t("Facturi")} (${payer.invoices.length})`}>
              {payer.invoices.length === 0 ? (
                <p className="px-3 py-2.5 text-sm text-ink-soft">{t("Nicio factură încă.")}</p>
              ) : (
                <ul className="divide-y divide-[var(--color-line)] text-sm">
                  {payer.invoices.map((i) => {
                    const s = INVOICE_STATUS[i.status as InvoiceStatusKey];
                    const label = i.label || i.number;
                    return (
                      <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{label}</span>
                          <span className="block text-[11px] text-ink-soft">
                            {i.number} · {t("emisă")} {dmy(i.issueDate) ?? ""}
                            {i.dueDate && <> · {t("scadentă")} {dmy(i.dueDate)}</>}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="text-right">
                            <span className="block tabular-nums">{money(i.total, i.currency)}</span>
                            {s && <span className={`inline-block rounded-full px-1.5 text-[10px] font-medium ${s.cls}`}>{t(s.label)}</span>}
                          </span>
                          <InvoiceViewButton token={i.token} title={`${label} · ${i.number}`} />
                          {canEditInvoices && (
                            <Link href={`/invoices/${i.id}/edit`} className="tap h-9 rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium leading-9 hover:bg-[var(--color-surface-2)]">
                              {t("Editează")}
                            </Link>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
          ) : (
            <Skeleton className="h-48" />
          )}
          {canViewTasks &&
            (payer ? (
              <Section title={`${t("Sarcini și cereri")} (${payer.tasks.length})`}>
                {payer.tasks.length === 0 ? (
                  <p className="px-3 py-2.5 text-sm text-ink-soft">{t("Nicio sarcină sau cerere pentru acest plătitor.")}</p>
                ) : (
                  <ul className="divide-y divide-[var(--color-line)] text-sm">
                    {payer.tasks.map((x) => (
                      <li key={x.id}>
                        <Link href={x.type === "TICKET" ? `/tickets/${x.id}` : `/tasks/${x.id}`} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-brand-soft/40">
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {x.seq ? `#${x.seq} · ` : ""}
                              {x.title}
                            </span>
                            <span className="block text-[11px] text-ink-soft">
                              {x.type === "TICKET" ? t("Cerere") : t("Sarcină")} · {dmy(x.createdAt)}
                            </span>
                          </span>
                          <span className="shrink-0 rounded-full bg-[var(--color-surface-2)] px-2.5 py-0.5 text-xs font-medium text-ink-soft">{t(x.statusRo)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            ) : (
              <Skeleton className="h-48" />
            ))}
        </div>
      )}

      {/* ── celelalte contoare (din lista din browser) ── */}
      {(related.siblings.length > 0 || related.sameAddress.length > 0) && (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          {related.siblings.length > 0 && (
            <Section title={`${t("Alte contoare ale abonatului")} (${related.siblings.length})`}>
              <MeterLinks list={related.siblings} />
            </Section>
          )}
          {related.sameAddress.length > 0 && (
            <Section title={`${t("Alte contoare la aceeași adresă")} (${related.sameAddress.length})`}>
              <MeterLinks list={related.sameAddress} showName />
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Back() {
  const t = useT();
  return (
    <Link href="/contoare" className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
      <IconChevronLeft className="size-4" /> {t("Înapoi la contoare")}
    </Link>
  );
}

function MeterLinks({ list, showName = false }: { list: MeterRow[]; showName?: boolean }) {
  const t = useT();
  const tag = dateTag(useLocale());
  const LIMIT = 40;
  const nf = (n: number) => n.toLocaleString(tag, { maximumFractionDigits: 3 });
  const dmy = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join(".") : "");
  return (
    <ul className="max-h-72 divide-y divide-[var(--color-line)] overflow-y-auto text-[13px]">
      {list.slice(0, LIMIT).map((r) => (
        <li key={r.id}>
          <Link href={`/contoare/${encodeURIComponent(r.id)}`} className="flex items-baseline justify-between gap-3 px-3 py-2 hover:bg-brand-soft/40">
            <span className="min-w-0">
              <span className="block font-mono font-medium">{r.contor}</span>
              <span className="block truncate text-[11px] text-ink-soft">{showName ? r.name : r.consumator || r.address || "—"}</span>
            </span>
            <span className="shrink-0 text-right text-[11px]">
              {r.removedAt ? <span className="text-st-cancelled">{t("scos la {date}", { date: dmy(r.removedAt) })}</span> : <span className="text-st-done">{t("activ")}</span>}
              {r.consum != null && <span className="block text-ink-soft">{t("consum")} {nf(r.consum)} m³</span>}
            </span>
          </Link>
        </li>
      ))}
      {list.length > LIMIT && <li className="px-3 py-2 text-[11px] text-ink-soft">{t("… și încă {n}", { n: list.length - LIMIT })}</li>}
    </ul>
  );
}
