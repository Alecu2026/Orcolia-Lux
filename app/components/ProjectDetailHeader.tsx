"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { updateProject, deleteProject, type ProjectState } from "@/app/actions/projects";
import { IconPencil, IconTrash, IconX } from "./icons";
import ProjectMapPickerDynamic from "./ProjectMapPickerDynamic";
import { useMessages } from "@/lib/i18n/context";

type Opt = { id: string; name: string };

type Project = {
  id: string;
  seq: number | null;
  name: string;
  description: string | null;
  status: string;
  clientId: string | null;
  assigneeId: string | null;
  teamId: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
};

const inputCls =
  "h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";

export default function ProjectDetailHeader({
  project,
  users,
  teams,
  clients,
  canEdit,
}: {
  project: Project;
  users: Opt[];
  teams: Opt[];
  clients: Opt[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const m = useMessages();
  const [open, setOpen] = useState(false);

  function handleDelete() {
    if (!confirm(m.projects.deleteConfirm)) return;
    deleteProject(project.id).then(() => router.push("/projects")).catch(() => {});
  }

  return (
    <>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          {project.seq != null && (
            <span className="mb-1 inline-block rounded bg-brand/10 px-2 py-0.5 font-mono text-xs font-bold text-brand">
              #{String(project.seq).padStart(3, "0")}
            </span>
          )}
          <h1 className="break-words text-xl font-bold">{project.name}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="rounded-full bg-[var(--color-surface-2)] px-3 py-1 text-xs font-semibold text-ink-soft">
            {(m.projects.status as Record<string, string>)[project.status] ?? project.status}
          </span>
          {canEdit && (
            <>
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="tap grid size-9 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)]"
                title={m.projects.editTitle}
              >
                <IconPencil className="size-4" />
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="tap grid size-9 place-items-center rounded-lg border border-[var(--color-line)] text-st-cancelled hover:bg-[var(--color-surface-2)]"
                title={m.common.delete}
              >
                <IconTrash className="size-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {open && (
        <EditDialog
          project={project}
          users={users}
          teams={teams}
          clients={clients}
          onClose={() => setOpen(false)}
          onSaved={() => { setOpen(false); router.refresh(); }}
        />
      )}
    </>
  );
}

function EditDialog({
  project,
  users,
  teams,
  clients,
  onClose,
  onSaved,
}: {
  project: Project;
  users: Opt[];
  teams: Opt[];
  clients: Opt[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const m = useMessages();
  const [state, formAction, pending] = useActionState<ProjectState, FormData>(updateProject, undefined);

  useEffect(() => {
    if (state?.ok) onSaved();
  }, [state, onSaved]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="card max-h-[92dvh] w-full max-w-lg overflow-auto rounded-b-none rounded-t-2xl p-5 sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold">{m.projects.editTitle}</h2>
          <button
            onClick={onClose}
            className="tap grid size-9 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]"
            aria-label={m.common.close}
          >
            <IconX className="size-4" />
          </button>
        </div>
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={project.id} />
          <input
            name="name"
            defaultValue={project.name}
            placeholder={m.projects.namePlaceholder}
            required
            className={inputCls}
          />
          <textarea
            name="description"
            defaultValue={project.description ?? ""}
            placeholder={m.projects.descriptionPlaceholder}
            rows={3}
            className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5 text-sm outline-none focus:border-brand"
          />
          <select name="status" defaultValue={project.status} className={inputCls}>
            <option value="ACTIVE">{m.projects.status.ACTIVE}</option>
            <option value="ON_HOLD">{m.projects.status.ON_HOLD}</option>
            <option value="DONE">{m.projects.status.DONE}</option>
            <option value="ARCHIVED">{m.projects.status.ARCHIVED}</option>
          </select>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">
              {m.projects.clientLabelShort}
            </label>
            <select name="clientId" defaultValue={project.clientId ?? ""} className={inputCls}>
              <option value="">{m.projects.noClient}</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-ink-soft">{m.projects.assignNoteShort}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <select name="assigneeId" defaultValue={project.assigneeId ?? ""} className={inputCls}>
              <option value="">{m.projects.personPlaceholder}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <select name="teamId" defaultValue={project.teamId ?? ""} className={inputCls}>
              <option value="">{m.projects.teamPlaceholder}</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">
              {m.projects.locationLabel}
            </label>
            <input
              name="address"
              defaultValue={project.address ?? ""}
              placeholder={m.projects.addressPlaceholder}
              className={inputCls}
            />
            <div className="mt-2">
              <ProjectMapPickerDynamic
                initialLat={project.lat}
                initialLng={project.lng}
              />
            </div>
          </div>
          {state?.error && (
            <p className="text-sm text-st-cancelled">{state.error}</p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="tap h-12 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
          >
            {pending ? m.projects.saving : m.common.save}
          </button>
        </form>
      </div>
    </div>
  );
}
