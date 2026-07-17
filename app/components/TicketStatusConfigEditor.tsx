"use client";

import { useState, useTransition } from "react";
import { saveTicketStatusConfig, deleteTicketStatus, addTicketStatus } from "@/app/actions/settings";
import { DEFAULT_STATUS_CONFIGS, ALL_STATUS_KEYS, type StatusConfig } from "@/lib/ticket-status-config";
import { useToast } from "./toast";
import { IconTrash, IconPlus, IconChevronUp, IconChevronDown } from "./icons";
import { useMessages } from "@/lib/i18n/context";

function Toggle({
  checked,
  onChange,
  activeColor = "bg-brand",
  title,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  activeColor?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      title={title}
      aria-pressed={checked}
      className={[
        "relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200",
        checked ? activeColor : "bg-gray-300 dark:bg-gray-600",
      ].join(" ")}
    >
      <span
        className={[
          "absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200",
          checked ? "translate-x-5" : "translate-x-0",
        ].join(" ")}
      />
    </button>
  );
}

export default function TicketStatusConfigEditor({
  initial,
}: {
  initial: StatusConfig[];
}) {
  const toast = useToast();
  const m = useMessages();
  const STATUS_LABELS: Record<string, string> = {
    NEW: m.status.NEW, ASSIGNED: m.status.ASSIGNED, READ: m.status.READ,
    IN_PROGRESS: m.status.IN_PROGRESS, ON_HOLD: m.status.ON_HOLD,
    REVIEW: m.status.REVIEW, DONE: m.status.DONE, CANCELLED: m.status.CANCELLED,
  };
  const [, startTransition] = useTransition();
  const [configs, setConfigs] = useState<StatusConfig[]>(initial);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const usedKeys = new Set(configs.map((c) => c.key));
  const availableToAdd = ALL_STATUS_KEYS.filter((k) => !usedKeys.has(k));

  function update(key: string, field: keyof StatusConfig, value: unknown) {
    setConfigs((prev) => prev.map((c) => (c.key === key ? { ...c, [field]: value } : c)));
  }

  function moveUp(idx: number) {
    if (idx === 0) return;
    setConfigs((prev) => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next.map((c, i) => ({ ...c, order: i }));
    });
  }

  function moveDown(idx: number) {
    setConfigs((prev) => {
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next.map((c, i) => ({ ...c, order: i }));
    });
  }

  function handleDelete(key: string) {
    if (configs.length <= 1) {
      toast.error(m.tickets.statusDeleteLast);
      return;
    }
    const remaining = configs.filter((c) => c.key !== key);
    const first = remaining[0];
    const confirmMsg = `Ștergi statusul "${configs.find((c) => c.key === key)?.label ?? key}"?\nTichetele cu acest status vor fi mutate la "${first.label}".`;
    if (!confirm(confirmMsg)) return;

    setSaving(true);
    startTransition(async () => {
      const res = await deleteTicketStatus(key, remaining.map((c, i) => ({ ...c, order: i })));
      if (res?.error) toast.error(res.error);
      else {
        setConfigs(remaining.map((c, i) => ({ ...c, order: i })));
        toast.success(m.tickets.statusDeleted);
      }
      setSaving(false);
    });
  }

  function handleAdd(key: string) {
    setAddOpen(false);
    startTransition(async () => {
      const res = await addTicketStatus(key);
      if (res?.error) { toast.error(res.error); return; }
      const def = DEFAULT_STATUS_CONFIGS.find((c) => c.key === key);
      const newEntry: StatusConfig = def
        ? { ...def, order: configs.length }
        : { key, label: STATUS_LABELS[key] ?? key, color: "#6b7280", notifyOnEnter: false, suppressAll: false, order: configs.length };
      setConfigs((prev) => [...prev, newEntry]);
      toast.success(m.tickets.statusAdded);
    });
  }

  function save() {
    setSaving(true);
    startTransition(async () => {
      const res = await saveTicketStatusConfig(configs.map((c, i) => ({ ...c, order: i })));
      if (res?.error) toast.error(res.error);
      else toast.success(m.tickets.statusSaved);
      setSaving(false);
    });
  }

  function reset() {
    setConfigs(DEFAULT_STATUS_CONFIGS);
  }

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="grid grid-cols-[1.5rem_1fr_2rem_3.5rem_3.5rem_2rem] items-center gap-x-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
        <span />
        <span>Status</span>
        <span className="text-center">Col.</span>
        <span className="text-center leading-tight">{m.tickets.notifEntry}</span>
        <span className="text-center leading-tight">{m.tickets.stopNotif}</span>
        <span />
      </div>

      {configs.map((cfg, idx) => (
        <div
          key={cfg.key}
          className="card grid grid-cols-[1.5rem_1fr_2rem_3.5rem_3.5rem_2rem] items-center gap-x-2 px-3 py-2.5"
        >
          {/* Reorder */}
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              onClick={() => moveUp(idx)}
              disabled={idx === 0}
              className="tap grid size-5 place-items-center rounded text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-25"
            >
              <IconChevronUp className="size-3" />
            </button>
            <button
              type="button"
              onClick={() => moveDown(idx)}
              disabled={idx === configs.length - 1}
              className="tap grid size-5 place-items-center rounded text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-25"
            >
              <IconChevronDown className="size-3" />
            </button>
          </div>

          {/* Label + key */}
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: cfg.color }} />
            <input
              type="text"
              value={cfg.label}
              onChange={(e) => update(cfg.key, "label", e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-sm font-medium focus:outline-none"
            />
            <span className="hidden shrink-0 rounded bg-[var(--color-surface-2)] px-1 py-0.5 font-mono text-[10px] text-ink-soft sm:inline">
              {cfg.key}
            </span>
          </div>

          {/* Color picker */}
          <label className="relative cursor-pointer" title="Schimbă culoarea">
            <span className="flex h-6 w-6 rounded-full border-2 border-[var(--color-line)]" style={{ background: cfg.color }} />
            <input
              type="color"
              value={cfg.color}
              onChange={(e) => update(cfg.key, "color", e.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>

          {/* notifyOnEnter */}
          <div className="flex justify-center">
            <Toggle
              checked={cfg.notifyOnEnter}
              onChange={(v) => update(cfg.key, "notifyOnEnter", v)}
              activeColor="bg-brand"
              title={cfg.notifyOnEnter ? m.tickets.notifyOnEnterActive : m.tickets.notifyOnEnterInactive}
            />
          </div>

          {/* suppressAll */}
          <div className="flex justify-center">
            <Toggle
              checked={cfg.suppressAll}
              onChange={(v) => update(cfg.key, "suppressAll", v)}
              activeColor="bg-amber-500"
              title={cfg.suppressAll ? m.tickets.suppressActive : m.tickets.suppressInactive}
            />
          </div>

          {/* Delete */}
          <button
            type="button"
            onClick={() => handleDelete(cfg.key)}
            disabled={saving}
            className="tap grid size-6 place-items-center rounded text-st-cancelled hover:bg-[var(--color-surface-2)] disabled:opacity-40"
            title={m.tickets.statusDeleteTitle}
          >
            <IconTrash className="size-3.5" />
          </button>
        </div>
      ))}

      {/* Add status */}
      {availableToAdd.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setAddOpen((o) => !o)}
            className="tap flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--color-line)] text-sm text-ink-soft hover:border-brand hover:text-brand"
          >
            <IconPlus className="size-4" />
            {m.tickets.statusAddBtn}
          </button>
          {addOpen && (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-lg">
              {availableToAdd.map((key) => {
                const def = DEFAULT_STATUS_CONFIGS.find((c) => c.key === key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleAdd(key)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-sm hover:bg-[var(--color-surface-2)]"
                  >
                    <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: def?.color ?? "#6b7280" }} />
                    <span className="font-medium">{def?.label ?? STATUS_LABELS[key] ?? key}</span>
                    <span className="ml-auto font-mono text-[11px] text-ink-soft">{key}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={reset}
          className="text-xs text-ink-soft transition-colors hover:text-ink"
        >
          {m.tickets.statusReset}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="tap rounded-xl bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
        >
          {saving ? m.common.saving : m.common.save}
        </button>
      </div>

      <p className="pt-1 text-xs text-ink-soft">
        <strong>{m.tickets.notifEntry}</strong> — {m.tickets.notifEntryDesc} &nbsp;|&nbsp;
        <strong>{m.tickets.stopNotif}</strong> — {m.tickets.stopNotifDesc}
      </p>
    </div>
  );
}
