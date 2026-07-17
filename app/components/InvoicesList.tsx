"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setInvoiceStatus, deleteInvoice } from "@/app/actions/invoices";
import {
  INVOICE_STATUS,
  INVOICE_STATUS_LIST,
  money,
  fmtDate,
  type InvoiceStatusKey,
} from "./invoice-meta";
import { useToast } from "./toast";
import { IconTrash, IconChevronLeft, IconChevronRight } from "./icons";
import { useMessages } from "@/lib/i18n/context";

type Row = {
  id: string;
  number: string;
  status: InvoiceStatusKey;
  issueDate: string | Date;
  dueDate: string | Date | null;
  grandTotal: number;
  currency: string;
  clientName: string | null;
  publicToken: string;
};

export default function InvoicesList({
  items,
  hasMore,
  page,
  status,
  q,
  origin,
}: {
  items: Row[];
  hasMore: boolean;
  page: number;
  status: string;
  q: string;
  origin: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const m = useMessages();
  const [rows, setRows] = useState(items);
  useEffect(() => setRows(items), [items]);
  const [search, setSearch] = useState(q);
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function navigate(params: Record<string, string | number>) {
    const sp = new URLSearchParams();
    const merged = { status, q, page, ...params };
    if (merged.status) sp.set("status", String(merged.status));
    if (merged.q) sp.set("q", String(merged.q));
    if (merged.page && Number(merged.page) > 1) sp.set("page", String(merged.page));
    router.push(`/invoices${sp.toString() ? `?${sp}` : ""}`);
  }

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (search === q) return;
    timer.current = setTimeout(() => navigate({ q: search, page: 1 }), 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function changeStatus(id: string, s: InvoiceStatusKey) {
    const prev = rows;
    setRows((cur) => cur.map((r) => (r.id === id ? { ...r, status: s } : r)));
    setInvoiceStatus(id, s).then((res) => {
      if (!res.ok) {
        setRows(prev);
        toast.error(res.error ?? m.common.error);
      } else {
        toast.success(`Status: ${INVOICE_STATUS[s].label}`);
      }
    });
  }

  function remove(id: string) {
    if (!confirm(m.invoices.deleteConfirm)) return;
    const prev = rows;
    setRows((cur) => cur.filter((r) => r.id !== id));
    deleteInvoice(id)
      .then(() => toast.success(m.invoices.deleted))
      .catch(() => {
        setRows(prev);
        toast.error(m.invoices.deleteFailed);
      });
  }

  async function copyLink(token: string) {
    const url = `${origin}/invoice/public/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(token);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      prompt(m.invoices.copyLink + ":", url);
    }
  }

  return (
    <>
      <div className="mb-3 flex gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={m.invoices.searchPlaceholder}
          className="h-11 flex-1 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-sm outline-none focus:border-brand"
        />
        <select
          value={status}
          onChange={(e) => navigate({ status: e.target.value, page: 1 })}
          className="h-11 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-sm outline-none"
        >
          <option value="">{m.invoices.filterAll}</option>
          {INVOICE_STATUS_LIST.map((s) => (
            <option key={s} value={s}>{INVOICE_STATUS[s].label}</option>
          ))}
        </select>
      </div>

      <Link
        href="/invoices/new"
        className="tap mb-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong"
      >
        {m.invoices.new}
      </Link>

      {rows.length === 0 ? (
        <div className="card grid place-items-center p-10 text-center text-sm text-ink-soft">
          {m.invoices.noInvoices}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((r) => (
            <div key={r.id} className="card p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{r.number}</p>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    {r.clientName ?? m.invoices.noClient} · {m.invoices.issuedOn} {fmtDate(r.issueDate)} · {m.invoices.dueOn} {fmtDate(r.dueDate)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold">{money(r.grandTotal, r.currency)}</p>
                  <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${INVOICE_STATUS[r.status].cls}`}>
                    {INVOICE_STATUS[r.status].label}
                  </span>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <select
                  value={r.status}
                  onChange={(e) => changeStatus(r.id, e.target.value as InvoiceStatusKey)}
                  className="h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-xs outline-none"
                >
                  {INVOICE_STATUS_LIST.map((s) => (
                    <option key={s} value={s}>{INVOICE_STATUS[s].label}</option>
                  ))}
                </select>
                {r.status === "DRAFT" && (
                  <Link href={`/invoices/${r.id}/edit`} className="tap rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-xs hover:bg-[var(--color-surface-2)]">
                    {m.common.edit}
                  </Link>
                )}
                <button onClick={() => copyLink(r.publicToken)} className="tap rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-xs hover:bg-[var(--color-surface-2)]">
                  {copied === r.publicToken ? m.invoices.copied : m.invoices.copyLink}
                </button>
                <a href={`/invoice/public/${r.publicToken}`} target="_blank" rel="noopener noreferrer" className="tap rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-xs hover:bg-[var(--color-surface-2)]">
                  {m.invoices.publicPdf}
                </a>
                <button onClick={() => remove(r.id)} className="tap ml-auto grid size-8 place-items-center rounded-lg border border-[var(--color-line)] text-st-cancelled hover:bg-[var(--color-surface-2)]" title={m.common.delete}>
                  <IconTrash className="size-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(page > 1 || hasMore) && (
        <div className="mt-5 flex items-center justify-between">
          <button disabled={page <= 1} onClick={() => navigate({ page: page - 1 })} className="tap card inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-40">
            <IconChevronLeft className="size-4" /> {m.common.previous}
          </button>
          <span className="text-sm text-ink-soft">Pagina {page}</span>
          <button disabled={!hasMore} onClick={() => navigate({ page: page + 1 })} className="tap card inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-40">
            {m.common.next} <IconChevronRight className="size-4" />
          </button>
        </div>
      )}
    </>
  );
}
