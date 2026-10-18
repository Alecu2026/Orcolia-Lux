"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PayerRow } from "@/lib/queries/payers";
import { updatePayer } from "@/app/actions/payers";
import { agoLabel, type PayerNoteItem } from "@/lib/payer-notify";
import PayerNotes from "./PayerNotes";
import InvoiceViewButton from "./InvoiceViewButton";
import { INVOICE_STATUS, type InvoiceStatusKey } from "./invoice-meta";
import { useToast } from "./toast";
import { IconX } from "./icons";

type Detail = {
  payer: {
    notes: string | null;
    meterNumber: string | null;
    meterCurrReading: number | null;
    portalActivatedAt: string | null;
    portalLastLoginAt: string | null;
  } | null;
  invoices: { id: string; publicToken: string; number: string; status: string; grandTotal: number; currency: string; issueDate: string; dueDate: string | null; paidAt: string | null; billingPeriodLabel: string | null }[];
  notes: PayerNoteItem[];
  notifications: { id: string; channel: string; status: string; error: string | null; subject: string | null; body: string; userName: string; createdAt: string }[];
};

export type PayerPatch = { name: string; phone: string | null; email: string | null };

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("ro-RO", { timeZone: "Europe/Bucharest", day: "2-digit", month: "2-digit", year: "numeric" });
const money = (n: number, cur = "MDL") =>
  `${n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;

const inputCls =
  "h-8 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-[13px] outline-none focus:border-brand";
const miniBtn =
  "tap inline-flex h-6 cursor-pointer items-center rounded-md border border-[var(--color-line)] px-2 text-[11px] hover:bg-brand-soft";

/**
 * Pop-up cu datele unui plătitor, deschis la click pe rând. Se afișează instant cu ce avem deja în tabel;
 * restul (contor, ultimele facturi, istoricul notificărilor) se încarcă din urmă și apare când vine.
 * „Editează" (nume/telefon/email) e optimist: tabelul se schimbă pe loc, iar la eșec revenim și arătăm eroarea.
 */
export default function PayerDetailDialog({
  row,
  canSend,
  canNote,
  canEditInvoices = false,
  userId,
  isAdmin,
  hasContact,
  onSend,
  onUpdated,
  onClose,
}: {
  row: PayerRow;
  canSend: boolean;
  /** Poate edita plătitorul și adăuga notițe (clients.edit) — și în modul de răsfoire, unde trimiterea e ascunsă. */
  canNote: boolean;
  /** Poate edita facturi (invoices.edit) — arată „Editează" lângă „Vezi". */
  canEditInvoices?: boolean;
  userId: string;
  isAdmin: boolean;
  hasContact: boolean;
  onSend: () => void;
  /** Apelat imediat la salvare (și din nou, cu valorile vechi, dacă serverul refuză) — pagina actualizează tabelul. */
  onUpdated: (id: string, patch: PayerPatch) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "" });
  const [formError, setFormError] = useState<string | null>(null);

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (editing) setEditing(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, editing]);

  function startEdit() {
    setForm({ name: row.name, phone: row.phone ?? "", email: row.email ?? "" });
    setFormError(null);
    setEditing(true);
  }

  function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return setFormError("Numele nu poate fi gol.");
    const patch: PayerPatch = { name, phone: form.phone.trim() || null, email: form.email.trim() || null };
    const old: PayerPatch = { name: row.name, phone: row.phone, email: row.email };
    setEditing(false);
    onUpdated(row.id, patch); // optimist
    const fd = new FormData();
    fd.set("id", row.id);
    fd.set("name", patch.name);
    fd.set("phone", patch.phone ?? "");
    fd.set("email", patch.email ?? "");
    // fără câmpul „notes": notița veche din fișă rămâne neatinsă
    updatePayer(undefined, fd)
      .then((res) => {
        if (res?.error) { onUpdated(row.id, old); toast.error(res.error); }
        else toast.success("Plătitor salvat.");
      })
      .catch(() => { onUpdated(row.id, old); toast.error("Nu am putut salva modificarea."); });
  }

  const inv = row.latestInvoice;
  const st = inv ? INVOICE_STATUS[inv.status as InvoiceStatusKey] : null;
  const pending = !detail && !error;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card max-h-[92dvh] w-full max-w-xl overflow-auto rounded-b-none rounded-t-2xl p-4 sm:rounded-2xl">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold">{row.name}</h2>
            <p className="text-xs text-ink-soft">
              {row.meterSeries ? `Cont personal ${row.meterSeries}` : `Contract ${row.contract ?? "—"}`}
              {" · "}
              {row.activated ? <span className="text-brand-strong">cont portal activat</span> : "cont portal neactivat"}
            </p>
          </div>
          <button onClick={onClose} className="tap grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label="Închide">
            <IconX className="size-4" />
          </button>
        </div>

        <div className="mb-3 flex flex-wrap gap-1.5 border-y border-[var(--color-line)] py-2">
          <Link
            href={`/platitori/${row.id}`}
            target="_blank"
            rel="noreferrer"
            className="tap inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong"
          >
            Pagina plătitorului →
          </Link>
          {canNote && (
            <button
              type="button"
              onClick={editing ? () => setEditing(false) : startEdit}
              className={`tap h-8 cursor-pointer rounded-lg border px-3 text-xs font-medium hover:bg-brand-soft ${editing ? "border-brand bg-brand/10 text-brand" : "border-[var(--color-line)]"}`}
            >
              ✎ Editează
            </button>
          )}
          {canSend && (
            <button
              type="button"
              disabled={!hasContact}
              onClick={onSend}
              title={hasContact ? undefined : "Fără email/telefon valid"}
              className="tap h-8 cursor-pointer rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium hover:bg-brand-soft disabled:cursor-default disabled:opacity-40"
            >
              ✉ Trimite notificare
            </button>
          )}
        </div>

        {editing ? (
          <Section title="Editează plătitorul">
            <form onSubmit={saveEdit} className="flex flex-col gap-2 p-2.5">
              <label className="text-[11px] font-semibold text-ink-soft">
                Nume
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus required className={`${inputCls} mt-0.5 font-normal`} />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] font-semibold text-ink-soft">
                  Telefon
                  <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" className={`${inputCls} mt-0.5 font-normal`} />
                </label>
                <label className="text-[11px] font-semibold text-ink-soft">
                  Email
                  <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} type="email" className={`${inputCls} mt-0.5 font-normal`} />
                </label>
              </div>
              {formError && <p className="text-xs text-st-cancelled">{formError}</p>}
              <div className="flex justify-end gap-1.5">
                <button type="button" onClick={() => setEditing(false)} className="tap h-8 cursor-pointer rounded-lg border border-[var(--color-line)] px-3 text-xs hover:bg-[var(--color-surface-2)]">
                  Anulează
                </button>
                <button type="submit" className="tap h-8 cursor-pointer rounded-lg bg-brand px-4 text-xs font-semibold text-white hover:bg-brand-strong">
                  Salvează
                </button>
              </div>
            </form>
          </Section>
        ) : (
          <Section title="Contact">
            <Item label="Email" value={row.email} />
            <Item label="Telefon" value={row.phone} />
            <Item label="Adresă" value={row.consumAddress} />
          </Section>
        )}

        <Section title="Factura curentă">
          {inv ? (
            <>
              <Item label="Număr" value={inv.number} />
              <Item label="Status" value={st ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{st.label}</span> : null} />
              <Item label="De achitat" value={<b>{money(inv.grandTotal, inv.currency)}</b>} />
              <Item label="Scadență" value={inv.dueDate ? day(inv.dueDate) : null} />
            </>
          ) : (
            <p className="px-2.5 py-2 text-sm text-ink-soft">Nicio factură.</p>
          )}
        </Section>

        <Section title="Contor & portal">
          <Item label="Contor instalat" value={row.installedAt ? row.installedAt.split("-").reverse().join(".") : null} />
          <Item label="Nr. contor" value={detail?.payer?.meterNumber} loading={pending} />
          <Item label="Ultima citire" value={detail?.payer?.meterCurrReading} loading={pending} />
          <Item label="Ultima logare în portal" value={detail?.payer?.portalLastLoginAt ? day(detail.payer.portalLastLoginAt) : null} loading={pending} />
          <Item label="Ultima notificare" value={row.lastNotifiedAt ? `${agoLabel(row.lastNotifiedAt)} (${day(row.lastNotifiedAt)})` : "niciodată"} />
          <Item label="Nr. facturi" value={String(row.invoiceCount)} />
        </Section>

        <Section title="Notițe">
          <div className="p-2.5">
            {detail ? (
              <PayerNotes payerId={row.id} initial={detail.notes} legacy={detail.payer?.notes} canAdd={canNote} userId={userId} isAdmin={isAdmin} compact />
            ) : (
              <p className="text-sm text-ink-soft">{error ?? "Se încarcă…"}</p>
            )}
          </div>
        </Section>

        <Section title="Ultimele facturi">
          {error ? (
            <p className="px-2.5 py-2 text-sm text-st-cancelled">{error}</p>
          ) : !detail ? (
            <p className="px-2.5 py-2 text-sm text-ink-soft">Se încarcă…</p>
          ) : detail.invoices.length === 0 ? (
            <p className="px-2.5 py-2 text-sm text-ink-soft">—</p>
          ) : (
            <ul className="divide-y divide-[var(--color-line)] text-sm">
              {detail.invoices.map((i) => {
                const s = INVOICE_STATUS[i.status as InvoiceStatusKey];
                return (
                  <li key={i.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                    <span className="min-w-0">
                      <span className="block truncate">{i.number} <span className="text-xs text-ink-soft">· {i.billingPeriodLabel ?? ""}</span></span>
                      <span className="block text-[11px] text-ink-soft">
                        emisă {day(i.issueDate)}
                        {i.dueDate && <> · scadentă {day(i.dueDate)}</>}
                        {i.status === "PAID" && <> · <span className="text-st-done">achitată {i.paidAt ? day(i.paidAt) : "(data necunoscută)"}</span></>}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="text-right">
                        <span className="block tabular-nums">{money(i.grandTotal, i.currency)}</span>
                        {s && <span className={`inline-block rounded-full px-1.5 text-[10px] font-medium ${s.cls}`}>{s.label}</span>}
                      </span>
                      <InvoiceViewButton token={i.publicToken} title={`${i.billingPeriodLabel ?? ""} · ${i.number}`} className={miniBtn} />
                      {canEditInvoices && (
                        <Link href={`/invoices/${i.id}/edit`} className={miniBtn}>Editează</Link>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="Notificări trimise">
          {!detail && !error ? (
            <p className="px-2.5 py-2 text-sm text-ink-soft">Se încarcă…</p>
          ) : !detail || detail.notifications.length === 0 ? (
            <p className="px-2.5 py-2 text-sm text-ink-soft">Nicio notificare trimisă încă.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-line)] text-xs">
              {detail.notifications.map((n) => (
                <li key={n.id} className="px-2.5 py-1.5">
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

/** Casetă cu titlu pe fundal ușor și linie despărțitoare — ca informația să fie delimitată clar. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-2.5 overflow-hidden rounded-lg border border-[var(--color-line)]">
      <h3 className="border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
        {title}
      </h3>
      <div className="divide-y divide-[var(--color-line)]">{children}</div>
    </section>
  );
}

/** Un rând „etichetă — valoare", separat de următorul printr-o linie. */
function Item({ label, value, loading }: { label: string; value: React.ReactNode; loading?: boolean }) {
  const empty = value == null || value === "";
  return (
    <div className="flex items-baseline justify-between gap-3 px-2.5 py-1.5">
      <span className="shrink-0 text-[11px] text-ink-soft">{label}</span>
      <span className="min-w-0 break-words text-right text-[13px]">
        {loading ? <span className="text-ink-soft">…</span> : empty ? <span className="text-ink-soft/60">—</span> : value}
      </span>
    </div>
  );
}
