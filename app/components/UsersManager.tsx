"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createUser,
  updateUser,
  toggleUserActive,
  deleteUser,
  setSuperAdmin,
  type UserState,
} from "@/app/actions/users";
import { PERMISSION_GROUPS } from "@/lib/permissions";
import { NOTIFY_EVENTS } from "@/lib/notify-meta";
import { useToast } from "./toast";
import { IconX, IconPencil, IconTrash } from "./icons";
import { useMessages } from "@/lib/i18n/context";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "STAFF";
  isActive: boolean;
  isSuperAdmin: boolean;
  permissions: string[];
  notifyEvents: string[];
  telegramChatId: string | null;
  notifyScope: string;
  notifyTeamIds: string[];
  notifyMemberIds: string[];
};
type Opt = { id: string; name: string };

const input =
  "h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";

export default function UsersManager({
  users,
  teams = [],
  viewerIsSuper = false,
  viewerId = "",
  viewerRole = "STAFF",
}: {
  users: UserRow[];
  teams?: Opt[];
  viewerIsSuper?: boolean;
  viewerId?: string;
  viewerRole?: "ADMIN" | "STAFF";
}) {
  const toast = useToast();
  const m = useMessages();
  const [rows, setRows] = useState(users);
  useEffect(() => setRows(users), [users]);
  const [dialog, setDialog] = useState<{ open: boolean; user: UserRow | null }>({
    open: false,
    user: null,
  });

  const [fSearch, setFSearch] = useState("");
  const [fRole, setFRole] = useState("");
  const filtered = useMemo(() => {
    const term = fSearch.trim().toLowerCase();
    return rows.filter((u) => {
      if (fRole === "ADMIN" && u.role !== "ADMIN") return false;
      if (fRole === "STAFF" && u.role !== "STAFF") return false;
      if (fRole === "INACTIVE" && u.isActive) return false;
      if (term && !`${u.name} ${u.email}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [rows, fSearch, fRole]);

  function toggle(u: UserRow) {
    const next = !u.isActive;
    setRows((r) => r.map((x) => (x.id === u.id ? { ...x, isActive: next } : x))); // optimistic
    toggleUserActive(u.id, next)
      .then(() => toast.success(next ? m.users.activated : m.users.deactivated))
      .catch(() => {
        setRows((r) => r.map((x) => (x.id === u.id ? { ...x, isActive: !next } : x)));
        toast.error(m.users.actionFailed);
      });
  }

  function toggleSuper(u: UserRow) {
    const next = !u.isSuperAdmin;
    if (u.id === viewerId && !next) { toast.error(m.users.selfRevoke); return; }
    if (!next && !confirm(m.users.revokeConfirm)) return;
    setRows((r) => r.map((x) => (x.id === u.id ? { ...x, isSuperAdmin: next } : x))); // optimistic
    setSuperAdmin(u.id, next).then((res) => {
      if (res?.error) {
        setRows((r) => r.map((x) => (x.id === u.id ? { ...x, isSuperAdmin: !next } : x)));
        toast.error(res.error);
      } else {
        toast.success(next ? m.users.superGranted : m.users.superRevoked);
      }
    });
  }

  function remove(u: UserRow) {
    if (!confirm(m.users.deleteConfirm)) return;
    const prev = rows;
    setRows((r) => r.filter((x) => x.id !== u.id)); // optimistic
    deleteUser(u.id).then((res) => {
      if (res?.error) {
        setRows(prev);
        toast.error(res.error);
      } else {
        toast.success(m.users.deleted);
      }
    });
  }

  return (
    <>
      <button
        onClick={() => setDialog({ open: true, user: null })}
        className="tap mb-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong"
      >
        {m.users.new}
      </button>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={fSearch}
          onChange={(e) => setFSearch(e.target.value)}
          placeholder={m.users.searchPlaceholder}
          className="h-9 min-w-40 flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-sm outline-none focus:border-brand"
        />
        <select value={fRole} onChange={(e) => setFRole(e.target.value)} className="h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-xs outline-none focus:border-brand">
          <option value="">{m.users.filterAll}</option>
          <option value="ADMIN">{m.users.filterAdmins}</option>
          <option value="STAFF">{m.users.filterStaff}</option>
          <option value="INACTIVE">{m.users.filterInactive}</option>
        </select>
        {(fSearch || fRole) && (
          <button onClick={() => { setFSearch(""); setFRole(""); }} className="tap h-9 rounded-lg border border-[var(--color-line)] px-3 text-xs text-ink-soft hover:bg-[var(--color-surface-2)]">
            {m.users.resetFilter}
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="card grid place-items-center p-8 text-center text-sm text-ink-soft">
          {rows.length === 0 ? m.users.noUsers : m.users.noResults}
        </div>
      ) : (
      <div className="flex flex-col gap-2.5">
        {filtered.map((u) => (
          <div key={u.id} className="card flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3">
            {/* Avatar + info — linie proprie pe mobil */}
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-bold text-brand-strong">
                {u.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {u.name}
                  {u.isSuperAdmin && (
                    <span className="ml-2 rounded bg-brand-soft px-1.5 py-0.5 text-[10px] font-bold uppercase text-brand-strong">{m.users.superLabel}</span>
                  )}
                  {!u.isActive && <span className="ml-2 text-xs text-st-cancelled">{m.users.inactive}</span>}
                </p>
                <p className="truncate text-xs text-ink-soft">
                  {u.email} · {u.role === "ADMIN" ? m.users.adminRole : `${u.permissions.length} ${m.users.permissionsCount}`}
                  {u.telegramChatId ? ` ${m.users.telegramConnected}` : ""}
                </p>
              </div>
            </div>
            {/* Butoane — sub info pe mobil, aliniate dreapta */}
            <div className="flex items-center justify-end gap-2">
              {viewerIsSuper && (
                <button
                  onClick={() => toggleSuper(u)}
                  disabled={u.id === viewerId}
                  className={`tap rounded-lg border px-2.5 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
                    u.isSuperAdmin
                      ? "border-brand bg-brand-soft text-brand-strong"
                      : "border-[var(--color-line)] hover:bg-[var(--color-surface-2)]"
                  }`}
                  title={u.id === viewerId ? m.users.superAdminSelf : u.isSuperAdmin ? m.users.superAdminRevoke : m.users.superAdminGrant}
                >
                  {u.isSuperAdmin ? m.users.superMark : m.users.superLabel}
                </button>
              )}
              {(viewerIsSuper || u.role !== "ADMIN") && (
                <button
                  onClick={() => toggle(u)}
                  disabled={u.id === viewerId}
                  className="tap rounded-lg border border-[var(--color-line)] px-2.5 py-1.5 text-xs hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-40"
                  title={u.id === viewerId ? m.users.deactivateSelf : undefined}
                >
                  {u.isActive ? m.users.deactivate : m.users.activate}
                </button>
              )}
              <button
                onClick={() => setDialog({ open: true, user: u })}
                className="tap grid size-9 place-items-center rounded-lg border border-[var(--color-line)] hover:bg-[var(--color-surface-2)]"
                title={m.common.edit}
              >
                <IconPencil className="size-4" />
              </button>
              {(viewerIsSuper || u.role !== "ADMIN") && u.id !== viewerId && (
                <button
                  onClick={() => remove(u)}
                  className="tap grid size-9 place-items-center rounded-lg border border-[var(--color-line)] text-st-cancelled hover:bg-[var(--color-surface-2)]"
                  title={m.common.delete}
                >
                  <IconTrash className="size-4" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      )}

      {dialog.open && (
        <UserDialog
          user={dialog.user}
          allUsers={rows}
          teams={teams}
          viewerId={viewerId}
          viewerIsSuper={viewerIsSuper}
          onClose={() => setDialog({ open: false, user: null })}
        />
      )}
    </>
  );
}

function UserDialog({
  user,
  allUsers,
  teams,
  viewerId,
  viewerIsSuper,
  onClose,
}: {
  user: UserRow | null;
  allUsers: UserRow[];
  teams: Opt[];
  viewerId: string;
  viewerIsSuper: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const m = useMessages();
  const action = user ? updateUser : createUser;
  const [state, formAction, pending] = useActionState<UserState, FormData>(action, undefined);
  const [role, setRole] = useState<"ADMIN" | "STAFF">(user?.role ?? "STAFF");
  const [notifyScope, setNotifyScope] = useState<string>(user?.notifyScope ?? "ALL");

  // Rolul e blocat dacă: editezi pe tine însuți (nu te poți retrogrада) SAU editezi alt admin și nu ești super
  const roleLocked = !!user && (user.id === viewerId || (!viewerIsSuper && user.role === "ADMIN"));
  const staffOptions = allUsers.filter((u) => u.id !== user?.id);

  useEffect(() => {
    if (state?.ok) {
      router.refresh();
      onClose();
    }
  }, [state, router, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="card max-h-[92dvh] w-full max-w-lg overflow-auto rounded-b-none rounded-t-2xl p-5 sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold">{user ? m.users.editTitle : m.users.newTitle}</h2>
          <button onClick={onClose} className="tap grid size-9 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={m.common.close}>
            <IconX className="size-4" />
          </button>
        </div>

        <form action={formAction} className="flex flex-col gap-3">
          {user && <input type="hidden" name="id" value={user.id} />}
          <input name="name" defaultValue={user?.name ?? ""} placeholder={m.users.namePlaceholder} required className={input} />
          <input name="email" type="email" defaultValue={user?.email ?? ""} placeholder={m.users.emailPlaceholder} required className={input} />
          <input
            name="password"
            type="password"
            placeholder={user ? m.users.passwordNew : m.users.passwordCreate}
            required={!user}
            className={input}
          />

          <div>
            <input
              name="telegramChatId"
              defaultValue={user?.telegramChatId ?? ""}
              placeholder={m.users.telegramPlaceholder}
              inputMode="numeric"
              className={input}
            />
            <p className="mt-1 text-xs text-ink-soft">{m.users.telegramHint}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <select
              name="role"
              value={role}
              onChange={(e) => !roleLocked && setRole(e.target.value as "ADMIN" | "STAFF")}
              disabled={roleLocked}
              title={roleLocked ? m.users.roleLockedHint : undefined}
              className={`${input} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <option value="STAFF">{m.users.roleEmployee}</option>
              <option value="ADMIN">{m.users.roleAdmin}</option>
            </select>
            <label className="flex items-center gap-2 px-1 text-sm">
              <input type="checkbox" name="isActive" defaultChecked={user?.isActive ?? true} className="size-4 accent-[var(--color-brand)]" />
              {m.users.activeLabel}
            </label>
          </div>

          {role === "STAFF" && (
            <div className="rounded-xl border border-[var(--color-line)] p-3">
              <p className="mb-2 text-xs font-semibold text-ink-soft">{m.users.permissionsLabel}</p>
              <div className="flex flex-col gap-3">
                {PERMISSION_GROUPS.map((g) => (
                  <div key={g.group}>
                    <p className="mb-1 text-[11px] font-semibold uppercase text-ink-soft">{g.group}</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {g.items.map((it) => (
                        <label key={it.key} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            name="permissions"
                            value={it.key}
                            defaultChecked={user?.permissions.includes(it.key) ?? false}
                            className="size-4 accent-[var(--color-brand)]"
                          />
                          {it.label}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-[var(--color-line)] p-3">
            <p className="mb-1 text-xs font-semibold text-ink-soft">{m.users.notificationsLabel}</p>
            <p className="mb-2 text-[11px] text-ink-soft">{m.users.notificationsHint}</p>
            <div className="grid grid-cols-2 gap-1.5">
              {NOTIFY_EVENTS.map((e) => (
                <label key={e.key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="notifyEvents"
                    value={e.key}
                    defaultChecked={user?.notifyEvents.includes(e.key) ?? false}
                    className="size-4 accent-[var(--color-brand)]"
                  />
                  {e.label}
                </label>
              ))}
            </div>
          </div>

          {role === "ADMIN" && (
            <div className="rounded-xl border border-[var(--color-line)] p-3">
              <p className="mb-1 text-xs font-semibold text-ink-soft">{m.users.notifSourceLabel}</p>
              <p className="mb-2 text-[11px] text-ink-soft">{m.users.notifSourceHint}</p>
              <div className="mb-2 flex flex-wrap gap-3">
                {[
                  { v: "ALL", l: m.users.scopeAll },
                  { v: "TEAMS", l: m.users.scopeTeams },
                  { v: "MEMBERS", l: m.users.scopeMembers },
                ].map((o) => (
                  <label key={o.v} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="radio"
                      name="notifyScope"
                      value={o.v}
                      checked={notifyScope === o.v}
                      onChange={() => setNotifyScope(o.v)}
                      className="size-4 accent-[var(--color-brand)]"
                    />
                    {o.l}
                  </label>
                ))}
              </div>

              {notifyScope === "TEAMS" && (
                <div className="grid grid-cols-2 gap-1.5">
                  {teams.length === 0 && <p className="text-xs text-ink-soft">{m.users.noTeams}</p>}
                  {teams.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="notifyTeamIds"
                        value={t.id}
                        defaultChecked={user?.notifyTeamIds.includes(t.id) ?? false}
                        className="size-4 accent-[var(--color-brand)]"
                      />
                      {t.name}
                    </label>
                  ))}
                </div>
              )}

              {notifyScope === "MEMBERS" && (
                <div className="grid grid-cols-2 gap-1.5">
                  {staffOptions.length === 0 && <p className="text-xs text-ink-soft">{m.users.noStaff}</p>}
                  {staffOptions.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="notifyMemberIds"
                        value={u.id}
                        defaultChecked={user?.notifyMemberIds.includes(u.id) ?? false}
                        className="size-4 accent-[var(--color-brand)]"
                      />
                      {u.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {state?.error && <p className="text-sm text-st-cancelled">{state.error}</p>}
          <button type="submit" disabled={pending} className="tap h-12 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
            {pending ? m.common.saving : m.common.save}
          </button>
        </form>
      </div>
    </div>
  );
}
