"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createCategory,
  updateCategory,
  deleteCategory,
  type SettingsState,
} from "@/app/actions/settings";
import type { CategoryLite } from "./types";
import { useToast } from "./toast";
import { IconPencil, IconTrash, IconX, IconCheck } from "./icons";
import { useMessages } from "@/lib/i18n/context";

const inp =
  "h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";

export default function CategoriesManager({
  categories,
  canManage = false,
}: {
  categories: CategoryLite[];
  canManage?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const m = useMessages();
  const [rows, setRows] = useState(categories);
  useEffect(() => setRows(categories), [categories]);

  // create
  const [createState, createAction, createPending] = useActionState<SettingsState, FormData>(
    createCategory,
    undefined,
  );
  const [newColor, setNewColor] = useState("#0d9488");
  useEffect(() => {
    if (createState?.ok) { toast.success(m.categories.added); router.refresh(); }
    else if (createState?.error) toast.error(createState.error);
  }, [createState, router, toast, m]);

  // edit
  const [editId, setEditId] = useState<string | null>(null);
  const [editColor, setEditColor] = useState("#0d9488");
  const [editState, editAction, editPending] = useActionState<SettingsState, FormData>(
    updateCategory,
    undefined,
  );
  useEffect(() => {
    if (editState?.ok) { toast.success(m.categories.updated); setEditId(null); router.refresh(); }
    else if (editState?.error) toast.error(editState.error);
  }, [editState, router, toast, m]);

  function startEdit(c: CategoryLite) {
    setEditId(c.id);
    setEditColor(c.color);
  }

  function remove(id: string) {
    const prev = rows;
    setRows((r) => r.filter((c) => c.id !== id));
    deleteCategory(id)
      .then(() => toast.success(m.categories.deleted))
      .catch(() => { setRows(prev); toast.error(m.common.deleteFailed); });
  }

  const editRow = rows.find((c) => c.id === editId);

  return (
    <div className="card flex flex-col gap-4 p-5">
      <h2 className="text-base font-bold">{m.categories.title}</h2>

      {/* List */}
      <div className="flex flex-col gap-2">
        {rows.length === 0 && <p className="text-sm text-ink-soft">{m.categories.noCategories}</p>}
        {rows.map((c) =>
          editId === c.id ? (
            /* ── Inline edit form ── */
            <form key={c.id} action={editAction} className="flex flex-col gap-2 rounded-xl border border-brand/40 bg-brand/5 px-3 py-2">
              <input type="hidden" name="id" value={c.id} />
              <div className="flex items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: editColor }} />
                <input
                  name="name"
                  defaultValue={c.name}
                  required
                  autoFocus
                  className={`${inp} flex-1`}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  name="defaultDurationMinutes"
                  defaultValue={c.defaultDurationMinutes}
                  min={1}
                  step="any"
                  title={m.categories.durationTitle}
                  className={`${inp} flex-1`}
                />
                <input
                  type="color"
                  name="color"
                  value={editColor}
                  onChange={(e) => setEditColor(e.target.value)}
                  className="h-9 w-9 shrink-0 rounded-lg border border-[var(--color-line)] bg-transparent"
                />
                <button
                  type="submit"
                  disabled={editPending}
                  title={m.common.save}
                  className="tap grid size-9 shrink-0 place-items-center rounded-lg bg-brand text-white hover:bg-brand-strong disabled:opacity-60"
                >
                  <IconCheck className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditId(null)}
                  title={m.common.cancel}
                  className="tap grid size-9 shrink-0 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)]"
                >
                  <IconX className="size-4" />
                </button>
              </div>
            </form>
          ) : (
            /* ── Display pill ── */
            <div
              key={c.id}
              className="flex items-center gap-2.5 rounded-xl border border-[var(--color-line)] px-3 py-2"
            >
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
              <span className="flex-1 text-sm font-medium">{c.name}</span>
              <span className="text-xs text-ink-soft">{c.defaultDurationMinutes} min</span>
              {canManage && (
                <>
                  <button
                    onClick={() => startEdit(c)}
                    title={m.common.edit}
                    className="tap grid size-7 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]"
                  >
                    <IconPencil className="size-3.5" />
                  </button>
                  <button
                    onClick={() => remove(c.id)}
                    title={m.common.delete}
                    className="tap grid size-7 place-items-center rounded-lg text-st-cancelled hover:bg-[var(--color-surface-2)]"
                  >
                    <IconTrash className="size-3.5" />
                  </button>
                </>
              )}
            </div>
          ),
        )}
      </div>

      {/* Add form — doar admin */}
      {!canManage && <p className="text-xs text-ink-soft">{m.categories.adminOnly}</p>}
      {canManage && <form action={createAction} className="flex flex-col gap-2 border-t border-[var(--color-line)] pt-4">
        <div className="flex items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: newColor }} />
          <input
            name="name"
            placeholder={m.categories.newPlaceholder}
            required
            className={`${inp} flex-1`}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            name="defaultDurationMinutes"
            defaultValue={30}
            min={1}
            step="any"
            title={m.categories.durationTitle}
            className={`${inp} flex-1`}
          />
          <input
            type="color"
            name="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            className="h-9 w-9 shrink-0 rounded-lg border border-[var(--color-line)] bg-transparent"
          />
          <button
            type="submit"
            disabled={createPending}
            className="tap h-9 shrink-0 rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
          >
            {m.categories.add}
          </button>
        </div>
      </form>}
      {canManage && createState?.error && <p className="text-sm text-st-cancelled">{createState.error}</p>}
    </div>
  );
}
