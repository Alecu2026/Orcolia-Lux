"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PayerRow } from "@/lib/queries/payers";
import { agoLabel } from "@/lib/payer-notify";
import { INVOICE_STATUS, type InvoiceStatusKey } from "./invoice-meta";
import { IconX } from "./icons";

type Detail = {
  payer: {
    notes: string | null;
    meterNumber: string | null;
    meterCurrReading: number | null;
    portalActivatedAt: string | null;
    portalLastLoginAt: string | null;
  } | null;
  invoices: { id: string; number: string; status: string; grandTotal: number; currency: string; issueDate: string; billingPeriodLabel: string | null }[];
  notifications: { id: string; channel: string; status: string; error: string | null; subject: string | null; body: string; userName: string; createdAt: string }[];
};

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("ro-RO", { timeZone: "Europe/Bucharest", day: "2-digit", month: "2-digit", year: "numeric" });
const money = (n: number, cur = "MDL") =>
  `${n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;

/**
 * Pop-up cu datele unui plătitor, deschis la click pe rând. Se afișează instant cu ce avem deja în tabel;
 * restul (contor, ultimele facturi, istoricul notificărilor) se încarcă din urmă și apare când vine.
 */
export default function PayerDetailDialog({
  row,
  canSend,
  hasContact,
  onSend,
  onClose,
}: {
  row: PayerRow;
  canSend: boolean;
  hasContact: boolean;
  onSend: () => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/platitori/notificari?detail=${row.id}`, { signal: ctl.signal })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Eroare.");
        return j as Detail;
      })
      .then(setDetail)
      .catch((e: Error) => { if (e.name !== "AbortError") setError(e.message); });
    return () => ctl.abort();
  }, [row.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const inv = row.latestInvoice;
  const st = inv ? INVOICE_STATUS[inv.status as InvoiceStatusKey] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card max-h-[92dvh] w-full max-w-xl overflow-auto rounded-b-none rounded-t-2xl p-5 sm:rounded-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold">{row.name}</h2>
            <p className="text-xs text-ink-soft">
              {row.meterSeries ? `Cont personal ${row.meterSeries}` : `Contract ${row.contract ?? "—"}`}
              {" · "}
              {row.activated ? <span className="text-brand-strong">cont portal activat</span> : "cont portal neactivat"}
            </p>
          </div>
          <button onClick={onClose} className="tap grid size-8 shrink-0 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label="Închide">
            <IconX className="size-4" />
          </button>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <Link
            href={`/platitori/${row.id}`}
            target="_blank"
            rel="noreferrer"
            className="tap inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong"
          >
            Deschide pagina plătitorului →
          </Link>
          {canSend && (
            <button
              type="button"
              disabled={!hasContact}
              onClick={onSend}
              title={hasContact ? undefined : "Fără email/telefon valid"}
              className="tap h-9 rounded-lg border border-[var(--color-line)] px-4 text-sm font-medium hover:bg-brand-soft disabled:opacity-40"
            >
              ✉ Trimite notificare
            </button>
          )}
        </div>

        <Section title="Contact">
          <Field label="Email" value={row.email} />
          <Field label="Telefon" value={row.phone} />
          <Field label="Adresă" value={row.consumAddress} wide />
        </Section>

        <Section title="Factura curentă">
          {inv ? (
            <>
              <Field label="Număr" value={inv.number} />
              <Field label="Status" value={st ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{st.label}</span> : null} />
              <Field label="De achitat" value={<b>{money(inv.grandTotal, inv.currency)}</b>} />
              <Field label="Scadență" value={inv.dueDate ? day(inv.dueDate) : null} />
            </>
          ) : (
            <p className="col-span-2 text-sm text-ink-soft">Nicio factură.</p>
          )}
        </Section>

        <Section title="Contor & portal">
          <Field label="Contor instalat" value={row.installedAt ? row.installedAt.split("-").reverse().join(".") : null} />
          <Field label="Nr. contor" value={detail?.payer?.meterNumber} loading={!detail && !error} />
          <Field label="Ultima citire" value={detail?.payer?.meterCurrReading} loading={!detail && !error} />
          <Field label="Ultima logare" value={detail?.payer?.portalLastLoginAt ? day(detail.payer.portalLastLoginAt) : null} loading={!detail && !error} />
          <Field label="Ultima notificare" value={row.lastNotifiedAt ? `${agoLabel(row.lastNotifiedAt)} (${day(row.lastNotifiedAt)})` : "niciodată"} />
          <Field label="Nr. facturi" value={String(row.invoiceCount)} />
        </Section>

        {detail?.payer?.notes && (
          <Section title="Notițe" single>
            <p className="whitespace-pre-wrap text-sm">{detail.payer.notes}</p>
          </Section>
        )}

        <Section title="Ultimele facturi" single>
          {error ? (
            <p className="text-sm text-st-cancelled">{error}</p>
          ) : !detail ? (
            <p className="text-sm text-ink-soft">Se încarcă…</p>
          ) : detail.invoices.length === 0 ? (
            <p className="text-sm text-ink-soft">—</p>
          ) : (
            <ul className="divide-y divide-[var(--color-line)] text-sm">
              {detail.invoices.map((i) => {
                const s = INVOICE_STATUS[i.status as InvoiceStatusKey];
                return (
                  <li key={i.id} className="flex items-center justify-between gap-2 py-1">
                    <span className="min-w-0 truncate">{i.number} <span className="text-xs text-ink-soft">· {i.billingPeriodLabel ?? day(i.issueDate)}</span></span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="tabular-nums">{money(i.grandTotal, i.currency)}</span>
                      {s && <span className={`rounded-full px-1.5 text-[10px] font-medium ${s.cls}`}>{s.label}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="Notificări trimise" single>
          {!detail && !error ? (
            <p className="text-sm text-ink-soft">Se încarcă…</p>
          ) : !detail || detail.notifications.length === 0 ? (
            <p className="text-sm text-ink-soft">Nicio notificare trimisă încă.</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-xs">
              {detail.notifications.map((n) => (
                <li key={n.id} className="rounded-lg bg-[var(--color-surface-2)] px-2.5 py-1.5">
                  <p className="flex items-center justify-between gap-2">
                    <span className="font-semibold">
                      {n.channel === "SMS" ? "💬 SMS" : "✉ Email"}{" "}
                      <span className={n.status === "SENT" ? "text-st-done" : "text-st-cancelled"}>{n.status === "SENT" ? "trimis" : "eșuat"}</span>
                    </span>
                    <span className="text-ink-soft">{new Date(n.createdAt).toLocaleString("ro-RO", { dateStyle: "short", timeStyle: "short" })} · {n.userName}</span>
                  </p>
                  <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-ink-soft">{n.status === "SENT" ? (n.subject ? `${n.subject} — ` : "") + n.body : n.error}</p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children, single }: { title: string; children: React.ReactNode; single?: boolean }) {
  return (
    <section className="mb-3">
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{title}</h3>
      <div className={single ? "" : "grid grid-cols-2 gap-x-4 gap-y-1.5"}>{children}</div>
    </section>
  );
}

function Field({ label, value, wide, loading }: { label: string; value: React.ReactNode; wide?: boolean; loading?: boolean }) {
  const empty = value == null || value === "";
  return (
    <div className={wide ? "col-span-2" : ""}>
      <p className="text-[11px] text-ink-soft">{label}</p>
      <p className="break-words text-sm">{loading ? <span className="text-ink-soft">…</span> : empty ? <span className="text-ink-soft/60">—</span> : value}</p>
    </div>
  );
}
