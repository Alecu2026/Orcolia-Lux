"use client";

import { useState, useActionState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateTaskAction, deleteTask, type TaskState } from "@/app/actions/tasks";
import { dateKeyOf, formatTime } from "@/lib/date";
import { useToast } from "./toast";
import { IconTrash, IconPencil, IconX } from "./icons";
import MultiAssignPicker from "./MultiAssignPicker";
import type { CategoryLite } from "./types";
import type { AssignmentSetting } from "@/lib/services/tasks";
import { useMessages } from "@/lib/i18n/context";

type Opt = { id: string; name: string };

export type TaskForEdit = {
  id: string;
  seq: number | null;
  title: string;
  description: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  dueAt: string | null;
  reminderIntervalMinutes: number | null;
  assigneeId: string | null;
  teamId: string | null;
  extraAssigneeIds: string[];
  extraTeamIds: string[];
  assignmentSettingsJson: string | null;
  projectId: string | null;
  categoryId: string | null;
};

const TZ = "Europe/Bucharest";

const dlgInput =
  "h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";

export default function TaskDetailActions({
  task,
  users,
  teams,
  projects,
  categories,
  canEdit,
  canDelete,
}: {
  task: TaskForEdit;
  users: Opt[];
  teams: Opt[];
  projects: Opt[];
  categories: CategoryLite[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const m = useMessages();
  const [editOpen, setEditOpen] = useState(false);
  const [delPending, startDel] = useTransition();

  function handleDelete() {
    if (!confirm(m.tasks.deleteConfirm)) return;
    startDel(async () => {
      await deleteTask(task.id);
      toast.success(m.tasks.deleted);
      router.push("/tasks");
    });
  }

  if (!canEdit && !canDelete) return null;

  return (
    <>
      <div className="flex items-center gap-2">
        {canEdit && (
          <button
            onClick={() => setEditOpen(true)}
            className="tap inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--color-line)] px-3 text-sm font-medium text-ink-soft hover:bg-[var(--color-surface-2)]"
          >
            <IconPencil className="size-4" />
            {m.common.edit}
          </button>
        )}
        {canDelete && (
          <button
            onClick={handleDelete}
            disabled={delPending}
            className="tap inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--color-line)] px-3 text-sm font-medium text-st-cancelled hover:bg-[var(--color-surface-2)] disabled:opacity-50"
          >
            <IconTrash className="size-4" />
            {delPending ? m.common.deleting : m.common.delete}
          </button>
        )}
      </div>

      {editOpen && (
        <EditDialog
          task={task}
          users={users}
          teams={teams}
          projects={projects}
          categories={categories}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function CategoryChips({
  categories,
  value,
  onChange,
}: {
  categories: CategoryLite[];
  value: string;
  onChange: (id: string) => void;
}) {
  const m = useMessages();
  if (categories.length === 0) return null;
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold text-ink-soft">{m.tasks.categoryLabel}</label>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onChange("")}
          className={`h-7 rounded-full px-3 text-xs font-medium border transition-colors ${
            !value
              ? "border-brand bg-brand text-white"
              : "border-[var(--color-line)] text-ink-soft hover:border-brand"
          }`}
        >
          {m.tasks.noCategory}
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(c.id)}
            className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium border transition-colors ${
              value === c.id
                ? "border-brand bg-brand/10 text-brand"
                : "border-[var(--color-line)] text-ink-soft hover:border-brand"
            }`}
          >
            <span className="size-2 rounded-full" style={{ background: c.color }} />
            {c.name}
          </button>
        ))}
      </div>
      <input type="hidden" name="categoryId" value={value} />
    </div>
  );
}

function EditDialog({
  task,
  users,
  teams,
  projects,
  categories,
  onClose,
  onSaved,
}: {
  task: TaskForEdit;
  users: Opt[];
  teams: Opt[];
  projects: Opt[];
  categories: CategoryLite[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const m = useMessages();
  const [state, action, pending] = useActionState<TaskState, FormData>(updateTaskAction, undefined);
  const [categoryId, setCategoryId] = useState(task.categoryId ?? "");
  const [description, setDescription] = useState(task.description ?? "");
  const [title, setTitle] = useState(task.title);

  useEffect(() => {
    if (state?.ok) {
      toast.success(m.tasks.saved);
      onSaved();
    } else if (state?.error) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const dueDate = task.dueAt ? dateKeyOf(new Date(task.dueAt), TZ) : "";
  const dueTimeRaw = task.dueAt ? formatTime(new Date(task.dueAt), TZ) : "";
  const dueTime = dueTimeRaw !== "00:00" ? dueTimeRaw : "";
  const seqLabel = task.seq != null ? ` #${task.seq}` : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="card max-h-[92dvh] w-full max-w-lg overflow-auto rounded-b-none rounded-t-2xl p-5 sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold">{m.tasks.editTitle}{seqLabel}</h2>
          <button
            onClick={onClose}
            className="tap grid size-9 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]"
            aria-label={m.common.close}
          >
            <IconX className="size-4" />
          </button>
        </div>
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={task.id} />
          <input
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={m.tasks.titlePlaceholder}
            required
            autoFocus
            className={dlgInput}
          />
          <textarea
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={m.tasks.descriptionPlaceholder}
            rows={3}
            className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5 text-sm outline-none focus:border-brand"
          />
          <select name="priority" defaultValue={task.priority} className={dlgInput}>
            <option value="LOW">{m.priority.LOW}</option>
            <option value="MEDIUM">{m.priority.MEDIUM}</option>
            <option value="HIGH">{m.priority.HIGH}</option>
            <option value="URGENT">{m.priority.URGENT}</option>
          </select>
          <select name="projectId" defaultValue={task.projectId ?? ""} className={dlgInput}>
            <option value="">{m.tasks.noProjectEdit}</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <MultiAssignPicker
            users={users}
            teams={teams}
            initialAssigneeIds={[
              ...(task.assigneeId ? [task.assigneeId] : []),
              ...(task.extraAssigneeIds ?? []),
            ]}
            initialTeamIds={[
              ...(task.teamId ? [task.teamId] : []),
              ...(task.extraTeamIds ?? []),
            ]}
            initialSettings={task.assignmentSettingsJson ? (JSON.parse(task.assignmentSettingsJson) as AssignmentSetting[]) : []}
          />
          <CategoryChips categories={categories} value={categoryId} onChange={setCategoryId} />
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">{m.tasks.dueDate}</label>
            <div className="grid gap-2 sm:grid-cols-2">
              <input type="date" name="dueDate" defaultValue={dueDate} className={dlgInput} />
              <input type="time" name="dueTime" defaultValue={dueTime} placeholder={m.tasks.dueTime} className={dlgInput} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">{m.tasks.reminderLabel}</label>
            <select name="reminderIntervalMinutes" defaultValue={task.reminderIntervalMinutes ?? 0} className={dlgInput}>
              <option value={0}>{m.tasks.reminderNever}</option>
              <option value={10}>{m.tasks.reminder10m}</option>
              <option value={30}>{m.tasks.reminder30m}</option>
              <option value={60}>{m.tasks.reminder1h}</option>
              <option value={180}>{m.tasks.reminder3h}</option>
              <option value={360}>{m.tasks.reminder6h}</option>
              <option value={720}>{m.tasks.reminder12h}</option>
              <option value={1440}>{m.tasks.reminder24h}</option>
              <option value={10080}>{m.tasks.reminder7d}</option>
            </select>
          </div>
          {state?.error && <p className="text-sm text-st-cancelled">{state.error}</p>}
          <button
            type="submit"
            disabled={pending}
            className="tap h-12 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
          >
            {pending ? m.common.saving : m.common.save}
          </button>
        </form>
      </div>
    </div>
  );
}
