import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/dal";
import { can, canViewTask, canViewTaskData } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getMeterDetail } from "@/lib/queries/meters";
import { getPayerInvoices } from "@/lib/queries/payers";
import { getMeterSnap } from "@/lib/services/meter-cache";
import { enumLabel, type MeterRow } from "@/lib/meters";
import { INVOICE_STATUS, type InvoiceStatusKey } from "@/app/components/invoice-meta";
import InvoiceViewButton from "@/app/components/InvoiceViewButton";
import { IconChevronLeft } from "@/app/components/icons";
import { TASK_STATUS_RO } from "@/lib/telegram";
import { getT } from "@/lib/i18n/server-t";
import { getLocaleFromCookie } from "@/lib/i18n/locale-cookie";
import { dateTag } from "@/lib/i18n/t";

export const dynamic = "force-dynamic";

const CARD_BTN = "tap inline-flex h-9 items-center gap-1 rounded-xl border border-[var(--color-line)] px-3 text-sm font-medium hover:bg-brand-soft";

/**
 * Pagina unui contor: toate datele lui (din 1C), ultima citire, calculul, consumatorul, abonatul și factura curentă, istoricul citirilor din toate lunile
 * (cu grafic de consum), facturile și sarcinile/cererile plătitorului, celelalte contoare ale abonatului și cele de la aceeași adresă.
 * Id-ul din adresă e stabil între sincronizările 1C (vezi lib/queries/meters.ts), deci link-ul rămâne valabil.
 */
export default async function MeterPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const tag = dateTag(await getLocaleFromCookie());
  const user = await requirePermission("payers.view");
  const { id: rawId } = await params;
  let id = rawId;
  try {
    id = decodeURIComponent(rawId);
  } catch {}

  const [detail, snap] = await Promise.all([getMeterDetail(id, { historyLimit: 120 }), getMeterSnap().catch(() => null)]);
  const row: MeterRow | null = snap?.rows.find((r) => r.id === id) ?? null;
  if (!detail && !row) notFound();

  const num = new Intl.NumberFormat(tag, { maximumFractionDigits: 3 });
  const moneyF = new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf = (n: number) => num.format(n);
  const money = (n: number, cur = "MDL") => `${moneyF.format(n)} ${cur}`;
  const dmy = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join(".") : null);

  const m = detail?.meter ?? null;
  const rd = detail?.reading ?? null;
  const sub = detail?.subscriber ?? null;
  const cons = detail?.consumer ?? null;
  const history = detail?.history ?? [];
  const contor = row?.contor ?? m?.contor ?? "—";
  const removedAt = row?.removedAt ?? m?.dataScoatere ?? null;
  const inv = row?.invoice ?? null;
  const st = inv ? INVOICE_STATUS[inv.status as InvoiceStatusKey] : null;
  const hasSub = !!m && !!(m.subAbonat || m.subContract || m.subCont || m.subConsumator || m.subContor);

  // Celelalte contoare ale abonatului / de la aceeași adresă (din lista din memorie).
  const subKey = id.startsWith("a:") ? null : id.slice(0, id.lastIndexOf("~", id.lastIndexOf("~") - 1));
  const siblings: MeterRow[] =
    snap && row ? snap.rows.filter((r) => r.id !== id && (row.clientId ? r.clientId === row.clientId : !!subKey && r.id.startsWith(`${subKey}~`))) : [];
  const sibIds = new Set(siblings.map((r) => r.id));
  const sameAddress: MeterRow[] = snap && row && row._a ? snap.rows.filter((r) => r._a === row._a && r.id !== id && !sibIds.has(r.id)) : [];

  // Facturile plătitorului și sarcinile/cererile lui (doar ce are voie să vadă utilizatorul).
  const clientId = row?.clientId ?? null;
  const invoices = clientId ? (await getPayerInvoices(clientId)).slice(0, 12) : [];
  let tasks: { id: string; seq: number | null; type: string; title: string; status: string; createdAt: Date }[] = [];
  if (clientId && canViewTaskData(user)) {
    const all = await prisma.task.findMany({
      where: { clientId },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { id: true, seq: true, type: true, title: true, status: true, createdAt: true, creatorId: true, assigneeId: true, extraAssigneeIds: true, teamId: true, extraTeamIds: true },
    });
    tasks = all.filter((x) => canViewTask(user, x)).slice(0, 10);
  }
  const taskHref = clientId
    ? `/tasks?${new URLSearchParams({ create: "task", client: clientId, desc: [`${t("Contor")} ${contor}`, row?.name, row?.account ?? row?.contract, row?.phone].filter(Boolean).join(" · ") }).toString()}`
    : null;

  // Graficul de consum: de la cel mai vechi la cel mai nou, ultimele 24 de citiri.
  const bars = [...history].reverse().slice(-24);
  const maxConsum = Math.max(1, ...bars.map((h) => h.consum));

  const sourceLabel = (s: string | null | undefined) => enumLabel(s, t);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <Link href="/contoare" className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
        <IconChevronLeft className="size-4" /> {t("Înapoi la contoare")}
      </Link>

      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold">
              {t("Contor")} <span className="font-mono">{contor}</span>
            </h1>
            <p className="mt-1 text-sm text-ink-soft">
              {row?.name ?? sub?.contPersonal ?? "—"}
              {row?.account || sub?.contPersonal ? <> · {t("Cont personal {n}", { n: row?.account ?? sub?.contPersonal ?? "" })}</> : row?.contract ? <> · {t("Contract {n}", { n: row.contract })}</> : null}
            </p>
            {row?.address && <p className="text-sm text-ink-soft">{row.address}</p>}
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
          {taskHref && can(user, "tasks.create") && (
            <Link href={taskHref} prefetch={false} className={CARD_BTN}>
              + {t("Sarcină")}
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Section title={t("Contor")}>
            <Item label={t("Nr. contor")} value={<span className="font-mono">{contor}</span>} />
            <Item label={t("Status")} value={removedAt ? <span className="text-st-cancelled">{t("Scos")}</span> : <span className="text-st-done">{t("Activ")}</span>} />
            <Item label={t("Instalat")} value={dmy(row?.installedAt ?? m?.dataInstalare)} />
            <Item label={t("Scos la")} value={dmy(removedAt)} />
            <Item label={t("Nr. sigiliu")} value={row?.sigiliu ?? m?.sigiliu} />
            <Item label={t("Consumator")} value={row?.consumator ?? m?.consumator} />
            <Item label={t("IDNO")} value={row?.inn ?? m?.inn} />
            <Item label={t("Perioada în registrul 1C")} value={dmy(m?.perioada)} />
            <Item label={t("Sursa datelor")} value={row?.source === "axioma" ? "Axioma" : "1C"} />
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

          <Section title={t("Ultima citire")}>
            <Item label={t("Citire anterioară")} value={row?.prev != null ? `${nf(row.prev)} m³${row.prevDate ? ` · ${dmy(row.prevDate)}` : ""}` : null} />
            <Item label={t("Citire curentă")} value={row?.curr != null ? <b>{`${nf(row.curr)} m³${row.currDate ? ` · ${dmy(row.currDate)}` : ""}`}</b> : null} />
            <Item label={t("Consum (m³)")} value={row?.consum != null ? <b>{nf(row.consum)} m³</b> : null} />
            <Item label={t("Consum mediu")} value={rd ? `${nf(rd.medie)} m³` : null} />
            <Item label={t("Consum sub-contoare")} value={rd && rd.consumSubcontoare ? `${nf(rd.consumSubcontoare)} m³` : null} />
            <Item label={t("Sursa citirii")} value={sourceLabel(row?.sursa ?? rd?.sursa)} />
          </Section>

          <Section title={t("Calcul (document 1C)")}>
            {detail && detail.lines.length > 0 ? (
              <ul className="divide-y divide-[var(--color-line)] text-[13px]">
                {detail.lines.map((l, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block">{sourceLabel(l.serviciu)}</span>
                      <span className="block text-[11px] text-ink-soft">
                        {nf(l.volum)} m³ × {money(l.tarif)}/m³
                        {l.data ? ` · ${dmy(l.data)}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{money(l.suma)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <>
                <Item label={t("Apă")} value={row && (row.apaVol != null || row.apaSum != null) ? `${row.apaVol != null ? nf(row.apaVol) : "—"} m³ · ${row.apaSum != null ? money(row.apaSum) : "—"}` : null} />
                <Item label={t("Canal")} value={row && (row.canalVol != null || row.canalSum != null) ? `${row.canalVol != null ? nf(row.canalVol) : "—"} m³ · ${row.canalSum != null ? money(row.canalSum) : "—"}` : null} />
              </>
            )}
          </Section>
        </div>

        <div className="flex flex-col gap-4">
          <Section title={t("Abonat")}>
            <Item label={t("Nume")} value={row?.name} />
            <Item label={t("Cont personal")} value={row?.account ?? sub?.contPersonal} />
            <Item label={t("Contract")} value={row?.contract ?? sub?.nrContract} />
            <Item label={t("Tip")} value={row ? (row.person ? t("Persoană fizică") : t("Firmă / instituție")) : null} />
            <Item label={t("Sector")} value={enumLabel(row?.sector, t)} />
            <Item label={t("Tip sector (1C)")} value={enumLabel(sub?.tipSector, t)} />
            <Item label={t("Adresă")} value={row?.address} />
            <Item label={t("Telefon")} value={row?.phone ?? sub?.telefon} />
            <Item label={t("Email")} value={row?.email} />
            <Item label={t("Cont portal")} value={row ? (row.activated ? <span className="text-st-done">{t("activat")}</span> : t("neactivat")) : null} />
            <Item label={t("Contoare active")} value={row ? String(row.meterCount) : null} />
            <Item label={t("Document 1C")} value={dmy(sub?.dataDoc ?? row?.docDate)} />
            <Item label={t("Calculat (1C)")} value={sub?.calculat != null ? money(sub.calculat) : null} />
            <Item label={t("Datorie / avans (1C)")} value={sub?.datorieAvans != null ? money(sub.datorieAvans) : null} />
            <Item label={t("De achitat (1C)")} value={sub?.deAchitat != null ? <b>{money(sub.deAchitat)}</b> : null} />
          </Section>

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

          {(cons || hasSub) && (
            <Section title={t("Consumator (1C)")}>
              <Item label={t("Nume")} value={cons?.nume} />
              <Item label={t("Zonă presiune apă")} value={cons?.zona} />
              <Item label={t("Sector de deservire")} value={cons?.sector} />
              <Item label={t("Nr. persoane")} value={cons ? String(cons.nrPersoane) : null} />
              <Item label={t("Suprafață")} value={cons ? nf(cons.suprafata) : null} />
              <Item label={t("Început consum")} value={dmy(cons?.inceput)} />
              <Item label={t("Sfârșit consum")} value={dmy(cons?.sfarsit)} />
            </Section>
          )}
        </div>
      </div>

      <Section title={`${t("Istoric citiri")} (${history.length})`}>
        {history.length === 0 ? (
          <p className="px-3 py-2.5 text-sm text-ink-soft">{t("Nicio citire în istoric.")}</p>
        ) : (
          <>
            <div className="border-b border-[var(--color-line)] px-3 py-3">
              <p className="mb-2 text-[11px] text-ink-soft">{t("Consum pe citiri (m³)")}</p>
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
                      <td className="px-3 py-1.5 text-right tabular-nums font-medium">{nf(h.curr)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{nf(h.consum)} m³</td>
                      <td className="px-3 py-1.5 text-ink-soft">{sourceLabel(h.sursa) || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>

      {clientId && (
        <Section title={`${t("Facturi")} (${invoices.length})`}>
          {invoices.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-ink-soft">{t("Nicio factură încă.")}</p>
          ) : (
            <ul className="divide-y divide-[var(--color-line)] text-sm">
              {invoices.map((i) => {
                const s = INVOICE_STATUS[i.status as InvoiceStatusKey];
                const label = i.billingPeriodLabel || i.number;
                return (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{label}</span>
                      <span className="block text-[11px] text-ink-soft">
                        {i.number} · {t("emisă")} {dmy(i.issueDate.toISOString()) ?? ""}
                        {i.dueDate && <> · {t("scadentă")} {dmy(i.dueDate.toISOString())}</>}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-right">
                        <span className="block tabular-nums">{money(i.grandTotal, i.currency)}</span>
                        {s && <span className={`inline-block rounded-full px-1.5 text-[10px] font-medium ${s.cls}`}>{t(s.label)}</span>}
                      </span>
                      <InvoiceViewButton token={i.publicToken} title={`${label} · ${i.number}`} />
                      {can(user, "invoices.edit") && (
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
      )}

      {clientId && canViewTaskData(user) && (
        <Section title={`${t("Sarcini și cereri")} (${tasks.length})`}>
          {tasks.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-ink-soft">{t("Nicio sarcină sau cerere pentru acest plătitor.")}</p>
          ) : (
            <ul className="divide-y divide-[var(--color-line)] text-sm">
              {tasks.map((x) => (
                <li key={x.id}>
                  <Link href={x.type === "TICKET" ? `/tickets/${x.id}` : `/tasks/${x.id}`} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-brand-soft/40">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {x.seq ? `#${x.seq} · ` : ""}
                        {x.title}
                      </span>
                      <span className="block text-[11px] text-ink-soft">
                        {x.type === "TICKET" ? t("Cerere") : t("Sarcină")} · {dmy(x.createdAt.toISOString())}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-[var(--color-surface-2)] px-2.5 py-0.5 text-xs font-medium text-ink-soft">{t(TASK_STATUS_RO[x.status] ?? x.status)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {siblings.length > 0 && (
        <Section title={`${t("Alte contoare ale abonatului")} (${siblings.length})`}>
          <MeterLinks list={siblings} t={t} nf={nf} dmy={dmy} />
        </Section>
      )}
      {sameAddress.length > 0 && (
        <Section title={`${t("Alte contoare la aceeași adresă")} (${sameAddress.length})`}>
          <MeterLinks list={sameAddress} t={t} nf={nf} dmy={dmy} showName />
        </Section>
      )}
    </div>
  );
}

function MeterLinks({
  list,
  t,
  nf,
  dmy,
  showName = false,
}: {
  list: MeterRow[];
  t: (ro: string, v?: Record<string, string | number>) => string;
  nf: (n: number) => string;
  dmy: (d: string | null | undefined) => string | null;
  showName?: boolean;
}) {
  const LIMIT = 40;
  return (
    <ul className="max-h-72 divide-y divide-[var(--color-line)] overflow-y-auto text-[13px]">
      {list.slice(0, LIMIT).map((r) => (
        <li key={r.id}>
          <Link href={`/contoare/${encodeURIComponent(r.id)}`} prefetch={false} className="flex items-baseline justify-between gap-3 px-3 py-2 hover:bg-brand-soft/40">
            <span className="min-w-0">
              <span className="block font-mono font-medium">{r.contor}</span>
              <span className="block truncate text-[11px] text-ink-soft">{showName ? r.name : r.consumator || r.address || "—"}</span>
            </span>
            <span className="shrink-0 text-right text-[11px]">
              {r.removedAt ? <span className="text-st-cancelled">{t("scos la {date}", { date: dmy(r.removedAt) ?? "" })}</span> : <span className="text-st-done">{t("activ")}</span>}
              {r.consum != null && <span className="block text-ink-soft">{t("consum")} {nf(r.consum)} m³</span>}
            </span>
          </Link>
        </li>
      ))}
      {list.length > LIMIT && <li className="px-3 py-2 text-[11px] text-ink-soft">{t("… și încă {n}", { n: list.length - LIMIT })}</li>}
    </ul>
  );
}

/** Casetă cu titlu pe fundal ușor și linie despărțitoare (același aspect ca fișele din pop-up). */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]">
      <h2 className="border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{title}</h2>
      <div className="divide-y divide-[var(--color-line)]">{children}</div>
    </section>
  );
}

/** Un rând „etichetă — valoare”. */
function Item({ label, value }: { label: string; value: React.ReactNode }) {
  const empty = value == null || value === "";
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2">
      <span className="shrink-0 text-[11px] text-ink-soft">{label}</span>
      <span className="min-w-0 break-words text-right text-[13px]">{empty ? <span className="text-ink-soft/60">—</span> : value}</span>
    </div>
  );
}
