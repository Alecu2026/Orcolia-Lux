import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getPayer, getPayerInvoices, getPayerTickets } from "@/lib/queries/payers";
import { money, fmtDate, INVOICE_STATUS, type InvoiceStatusKey } from "@/app/components/invoice-meta";
import { TASK_STATUS_RO } from "@/lib/telegram";
import PayerActions from "@/app/components/PayerActions";
import PayerNotes from "@/app/components/PayerNotes";
import InvoiceViewButton from "@/app/components/InvoiceViewButton";
import { listPayerNotes } from "@/lib/queries/payer-notify";
import { IconChevronLeft } from "@/app/components/icons";

export const dynamic = "force-dynamic";

export default async function PayerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("payers.view");
  const { id } = await params;

  const payer = await getPayer(id);
  if (!payer) notFound();

  const [invoices, tickets, notes] = await Promise.all([getPayerInvoices(id), getPayerTickets(id), listPayerNotes(id)]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <Link href="/platitori" className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
        <IconChevronLeft className="size-4" /> Înapoi la plătitori
      </Link>

      <div className="card p-5">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold">{payer.name}</h1>
            <p className="mt-1 text-sm text-ink-soft">
              {/* meterSeries e identificatorul cu care clientul se loghează în portal — afișat
                  ca "Cont personal" (nu "Serie contor"), la fel ca pe factură/pagina de login,
                  ca staff-ul să știe exact ce număr să-i dea clientului. */}
              {payer.meterSeries ? <>Cont personal: <b>{payer.meterSeries}</b></> : <>Firmă · Contract 1C: <b>{payer.contract}</b></>}
              {payer.meterNumber && <> · Contor: {payer.meterNumber}</>}
            </p>
            {payer.consumAddress && <p className="text-sm text-ink-soft">{payer.consumAddress}</p>}
          </div>
          {!payer.meterSeries ? (
            <span className="rounded-full bg-[var(--color-surface-2)] px-2.5 py-1 text-xs font-medium text-ink-soft">Fără cont de portal</span>
          ) : payer.activated ? (
            <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-strong">Cont activat</span>
          ) : (
            <span className="rounded-full bg-[var(--color-surface-2)] px-2.5 py-1 text-xs font-medium text-ink-soft">Cont neactivat</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-ink-soft">Email</p>
            <p className="font-medium">{payer.email || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-ink-soft">Telefon</p>
            <p className="font-medium">{payer.phone || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-ink-soft">Activat la</p>
            <p className="font-medium">{payer.portalActivatedAt ? fmtDate(payer.portalActivatedAt) : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-ink-soft">Ultima logare</p>
            <p className="font-medium">{payer.portalLastLoginAt ? fmtDate(payer.portalLastLoginAt) : "—"}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/invoices/new?kind=apa-canal&clientId=${payer.id}`}
          className="tap h-10 rounded-xl bg-brand px-4 text-sm font-semibold leading-10 text-white hover:bg-brand-strong"
        >
          Trimite factură nouă
        </Link>
        {/* "Decontare" — pagină cu fișă tip tabel contabil (un rând per perioadă + rând TOTAL), în
            același spirit cu raportul "Взаиморасчеты с абонентами" pe care îl folosește Apă-Canal
            pentru totaluri (fără jurnalul de plăți — nu-l avem); Excel/CSV/JSON, de acolo. */}
        <Link
          href={`/platitori/${payer.id}/decontare`}
          className="tap inline-flex h-10 items-center gap-1.5 rounded-xl border border-[var(--color-line)] px-4 text-sm font-medium text-ink-soft hover:bg-[var(--color-surface-2)]"
        >
          Decontare
        </Link>
      </div>

      <div>
        <h2 className="mb-2 text-base font-bold">Notițe ({notes.length + (payer.notes ? 1 : 0)})</h2>
        <div className="card p-3">
          <PayerNotes
            payerId={payer.id}
            initial={notes}
            legacy={payer.notes}
            canAdd={can(user, "payers.edit")}
            userId={user.id}
            isAdmin={can(user, "admin")}
          />
        </div>
      </div>

      <PayerActions
        payer={{ id: payer.id, name: payer.name, phone: payer.phone, email: payer.email, notes: payer.notes }}
        canEdit={can(user, "payers.edit")}
        canDelete={can(user, "payers.delete")}
        canAdmin={can(user, "admin")}
      />

      <div>
        <h2 className="mb-2 text-base font-bold">Facturi pe luni ({invoices.length})</h2>
        {invoices.length === 0 ? (
          <div className="card p-6 text-center text-sm text-ink-soft">Nicio factură încă.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {invoices.map((inv) => {
              const st = INVOICE_STATUS[inv.status as InvoiceStatusKey];
              // Luna facturii: eticheta perioadei (facturile Apă-Canal o au, ex. "SEPTEMBRIE 2026"), altfel luna emiterii.
              const luna = inv.billingPeriodLabel || inv.issueDate.toLocaleDateString("ro-RO", { month: "long", year: "numeric", timeZone: "UTC" });
              const isAc = inv.kind === "APA_CANAL";
              return (
                <div key={inv.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-bold uppercase">{luna}</p>
                    <p className="text-xs text-ink-soft">
                      {inv.number} · emisă {fmtDate(inv.issueDate)}
                      {isAc && (inv.meterPrevReading || inv.meterCurrReading) && <> · citiri {inv.meterPrevReading ?? "—"} → {inv.meterCurrReading ?? "—"}</>}
                    </p>
                    {isAc && (
                      <p className="text-xs text-ink-soft">
                        Calculat {money(inv.subtotal, inv.currency)} · Datorie/avans {money(inv.datoriiAvans ?? 0, inv.currency)}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums">{money(inv.grandTotal, inv.currency)}</p>
                      <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{st.label}</span>
                    </div>
                    <InvoiceViewButton token={inv.publicToken} title={`${luna} · ${inv.number}`} />
                    <Link href={`/invoices/${inv.id}/edit`} className="tap h-9 rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium leading-9 hover:bg-[var(--color-surface-2)]">
                      Editează
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-base font-bold">Tichete ({tickets.length})</h2>
        {tickets.length === 0 ? (
          <div className="card p-6 text-center text-sm text-ink-soft">Nicio cerere încă.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {tickets.map((t) => (
              <Link key={t.id} href={`/tickets/${t.id}`} className="card tap flex items-center justify-between p-4 hover:border-brand">
                <div>
                  <p className="text-sm font-semibold">
                    {t.seq ? `#${t.seq} · ` : ""}
                    {t.title}
                  </p>
                  <p className="text-xs text-ink-soft">{fmtDate(t.createdAt)}</p>
                </div>
                <span className="rounded-full bg-[var(--color-surface-2)] px-2.5 py-0.5 text-xs font-medium text-ink-soft">
                  {TASK_STATUS_RO[t.status] ?? t.status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
