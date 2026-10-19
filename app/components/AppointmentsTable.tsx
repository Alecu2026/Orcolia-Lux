"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { setStatus as setStatusAction, deleteAppointment } from "@/app/actions/appointments";
import DataTable, { type Col, type Filter } from "./DataTable";
import ExportButton from "./ExportButton";
import ImportButton from "./ImportButton";
import OpenQuickAddButton from "./OpenQuickAddButton";
import AutoOpenQuickAdd from "./AutoOpenQuickAdd";
import { QuickAddProvider } from "./quick-add-context";
import { APPT_STATUSES, ApptStatusDropdown, apptLabel } from "./AppointmentItem";
import { useToast } from "./toast";
import { IconMail, IconSend, IconTrash, IconX } from "./icons";
import { humanDay } from "@/lib/date";
import { useMessages } from "@/lib/i18n/context";
import type { ApptStatus, ApptVM, CategoryLite, QuickDefaults } from "./types";

const iconBtn =
  "tap grid size-5 cursor-pointer place-items-center rounded border border-[var(--color-line)] hover:bg-brand-soft";
const topBtn =
  "tap inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-[var(--color-line)] px-2 text-[11px] text-ink-soft hover:bg-[var(--color-surface-2)]";

const dmy = (key: string) => key.split("-").reverse().join(".");

/** Programări — tabel dens cu filtre locale (ca la Plătitori). Click pe rând = popup; statusul se schimbă direct din rând. */
export default function AppointmentsTable({
  items,
  categories,
  quickDefaults,
  initialCreate,
  today,
  tz,
}: {
  items: ApptVM[];
  categories: CategoryLite[];
  quickDefaults: QuickDefaults;
  initialCreate?: boolean;
  today: string;
  tz: string;
}) {
  const toast = useToast();
  const m = useMessages();
  const [rows, setRows] = useState(items);
  useEffect(() => setRows(items), [items]);
  const [busy, setBusy] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  async function change(id: string, next: ApptStatus) {
    const prev = rows;
    if (prev.find((r) => r.id === id)?.status === next) return;
    setRows((cur) => cur.map((r) => (r.id === id ? { ...r, status: next } : r))); // optimist
    setBusy(id);
    const res = await setStatusAction(id, next);
    setBusy(null);
    if (res?.error) { setRows(prev); toast.error(res.error); }
    else toast.success(`Status: ${apptLabel(next, m)}`);
  }

  function remove(id: string) {
    if (!confirm(m.appts.deleteConfirm)) return;
    const prev = rows;
    setRows((cur) => cur.filter((r) => r.id !== id));
    setDetail((d) => (d === id ? null : d));
    deleteAppointment(id)
      .then(() => toast.success(m.appts.deleted))
      .catch(() => { setRows(prev); toast.error(m.common.deleteFailed); });
  }

  const dash = <span className="text-ink-soft/60">—</span>;
  const columns: Col<ApptVM>[] = [
    { key: "date", label: "Data", minW: 100, sticky: true, sort: (a) => `${a.dateKey} ${a.time}`, render: (a) => <span className={a.dateKey === today ? "font-semibold text-brand" : ""}>{dmy(a.dateKey)}</span> },
    { key: "time", label: "Ora", minW: 90, sort: (a) => a.time, render: (a) => <span className="font-mono">{a.time}–{a.endTime}</span> },
    { key: "client", label: "Client", minW: 180, maxW: 240, sort: (a) => a.clientName, render: (a) => <span title={a.clientName}>{a.clientName}</span> },
    { key: "title", label: "Descriere", minW: 180, maxW: 280, render: (a) => a.title || dash },
    {
      key: "cat", label: "Categorie", minW: 110, sort: (a) => a.categoryName,
      render: (a) => (a.categoryName ? <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full" style={{ background: a.categoryColor ?? "#6366f1" }} />{a.categoryName}</span> : dash),
    },
    {
      key: "status", label: "Status", minW: 100, sort: (a) => apptLabel(a.status, m),
      render: (a) => (
        <div className="origin-left scale-90" onClick={(e) => e.stopPropagation()}>
          <ApptStatusDropdown status={a.status} pending={busy === a.id} onChange={(s) => change(a.id, s)} />
        </div>
      ),
    },
    { key: "rem", label: "Remindere", minW: 70, render: (a) => (a.remEmail || a.remTelegram ? <span className="inline-flex items-center gap-1 text-ink-soft">{a.remEmail && <IconMail className="size-3" />}{a.remTelegram && <IconSend className="size-3" />}</span> : dash) },
    {
      key: "act", label: "", minW: 40,
      render: (a) => (
        <div onClick={(e) => e.stopPropagation()}>
          <button type="button" className={`${iconBtn} text-st-cancelled`} title={m.common.delete} onClick={() => remove(a.id)}><IconTrash className="size-3" /></button>
        </div>
      ),
    },
  ];

  const filters = useMemo<Filter<ApptVM>[]>(() => {
    const tomorrow = quickDefaults.tomorrow;
    return [
      {
        kind: "text", key: "q", label: "Caută", grow: true, placeholder: m.appts.searchPlaceholder,
        test: (a, v) => a.clientName.toLowerCase().includes(v) || a.title.toLowerCase().includes(v),
      },
      {
        kind: "select", key: "period", label: "Perioadă: toate",
        options: [
          { value: "today", label: m.appts.viewToday },
          { value: "tomorrow", label: m.appts.viewTomorrow },
          { value: "future", label: "De azi încolo" },
          { value: "past", label: "Trecute" },
        ],
        test: (a, v) => (v === "today" ? a.dateKey === today : v === "tomorrow" ? a.dateKey === tomorrow : v === "future" ? a.dateKey >= today : a.dateKey < today),
      },
      {
        kind: "select", key: "status", label: m.appts.filterStatusAll,
        options: APPT_STATUSES.map((s) => ({ value: s, label: apptLabel(s, m) })),
        test: (a, v) => a.status === v,
      },
      ...(categories.length
        ? [{
            kind: "select" as const, key: "cat", label: m.appts.filterCategoryAll,
            options: categories.map((c) => ({ value: c.name, label: c.name })),
            test: (a: ApptVM, v: string) => a.categoryName === v,
          }]
        : []),
      { kind: "date", key: "from", label: "De la data", test: (a, v) => a.dateKey >= v },
      { kind: "date", key: "to", label: "Până la data", test: (a, v) => a.dateKey <= v },
      {
        kind: "select", key: "rem", label: "Remindere: toate",
        options: [{ value: "any", label: "Cu remindere" }, { value: "none", label: "Fără remindere" }],
        test: (a, v) => (v === "any" ? a.remEmail || a.remTelegram : !a.remEmail && !a.remTelegram),
      },
    ];
  }, [m, categories, today, quickDefaults.tomorrow]);

  const current = detail ? rows.find((r) => r.id === detail) ?? null : null;

  return (
    <QuickAddProvider categories={categories} defaults={quickDefaults}>
      {initialCreate && <AutoOpenQuickAdd />}
      <DataTable
        storageKey="appointments"
        rows={rows}
        columns={columns}
        filters={filters}
        defaultSort={{ key: "date", dir: "desc" }}
        noun="programări"
        emptyText={m.appts.noAppts}
        onRowClick={(a) => setDetail(a.id)}
        toolbar={
          <>
            <ExportButton entity="appointments" className={topBtn} />
            <ImportButton entity="appointments" className={topBtn} />
            <OpenQuickAddButton className="tap inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg bg-brand px-3 text-[11px] font-semibold text-white hover:bg-brand-strong" />
          </>
        }
      />
      {current && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && setDetail(null)}>
          <div className="card w-full max-w-md rounded-b-none rounded-t-2xl p-4 sm:rounded-2xl">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-bold">{current.clientName}</h2>
                <p className="text-xs capitalize text-ink-soft">{humanDay(current.dateKey, tz)} · {current.time}–{current.endTime}</p>
              </div>
              <button onClick={() => setDetail(null)} className="tap grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={m.common.close}>
                <IconX className="size-4" />
              </button>
            </div>
            <div className="mb-3 flex flex-wrap gap-1.5 border-y border-[var(--color-line)] py-2">
              <Link href={`/calendar?date=${current.dateKey}`} className="tap inline-flex h-8 cursor-pointer items-center rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong">Vezi în calendar →</Link>
              <button type="button" onClick={() => remove(current.id)} className="tap h-8 cursor-pointer rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium text-st-cancelled hover:bg-[var(--color-surface-2)]">🗑 {m.common.delete}</button>
            </div>
            <div className="divide-y divide-[var(--color-line)] overflow-hidden rounded-lg border border-[var(--color-line)] text-sm">
              <Row label="Status"><ApptStatusDropdown status={current.status} pending={busy === current.id} onChange={(s) => change(current.id, s)} /></Row>
              <Row label="Categorie">{current.categoryName ?? "—"}</Row>
              <Row label="Remindere">{current.remEmail || current.remTelegram ? `${current.remEmail ? "email " : ""}${current.remTelegram ? "telegram" : ""}` : "—"}</Row>
              {current.title && <div className="px-2.5 py-1.5"><p className="mb-0.5 text-[11px] text-ink-soft">Descriere</p><p className="whitespace-pre-wrap text-[13px]">{current.title}</p></div>}
            </div>
          </div>
        </div>
      )}
    </QuickAddProvider>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
      <span className="text-[11px] text-ink-soft">{label}</span>
      <span className="text-right text-[13px]">{children}</span>
    </div>
  );
}
