"use client";

import { useEffect, useMemo, useState } from "react";
import {
  toggleUserActive,
  deleteUser,
  setSuperAdmin,
} from "@/app/actions/users";
import { useToast } from "./toast";
import { IconPencil, IconTrash } from "./icons";
import { effectivePermissionKeys } from "@/lib/permissions";
import UserDialog, { type UserRow, type Opt } from "./UserDialog";
import { useMessages } from "@/lib/i18n/context";


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
                  {u.email} · {u.role === "ADMIN" ? m.users.adminRole : `${effectivePermissionKeys(u.permissions).length} ${m.users.permissionsCount}`}
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
          viewerIsAdmin={viewerRole === "ADMIN"}
          onClose={() => setDialog({ open: false, user: null })}
        />
      )}
    </>
  );
}
