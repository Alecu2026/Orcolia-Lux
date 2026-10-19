"use client";

import { useEffect, useMemo, useState } from "react";
import { deleteClient, updateClientFieldAction, type ClientFieldPatch } from "@/app/actions/clients";
import ClientDialog, { type ClientEdit } from "./ClientDialog";
import DataTable, { type Col, type Filter } from "./DataTable";
import { EditableText } from "./InlineCells";
import ExportButton from "./ExportButton";
import ImportButton from "./ImportButton";
import { useToast } from "./toast";
import { IconPencil, IconTrash } from "./icons";
import { agoLabel } from "@/lib/payer-notify";
import { useMessages } from "@/lib/i18n/context";

export type ClientRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  telegramChatId: string | null;
  notes: string | null;
  noShowCount: number;
  lastAppointmentAt: string | null;
};

const DAY = 86_400_000;
const toEdit = (c: ClientRow): ClientEdit => ({
  id: c.id, name: c.name, phone: c.phone, email: c.email, telegramChatId: c.telegramChatId, notes: c.notes,
});
const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("ro-RO", { timeZone: "Europe/Bucharest", day: "2-digit", month: "2-digit", year: "numeric" });

const iconBtn =
  "tap grid size-5 cursor-pointer place-items-center rounded border border-[var(--color-line)] hover:bg-brand-soft";
const topBtn =
  "tap inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-[var(--color-line)] px-2 text-[11px] text-ink-soft hover:bg-[var(--color-surface-2)]";

/** Clienți (CRM) — același tabel dens, cu filtre locale, ca la Plătitori. Click pe rând = editare. */
export default function ClientsTable({ items, openCreate, canEdit = true }: { items: ClientRow[]; openCreate?: boolean; canEdit?: boolean }) {
  const toast = useToast();
  const m = useMessages();
  const [rows, setRows] = useState(items);
  useEffect(() => setRows(items), [items]);
  const [dialog, setDialog] = useState<{ open: boolean; client: ClientEdit | null }>({ open: !!openCreate, client: null });

  function remove(id: string) {
    if (!confirm(m.clients.deleteConfirm)) return;
    const prev = rows;
    setRows((r) => r.filter((c) => c.id !== id)); // optimist
    deleteClient(id)
      .then(() => toast.success(m.clients.deleted))
      .catch(() => { setRows(prev); toast.error(m.clients.deleteFailed); });
  }

  /** Editare dintr-un câmp: se schimbă imediat în tabel (optimist), serverul confirmă; la eșec revenim + mesaj. */
  function patchClient(c: ClientRow, patch: ClientFieldPatch, optimistic: Partial<ClientRow>) {
    const prev = rows;
    setRows((cur) => cur.map((x) => (x.id === c.id ? { ...x, ...optimistic } : x)));
    updateClientFieldAction(c.id, patch)
      .then((res) => { if (res?.error) { setRows(prev); toast.error(res.error); } })
      .catch(() => { setRows(prev); toast.error(m.common.error); });
  }

  const columns: Col<ClientRow>[] = [
    {
      key: "name", label: "Client", minW: 200, maxW: 280, sticky: true, sort: (c) => c.name,
      render: (c) => <EditableText value={c.name} disabled={!canEdit} onSave={(v) => patchClient(c, { name: v }, { name: v })} display={<span title={c.name}>{c.name}</span>} />,
    },
    {
      key: "phone", label: "Telefon", minW: 120, sort: (c) => c.phone,
      render: (c) => <EditableText value={c.phone ?? ""} type="tel" allowEmpty disabled={!canEdit} onSave={(v) => patchClient(c, { phone: v || null }, { phone: v || null })} />,
    },
    {
      key: "email", label: "Email", minW: 170, maxW: 220, sort: (c) => c.email,
      render: (c) => <EditableText value={c.email ?? ""} type="email" allowEmpty disabled={!canEdit} onSave={(v) => patchClient(c, { email: v || null }, { email: v || null })} />,
    },
    { key: "tg", label: "Telegram", minW: 70, render: (c) => (c.telegramChatId ? <span className="text-st-done">✓ conectat</span> : <span className="text-ink-soft/60">—</span>) },
    { key: "abs", label: m.clients.absences, minW: 60, right: true, sort: (c) => c.noShowCount, render: (c) => (c.noShowCount > 0 ? <span className="font-semibold text-st-noshow">{c.noShowCount}</span> : <span className="text-ink-soft/60">0</span>) },
    {
      key: "last", label: "Ultima programare", minW: 130,
      sort: (c) => (c.lastAppointmentAt ? new Date(c.lastAppointmentAt).getTime() : null),
      render: (c) => (c.lastAppointmentAt ? <span>{fmtDay(c.lastAppointmentAt)} <span className="text-ink-soft">· {agoLabel(c.lastAppointmentAt)}</span></span> : <span className="text-ink-soft/60">niciodată</span>),
    },
    {
      key: "notes", label: "Notițe", minW: 180, maxW: 280,
      render: (c) => <EditableText value={c.notes ?? ""} allowEmpty disabled={!canEdit} onSave={(v) => patchClient(c, { notes: v || null }, { notes: v || null })} display={c.notes ? <span title={c.notes}>{c.notes}</span> : undefined} />,
    },
    {
      key: "act", label: "", minW: 60,
      render: (c) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button type="button" className={iconBtn} title={m.common.edit} onClick={() => setDialog({ open: true, client: toEdit(c) })}><IconPencil className="size-3" /></button>
          <button type="button" className={`${iconBtn} text-st-cancelled`} title={m.common.delete} onClick={() => remove(c.id)}><IconTrash className="size-3" /></button>
        </div>
      ),
    },
  ];

  const filters = useMemo<Filter<ClientRow>[]>(
    () => [
      {
        kind: "text", key: "q", label: "Caută", grow: true, placeholder: "Caută nume, telefon, email, notițe…",
        test: (c, v) => [c.name, c.phone, c.email, c.notes].some((x) => (x ?? "").toLowerCase().includes(v)),
      },
      {
        kind: "select", key: "contact", label: "Contact: toți",
        options: [{ value: "phone", label: "Au telefon" }, { value: "email", label: "Au email" }, { value: "both", label: "Au telefon și email" }, { value: "none", label: "Fără contact" }],
        test: (c, v) => {
          const p = !!c.phone;
          const e = !!c.email;
          return v === "phone" ? p : v === "email" ? e : v === "both" ? p && e : !p && !e;
        },
      },
      {
        kind: "select", key: "abs", label: "Absențe: toate",
        options: [{ value: "has", label: "Cu absențe" }, { value: "none", label: "Fără absențe" }],
        test: (c, v) => (v === "has" ? c.noShowCount > 0 : c.noShowCount === 0),
      },
      {
        kind: "select", key: "last", label: "Ultima programare: oricând",
        options: [{ value: "never", label: "Niciodată" }, { value: "30", label: "Ultimele 30 de zile" }, { value: "90", label: "Ultimele 90 de zile" }, { value: "old", label: "Mai veche de 90 de zile" }],
        test: (c, v) => {
          const t = c.lastAppointmentAt ? new Date(c.lastAppointmentAt).getTime() : null;
          const age = t == null ? null : Date.now() - t;
          if (v === "never") return t == null;
          if (age == null) return false;
          return v === "30" ? age <= 30 * DAY : v === "90" ? age <= 90 * DAY : age > 90 * DAY;
        },
      },
      {
        kind: "select", key: "tg", label: "Telegram: toți",
        options: [{ value: "yes", label: "Conectat" }, { value: "no", label: "Neconectat" }],
        test: (c, v) => (v === "yes" ? !!c.telegramChatId : !c.telegramChatId),
      },
    ],
    [],
  );

  return (
    <>
      <DataTable
        storageKey="clients"
        rows={rows}
        columns={columns}
        filters={filters}
        defaultSort={{ key: "last", dir: "desc" }}
        noun="clienți"
        emptyText={m.clients.noClients}
        toolbar={
          <>
            <ExportButton entity="clients" className={topBtn} />
            <ImportButton entity="clients" className={topBtn} />
            <button type="button" onClick={() => setDialog({ open: true, client: null })} className="tap h-7 cursor-pointer rounded-lg bg-brand px-3 text-[11px] font-semibold text-white hover:bg-brand-strong">
              {m.clients.new}
            </button>
          </>
        }
      />
      {dialog.open && <ClientDialog client={dialog.client} onClose={() => setDialog({ open: false, client: null })} />}
    </>
  );
}
