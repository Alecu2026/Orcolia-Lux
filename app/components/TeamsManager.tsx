"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createTeam,
  updateTeam,
  deleteTeam,
  type TeamState,
} from "@/app/actions/teams";
import { useToast } from "./toast";
import { IconX, IconPencil, IconTrash } from "./icons";
import { useMessages } from "@/lib/i18n/context";

type Opt = { id: string; name: string };
type Team = {
  id: string;
  name: string;
  description: string | null;
  memberIds: string[];
  members: { id: string; name: string }[];
};

const input =
  "h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";

export default function TeamsManager({ teams, users }: { teams: Team[]; users: Opt[] }) {
  const toast = useToast();
  const m = useMessages();
  const [rows, setRows] = useState(teams);
  useEffect(() => setRows(teams), [teams]);
  const [dialog, setDialog] = useState<{ open: boolean; team: Team | null }>({
    open: false,
    team: null,
  });

  const [fSearch, setFSearch] = useState("");
  const filtered = useMemo(() => {
    const term = fSearch.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((t) =>
      `${t.name} ${t.members.map((m) => m.name).join(" ")}`.toLowerCase().includes(term),
    );
  }, [rows, fSearch]);

  function remove(id: string) {
    if (!confirm(m.team.deleteConfirm)) return;
    const prev = rows;
    setRows((r) => r.filter((t) => t.id !== id)); // optimistic
    deleteTeam(id)
      .then(() => toast.success(m.team.deleted))
      .catch(() => {
        setRows(prev);
        toast.error(m.team.deleteFailed);
      });
  }

  return (
    <>
      <button
        onClick={() => setDialog({ open: true, team: null })}
        className="tap mb-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong"
      >
        {m.team.new}
      </button>

      <input
        value={fSearch}
        onChange={(e) => setFSearch(e.target.value)}
        placeholder={m.team.searchPlaceholder}
        className="mb-3 h-9 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-sm outline-none focus:border-brand"
      />

      {rows.length === 0 ? (
        <div className="card grid place-items-center p-10 text-center text-sm text-ink-soft">{m.team.noTeams}</div>
      ) : filtered.length === 0 ? (
        <div className="card grid place-items-center p-8 text-center text-sm text-ink-soft">{m.team.noResults}</div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {filtered.map((t) => (
            <div key={t.id} className="card flex items-center gap-3 p-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{t.name}</p>
                <p className="truncate text-xs text-ink-soft">
                  {t.members.length} {m.team.membersLabel.toLowerCase()}{t.members.length ? `: ${t.members.map((mem) => mem.name).join(", ")}` : ""}
                </p>
              </div>
              <button onClick={() => setDialog({ open: true, team: t })} className="tap grid size-9 place-items-center rounded-lg border border-[var(--color-line)] hover:bg-[var(--color-surface-2)]" title={m.common.edit}>
                <IconPencil className="size-4" />
              </button>
              <button onClick={() => remove(t.id)} className="tap grid size-9 place-items-center rounded-lg border border-[var(--color-line)] text-st-cancelled hover:bg-[var(--color-surface-2)]" title={m.common.delete}>
                <IconTrash className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {dialog.open && (
        <TeamDialog team={dialog.team} users={users} onClose={() => setDialog({ open: false, team: null })} />
      )}
    </>
  );
}

function TeamDialog({ team, users, onClose }: { team: Team | null; users: Opt[]; onClose: () => void }) {
  const router = useRouter();
  const m = useMessages();
  const [, startTransition] = useTransition();
  const action = team ? updateTeam : createTeam;
  const [state, formAction, pending] = useActionState<TeamState, FormData>(action, undefined);
  useEffect(() => {
    if (state?.ok) {
      onClose();
      startTransition(() => router.refresh());
    }
  }, [state, router, onClose, startTransition]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card max-h-[92dvh] w-full max-w-lg overflow-auto rounded-b-none rounded-t-2xl p-5 sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold">{team ? m.team.editTitle : m.team.newTitle}</h2>
          <button onClick={onClose} className="tap grid size-9 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={m.common.close}>
            <IconX className="size-4" />
          </button>
        </div>
        <form action={formAction} className="flex flex-col gap-3">
          {team && <input type="hidden" name="id" value={team.id} />}
          <input name="name" defaultValue={team?.name ?? ""} placeholder={m.team.namePlaceholder} required className={input} />
          <textarea name="description" defaultValue={team?.description ?? ""} placeholder={m.team.descriptionPlaceholder} rows={2} className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5 text-sm outline-none focus:border-brand" />
          <div className="rounded-xl border border-[var(--color-line)] p-3">
            <p className="mb-2 text-xs font-semibold text-ink-soft">{m.team.membersLabel}</p>
            {users.length === 0 ? (
              <p className="text-sm text-ink-soft">{m.team.noUsersAvailable}</p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {users.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="memberIds"
                      value={u.id}
                      defaultChecked={team?.memberIds.includes(u.id) ?? false}
                      className="size-4 accent-[var(--color-brand)]"
                    />
                    {u.name}
                  </label>
                ))}
              </div>
            )}
          </div>
          {state?.error && <p className="text-sm text-st-cancelled">{state.error}</p>}
          <button type="submit" disabled={pending} className="tap h-12 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
            {pending ? m.common.saving : m.common.save}
          </button>
        </form>
      </div>
    </div>
  );
}
