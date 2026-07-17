"use client";

import { useState } from "react";
import { useToast } from "./toast";
import { IconPlus, IconCheck, IconX } from "./icons";
import { useMessages } from "@/lib/i18n/context";

type Opt = { id: string; name: string };
type QuickResult = { ok: true; id: string; name: string } | { ok: false; error: string };

const field =
  "h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";

export default function QuickSelect({
  name,
  options,
  placeholder,
  emptyLabel,
  optionPrefix = "",
  canCreate = true,
  createLabel = "",
  onQuickCreate,
  defaultValue = "",
}: {
  name: string;
  options: Opt[];
  placeholder?: string;
  emptyLabel?: string;
  optionPrefix?: string;
  canCreate?: boolean;
  createLabel?: string;
  onQuickCreate?: (name: string) => Promise<QuickResult>;
  defaultValue?: string;
}) {
  const toast = useToast();
  const m = useMessages();
  const [opts, setOpts] = useState<Opt[]>(options);
  const [val, setVal] = useState(defaultValue);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const resolvedEmptyLabel = emptyLabel ?? m.common.none;

  async function create() {
    const n = newName.trim();
    if (!n || !onQuickCreate) return;
    setBusy(true);
    const res = await onQuickCreate(n);
    setBusy(false);
    if (res.ok) {
      setOpts((o) => [{ id: res.id, name: res.name }, ...o]);
      setVal(res.id);
      setNewName("");
      setAdding(false);
      toast.success(m.common.created);
    } else {
      toast.error(res.error);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <select name={name} value={val} onChange={(e) => setVal(e.target.value)} className={field}>
          <option value="">{placeholder ?? resolvedEmptyLabel}</option>
          {opts.map((o) => (
            <option key={o.id} value={o.id}>
              {optionPrefix}
              {o.name}
            </option>
          ))}
        </select>
        {canCreate && onQuickCreate && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="tap grid size-11 shrink-0 place-items-center rounded-xl border border-[var(--color-line)] text-brand hover:bg-brand-soft"
            title={`${m.common.add} ${createLabel}`}
          >
            <IconPlus className="size-4" />
          </button>
        )}
      </div>

      {adding && (
        <div className="flex gap-2">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                create();
              }
              if (e.key === "Escape") {
                setAdding(false);
                setNewName("");
              }
            }}
            placeholder={`${m.quickSelect.namePh} ${createLabel}…`}
            className={field}
          />
          <button
            type="button"
            disabled={busy || !newName.trim()}
            onClick={create}
            className="tap grid size-11 shrink-0 place-items-center rounded-xl bg-brand text-white hover:bg-brand-strong disabled:opacity-50"
            title={m.common.save}
          >
            <IconCheck className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setNewName("");
            }}
            className="tap grid size-11 shrink-0 place-items-center rounded-xl border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)]"
            title={m.common.cancel}
          >
            <IconX className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
