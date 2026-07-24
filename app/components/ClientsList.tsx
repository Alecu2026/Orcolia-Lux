"use client";

import { useEffect, useState } from "react";
import { deleteClient } from "@/app/actions/clients";
import ClientDialog, { type ClientEdit } from "./ClientDialog";
import { useToast } from "./toast";
import { IconPencil, IconTrash } from "./icons";
import CardActionsMenu from "./CardActionsMenu";
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

export default function ClientsList({
  items,
  openCreate,
}: {
  items: ClientRow[];
  openCreate?: boolean;
}) {
  const toast = useToast();
  const m = useMessages();
  const [rows, setRows] = useState(items);
  useEffect(() => setRows(items), [items]);
  const [dialog, setDialog] = useState<{ open: boolean; client: ClientEdit | null }>({
    open: openCreate ? true : false,
    client: null,
  });

  function remove(id: string) {
    if (!confirm(m.clients.deleteConfirm)) return;
    const prev = rows;
    setRows((r) => r.filter((c) => c.id !== id)); // optimistic
    deleteClient(id)
      .then(() => toast.success(m.clients.deleted))
      .catch(() => {
        setRows(prev);
        toast.error(m.clients.deleteFailed);
      });
  }

  return (
    <>
      <button
        onClick={() => setDialog({ open: true, client: null })}
        className="tap mb-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong"
      >
        {m.clients.new}
      </button>

      {rows.length === 0 ? (
        <div className="card grid place-items-center p-10 text-center text-sm text-ink-soft">
          {m.clients.noClients}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((c) => (
            <div key={c.id} className="card flex items-center gap-3 p-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-bold text-brand-strong">
                {c.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{c.name}</p>
                <p className="truncate text-xs text-ink-soft">
                  {c.phone ?? c.email ?? "—"}
                  {c.noShowCount > 0 && (
                    <span className="ml-2 text-st-noshow">· {c.noShowCount} {m.clients.absences}</span>
                  )}
                </p>
              </div>
              <div className="hidden shrink-0 items-center gap-2 sm:flex">
                <button
                  onClick={() =>
                    setDialog({
                      open: true,
                      client: {
                        id: c.id,
                        name: c.name,
                        phone: c.phone,
                        email: c.email,
                        telegramChatId: c.telegramChatId,
                        notes: c.notes,
                      },
                    })
                  }
                  className="tap grid size-9 place-items-center rounded-lg border border-[var(--color-line)] hover:bg-[var(--color-surface-2)]"
                  title={m.common.edit}
                >
                  <IconPencil className="size-4" />
                </button>
                <button
                  onClick={() => remove(c.id)}
                  className="tap grid size-9 place-items-center rounded-lg border border-[var(--color-line)] text-st-cancelled hover:bg-[var(--color-surface-2)]"
                  title={m.common.delete}
                >
                  <IconTrash className="size-4" />
                </button>
              </div>
              <CardActionsMenu
                className="sm:hidden"
                items={[
                  {
                    key: "edit",
                    label: m.common.edit,
                    icon: <IconPencil className="size-3.5" />,
                    onClick: () =>
                      setDialog({
                        open: true,
                        client: {
                          id: c.id,
                          name: c.name,
                          phone: c.phone,
                          email: c.email,
                          telegramChatId: c.telegramChatId,
                          notes: c.notes,
                        },
                      }),
                  },
                  { key: "delete", label: m.common.delete, icon: <IconTrash className="size-3.5" />, onClick: () => remove(c.id), danger: true },
                ]}
              />
            </div>
          ))}
        </div>
      )}

      {dialog.open && (
        <ClientDialog client={dialog.client} onClose={() => setDialog({ open: false, client: null })} />
      )}
    </>
  );
}
