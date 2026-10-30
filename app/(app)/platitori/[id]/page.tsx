import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getPayer, getPayerInvoices, getPayerTickets } from "@/lib/queries/payers";
import { money, fmtDate, INVOICE_STATUS, type InvoiceStatusKey } from "@/app/components/invoice-meta";
import { TASK_STATUS_RO } from "@/lib/telegram";
import PayerActions from "@/app/components/PayerActions";
import ContractExpiry from "@/app/components/ContractExpiry";
import PayerNotes from "@/app/components/PayerNotes";
import InvoiceViewButton from "@/app/components/InvoiceViewButton";
import CollapsibleSection from "@/app/components/CollapsibleSection";
import { listPayerNotes } from "@/lib/queries/payer-notify";
import { IconChevronLeft } from "@/app/components/icons";
import { getT } from "@/lib/i18n/server-t";
import PayerMeters from "@/app/components/PayerMeters";
import { Skeleton } from "@/app/components/MeterBits";
import { getMeterSnap } from "@/lib/services/meter-cache";
import { plainMeter } from "@/lib/meters";
import { getLocaleFromCookie } from "@/lib/i18n/locale-cookie";
import { dateTag } from "@/lib/i18n/t";

export const dynamic = "force-dynamic";

const TH = "px-2.5 py-1 text-left text-[11px] font-semibold text-ink-soft";
const TD = "whitespace-nowrap px-2.5 py-1";

export default async function PayerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const tr = await getT();
  const dateLoc = dateTag(await getLocaleFromCookie());
  const user = await requirePermission("payers.view");
  const { id } = await params;

  const payer = await getPayer(id);
  if (!payer) notFound();

  const [invoices, tickets, notes] = await Promise.all([getPayerInvoices(id), getPayerTickets(id), listPayerNotes(id)]);
  const last = invoices[0];

  return (
    <div className="flex w-full flex-col gap-3">
      <Link href="/platitori" className="inline-flex w-fit items-center gap-1 text-sm text-ink-soft hover:text-ink">
        <IconChevronLeft className="size-4" /> {tr("Înapoi la plătitori")}
      </Link>

      {/* Două coloane pe ecran lat: stânga = datele plătitorului, acțiuni, notițe; dreapta = contoare, facturi, cereri (fiecare se deschide / închide din antet) */}
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <div className="card p-3.5">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h1 className="text-lg font-bold leading-tight">{payer.name}</h1>
                <p className="mt-0.5 text-xs text-ink-soft">
                  {/* meterSeries e identificatorul cu care clientul se loghează în portal — afișat
                      ca "Cont personal" (nu "Serie contor"), la fel ca pe factură/pagina de login,
                      ca staff-ul să știe exact ce număr să-i dea clientului. */}
                  {payer.meterSeries ? <>{tr("Cont personal:")} <b>{payer.meterSeries}</b></> : <>{tr("Firmă · Contract 1C:")} <b>{payer.contract}</b></>}
                  {payer.meterNumber && <> {tr("· Contor:")} {payer.meterNumber}</>}
                </p>
                {payer.consumAddress && <p className="text-xs text-ink-soft">{payer.consumAddress}</p>}
              </div>
              {!payer.meterSeries ? (
                <span className="shrink-0 rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px] font-medium text-ink-soft">{tr("Fără cont de portal")}</span>
              ) : payer.activated ? (
                <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-strong">{tr("Cont activat")}</span>
              ) : (
                <span className="shrink-0 rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px] font-medium text-ink-soft">{tr("Cont neactivat")}</span>
              )}
            </div>

            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[13px]">
              <div className="min-w-0">
                <dt className="text-[11px] text-ink-soft">Email</dt>
                <dd className="truncate font-medium" title={payer.email ?? ""}>{payer.email || "—"}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-ink-soft">{tr("Telefon")}</dt>
                <dd className="font-medium">{payer.phone || "—"}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-[11px] text-ink-soft">{tr("Contract expiră la")}</dt>
                <dd className="font-medium"><ContractExpiry date={payer.contractExpiresAt} /></dd>
              </div>
              <div>
                <dt className="text-[11px] text-ink-soft">{tr("Activat la")}</dt>
                <dd className="font-medium">{payer.portalActivatedAt ? fmtDate(payer.portalActivatedAt) : "—"}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-ink-soft">{tr("Ultima logare")}</dt>
                <dd className="font-medium">{payer.portalLastLoginAt ? fmtDate(payer.portalLastLoginAt) : "—"}</dd>
              </div>
            </dl>

            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[var(--color-line)] pt-3">
              <Link
                href={`/invoices/new?kind=apa-canal&clientId=${payer.id}`}
                className="tap inline-flex h-8 items-center rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong"
              >
                {tr("Trimite factură nouă")}
              </Link>
              {/* "Decontare" — pagină cu fișă tip tabel contabil (un rând per perioadă + rând TOTAL), în
                  același spirit cu raportul "Взаиморасчеты с абонентами" pe care îl folosește Apă-Canal
                  pentru totaluri (fără jurnalul de plăți — nu-l avem); Excel/CSV/JSON, de acolo. */}
              <Link
                href={`/platitori/${payer.id}/decontare`}
                className="tap inline-flex h-8 items-center rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium text-ink-soft hover:bg-[var(--color-surface-2)]"
              >
                {tr("Decontare")}
              </Link>
            </div>
            <div className="mt-1.5">
              <PayerActions
                payer={{ id: payer.id, name: payer.name, phone: payer.phone, email: payer.email, notes: payer.notes, contractExpiresAt: payer.contractExpiresAt }}
                canEdit={can(user, "payers.edit")}
                canDelete={can(user, "payers.delete")}
                canAdmin={can(user, "admin")}
              />
            </div>
          </div>

          <CollapsibleSection id="payer-notes" title={tr("Notițe")} count={notes.length + (payer.notes ? 1 : 0)}>
            <div className="p-3">
              <PayerNotes
                payerId={payer.id}
                initial={notes}
                legacy={payer.notes}
                canAdd={can(user, "payers.edit")}
                userId={user.id}
                isAdmin={can(user, "admin")}
              />
            </div>
          </CollapsibleSection>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          {/* Contoarele plătitorului: apar când sunt gata (lista de contoare din memoria serverului), fără să țină pagina în așteptare */}
          <Suspense fallback={<Skeleton className="h-24" />}>
            <PayerMetersBlock clientId={payer.id} canTask={can(user, "tasks.create")} canEditInvoices={can(user, "invoices.edit")} canRead={can(user, "meters.read")} />
          </Suspense>

          <CollapsibleSection
            id="payer-invoices"
            title={tr("Facturi pe luni")}
            count={invoices.length}
            summary={last ? `${tr("Ultima")}: ${money(last.grandTotal, last.currency)} · ${tr(INVOICE_STATUS[last.status as InvoiceStatusKey].label)}` : undefined}
          >
            {invoices.length === 0 ? (
              <div className="p-4 text-center text-sm text-ink-soft">{tr("Nicio factură încă.")}</div>
            ) : (
              <div className="max-h-[480px] overflow-auto">
                <table className="w-full min-w-[720px] text-[12px]">
                  <thead className="sticky top-0 z-10 bg-[var(--color-surface-2)]">
                    <tr>
                      <th className={TH}>{tr("Luna")}</th>
                      <th className={TH}>{tr("Factură")}</th>
                      <th className={TH}>{tr("Emisă")}</th>
                      <th className={TH}>{tr("Citiri")}</th>
                      <th className={`${TH} text-right`}>{tr("Calculat")}</th>
                      <th className={`${TH} text-right`}>{tr("Datorie/avans")}</th>
                      <th className={`${TH} text-right`}>{tr("De achitat")}</th>
                      <th className={TH}>{tr("Status")}</th>
                      <th className={TH} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-line)]">
                    {invoices.map((inv) => {
                      const st = INVOICE_STATUS[inv.status as InvoiceStatusKey];
                      // Luna facturii: eticheta perioadei (facturile Apă-Canal o au, ex. "SEPTEMBRIE 2026"), altfel luna emiterii.
                      const luna = inv.billingPeriodLabel || inv.issueDate.toLocaleDateString(dateLoc, { month: "long", year: "numeric", timeZone: "UTC" });
                      const isAc = inv.kind === "APA_CANAL";
                      return (
                        <tr key={inv.id} className="hover:bg-brand-soft/30">
                          <td className={`${TD} font-semibold uppercase`}>{luna}</td>
                          <td className={TD}>{inv.number}</td>
                          <td className={TD}>{fmtDate(inv.issueDate)}</td>
                          <td className={`${TD} tabular-nums`}>{isAc && (inv.meterPrevReading || inv.meterCurrReading) ? <>{inv.meterPrevReading ?? "—"} → {inv.meterCurrReading ?? "—"}</> : "—"}</td>
                          <td className={`${TD} text-right tabular-nums`}>{isAc ? money(inv.subtotal, inv.currency) : "—"}</td>
                          <td className={`${TD} text-right tabular-nums`}>{isAc ? money(inv.datoriiAvans ?? 0, inv.currency) : "—"}</td>
                          <td className={`${TD} text-right font-semibold tabular-nums`}>{money(inv.grandTotal, inv.currency)}</td>
                          <td className={TD}>
                            <span className={`inline-block rounded-full px-2 py-px text-[10px] font-medium ${st.cls}`}>{tr(st.label)}</span>
                          </td>
                          <td className={`${TD} text-right`}>
                            <span className="inline-flex items-center gap-1">
                              <InvoiceViewButton token={inv.publicToken} title={`${luna} · ${inv.number}`} className="tap h-7 cursor-pointer rounded-lg border border-[var(--color-line)] px-2.5 text-xs font-medium hover:bg-[var(--color-surface-2)]" />
                              <Link href={`/invoices/${inv.id}/edit`} className="tap inline-flex h-7 items-center rounded-lg border border-[var(--color-line)] px-2.5 text-xs font-medium hover:bg-[var(--color-surface-2)]">
                                {tr("Editează")}
                              </Link>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CollapsibleSection>

          <CollapsibleSection id="payer-tickets" title={tr("Cereri")} count={tickets.length} defaultOpen={tickets.length > 0}>
            {tickets.length === 0 ? (
              <div className="p-4 text-center text-sm text-ink-soft">{tr("Nicio cerere încă.")}</div>
            ) : (
              <ul className="divide-y divide-[var(--color-line)]">
                {tickets.map((t) => (
                  <li key={t.id}>
                    <Link href={`/tickets/${t.id}`} className="tap flex items-center justify-between gap-3 px-3 py-1.5 hover:bg-brand-soft/30">
                      <span className="min-w-0 truncate text-[13px] font-medium">
                        {t.seq ? `#${t.seq} · ` : ""}
                        {t.title}
                        <span className="ml-2 text-xs font-normal text-ink-soft">{fmtDate(t.createdAt)}</span>
                      </span>
                      <span className="shrink-0 rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                        {TASK_STATUS_RO[t.status] ?? t.status}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CollapsibleSection>
        </div>
      </div>
    </div>
  );
}

/** Contoarele plătitorului, din lista de contoare din memoria serverului (filtrată pe plătitor — se trimit doar ale lui). */
async function PayerMetersBlock({ clientId, canTask, canEditInvoices, canRead }: { clientId: string; canTask: boolean; canEditInvoices: boolean; canRead: boolean }) {
  const snap = await getMeterSnap().catch(() => null);
  const rows = snap ? snap.rows.filter((r) => r.clientId === clientId).map(plainMeter) : [];
  return <PayerMeters clientId={clientId} initial={rows} canTask={canTask} canEditInvoices={canEditInvoices} canRead={canRead} />;
}
