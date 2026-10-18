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
import ApaCanalJsonImport from "./ApaCanalJsonImport";
import InvoiceViewButton from "./InvoiceViewButton";

type Row = {
  id: string;
  number: string;
  status: InvoiceStatusKey;
  kind: "STANDARD" | "APA_CANAL";
  issueDate: string | Date;
  dueDate: string | Date | null;
  paidAt?: string | Date | null;
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
  canImportApaCanal = false,
}: {
  items: Row[];
  hasMore: boolean;
  page: number;
  status: string;
  q: string;
  origin: string;
  canImportApaCanal?: boolean;
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
    setRows((cur) => cur.map((r) => (r.id === id ? { ...r, status: s, paidAt: s === "PAID" ? (r.paidAt ?? new Date().toISOString()) : null } : r)));
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

  const pageTotal = rows.reduce((sum, r) => sum + (r.status === "CANCELLED" ? 0 : r.grandTotal), 0);

  return (
    <>
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={m.invoices.searchPlaceholder}
          className={`h-7 min-w-48 flex-1 rounded-lg border px-2 text-[11px] outline-none focus:border-brand ${
            search ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)]"
          }`}
        />
        <select
          value={status}
          onChange={(e) => navigate({ status: e.target.value, page: 1 })}
          className={`h-7 appearance-none sel-arrow rounded-lg border pl-1.5 pr-6 text-[11px] outline-none focus:border-brand ${
            status ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)]"
          }`}
          aria-label="Status"
        >
          <option value="">Status: {m.invoices.filterAll.toLowerCase()}</option>
          {INVOICE_STATUS_LIST.map((s) => (
            <option key={s} value={s}>{INVOICE_STATUS[s].label}</option>
          ))}
        </select>
        {(status || q) && (
          <button
            type="button"
            onClick={() => { setSearch(""); navigate({ status: "", q: "", page: 1 }); }}
            className="tap h-7 cursor-pointer rounded-lg border border-[var(--color-line)] px-2 text-[11px] text-ink-soft hover:bg-[var(--color-surface-2)]"
          >
            Resetează filtrele
          </button>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {canImportApaCanal && (
            <ApaCanalJsonImport className="tap inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-[var(--color-line)] px-2.5 text-[11px] font-medium text-ink-soft hover:bg-[var(--color-surface-2)]" />
          )}
          <Link
            href="/invoices/new"
            className="tap inline-flex h-7 cursor-pointer items-center rounded-lg bg-brand px-3 text-[11px] font-semibold text-white hover:bg-brand-strong"
          >
            {m.invoices.new}
          </Link>
        </div>
      </div>

      <div className="mb-1 flex flex-wrap items-center gap-x-3 text-xs">
        <span><b>{rows.length}</b>{hasMore ? "+" : ""} facturi pe această pagină</span>
        <span className="text-ink-soft">Σ pagină: <b className="tabular-nums text-ink">{money(pageTotal, rows[0]?.currency ?? "MDL")}</b></span>
      </div>

      <div className="card overflow-auto">
        <table className="w-max min-w-full border-separate border-spacing-0 text-[11px] leading-[14px]">
          <thead className="bg-[var(--color-surface-2)]">
            <tr>
              <Th minW={120}>Număr</Th>
              <Th minW={200}>Client</Th>
              <Th minW={80}>Emisă</Th>
              <Th minW={80}>Scadență</Th>
              <Th minW={80}>Achitată</Th>
              <Th minW={90} right>Sumă</Th>
              <Th minW={95}>Status</Th>
              <Th minW={250}>Acțiuni</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = INVOICE_STATUS[r.status];
              const late = r.status !== "PAID" && r.status !== "CANCELLED" && isPastDate(r.dueDate);
              const cell = "border-b border-[var(--color-line)] px-1.5 py-[2px]";
              return (
                <tr key={r.id} className="hover:bg-brand-soft/30">
                  <td className={`${cell} whitespace-nowrap font-semibold`}>
                    {r.number}
                    {r.kind === "APA_CANAL" && (
                      <span className="ml-1.5 rounded bg-sky-100 px-1 text-[9px] font-semibold text-sky-700">Apă-Canal</span>
                    )}
                  </td>
                  <td className={cell} style={{ maxWidth: 260 }}>
                    <div className="truncate" title={r.clientName ?? ""}>{r.clientName ?? <span className="text-ink-soft/60">{m.invoices.noClient}</span>}</div>
                  </td>
                  <td className={`${cell} whitespace-nowrap`}>{fmtDate(r.issueDate)}</td>
                  <td className={`${cell} whitespace-nowrap ${late ? "font-semibold text-st-cancelled" : ""}`} title={late ? "Scadența a trecut" : undefined}>{fmtDate(r.dueDate)}</td>
                  <td className={`${cell} whitespace-nowrap`}>
                    {r.status === "PAID" ? (
                      r.paidAt ? <span className="text-st-done">{fmtDate(r.paidAt)}</span> : <span className="text-ink-soft/70" title="Marcată plătită, dar data nu s-a înregistrat">?</span>
                    ) : <span className="text-ink-soft/60">—</span>}
                  </td>
                  <td className={`${cell} whitespace-nowrap text-right font-semibold tabular-nums`}>{money(r.grandTotal, r.currency)}</td>
                  <td className={cell}>
                    <select
                      value={r.status}
                      onChange={(e) => changeStatus(r.id, e.target.value as InvoiceStatusKey)}
                      className={`h-[18px] cursor-pointer rounded-full border-0 px-1.5 text-[10px] font-medium outline-none ${st.cls}`}
                      aria-label={`Status ${r.number}`}
                    >
                      {INVOICE_STATUS_LIST.map((s) => (
                        <option key={s} value={s}>{INVOICE_STATUS[s].label}</option>
                      ))}
                    </select>
                  </td>
                  <td className={cell}>
                    <div className="flex items-center gap-1">
                      <InvoiceViewButton token={r.publicToken} title={`${r.number}${r.clientName ? ` · ${r.clientName}` : ""}`} className={btn} />
                      <Link href={`/invoices/${r.id}/edit`} className={btn}>{m.common.edit}</Link>
                      <button type="button" onClick={() => copyLink(r.publicToken)} className={btn}>
                        {copied === r.publicToken ? m.invoices.copied : m.invoices.copyLink}
                      </button>
                      <a href={`/invoice/public/${r.publicToken}`} target="_blank" rel="noopener noreferrer" className={btn}>
                        {m.invoices.publicPdf} ↗
                      </a>
                      <button type="button" onClick={() => remove(r.id)} className={`${btn} text-st-cancelled`} title={m.common.delete} aria-label={m.common.delete}>
                        <IconTrash className="size-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="p-8 text-center text-ink-soft">{m.invoices.noInvoices}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {(page > 1 || hasMore) && (
        <div className="mt-3 flex items-center justify-between">
          <button disabled={page <= 1} onClick={() => navigate({ page: page - 1 })} className="tap card inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg px-2.5 text-xs font-medium disabled:cursor-default disabled:opacity-40">
            <IconChevronLeft className="size-3.5" /> {m.common.previous}
          </button>
          <span className="text-xs text-ink-soft">Pagina {page}</span>
          <button disabled={!hasMore} onClick={() => navigate({ page: page + 1 })} className="tap card inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg px-2.5 text-xs font-medium disabled:cursor-default disabled:opacity-40">
            {m.common.next} <IconChevronRight className="size-3.5" />
          </button>
        </div>
      )}
    </>
  );
}

const btn =
  "tap inline-flex h-5 cursor-pointer items-center rounded border border-[var(--color-line)] px-1.5 text-[10px] leading-none hover:bg-brand-soft";

/** Scadența a trecut? (în afara componentei, ca randarea să rămână pură). */
function isPastDate(d: string | Date | null): boolean {
  return !!d && new Date(d).getTime() < Date.now();
}

function Th({ children, minW, right }: { children: React.ReactNode; minW: number; right?: boolean }) {
  return (
    <th
      style={{ minWidth: minW }}
      className={`border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-1.5 py-1 font-semibold ${right ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  );
}
