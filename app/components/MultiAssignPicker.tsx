"use client";

import { useState } from "react";
import { IconX } from "./icons";
import type { AssignmentSetting } from "@/lib/services/tasks";
import { useMessages } from "@/lib/i18n/context";

type Opt = { id: string; name: string };

const sel =
  "h-8 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-xs outline-none focus:border-brand";

export default function MultiAssignPicker({
  users,
  teams,
  initialAssigneeIds = [],
  initialTeamIds = [],
  initialSettings = [],
}: {
  users: Opt[];
  teams: Opt[];
  initialAssigneeIds?: string[];
  initialTeamIds?: string[];
  initialSettings?: AssignmentSetting[];
}) {
  const m = useMessages();
  const STATUS_OPTIONS = [
    { value: "NEW", label: m.status.NEW },
    { value: "ASSIGNED", label: m.status.ASSIGNED },
    { value: "READ", label: m.status.READ },
    { value: "IN_PROGRESS", label: m.status.IN_PROGRESS },
    { value: "ON_HOLD", label: m.status.ON_HOLD },
    { value: "REVIEW", label: m.status.REVIEW },
    { value: "DONE", label: m.status.DONE },
    { value: "CANCELLED", label: m.status.CANCELLED },
  ];
  const [assigneeIds, setAssigneeIds] = useState<string[]>(initialAssigneeIds);
  const [teamIds, setTeamIds] = useState<string[]>(initialTeamIds);
  const [thresholds, setThresholds] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const s of initialSettings) {
      if (s.userId && s.notifyUntilStatus) map[`u_${s.userId}`] = s.notifyUntilStatus;
      if (s.teamId && s.notifyUntilStatus) map[`t_${s.teamId}`] = s.notifyUntilStatus;
    }
    return map;
  });

  const total = assigneeIds.length + teamIds.length;
  const showThresholds = total > 1;

  const availableUsers = users.filter((u) => !assigneeIds.includes(u.id));
  const availableTeams = teams.filter((t) => !teamIds.includes(t.id));

  function addUser(id: string) {
    if (id && !assigneeIds.includes(id)) setAssigneeIds((prev) => [...prev, id]);
  }

  function removeUser(id: string) {
    setAssigneeIds((prev) => prev.filter((x) => x !== id));
    setThresholds((prev) => { const n = { ...prev }; delete n[`u_${id}`]; return n; });
  }

  function addTeam(id: string) {
    if (id && !teamIds.includes(id)) setTeamIds((prev) => [...prev, id]);
  }

  function removeTeam(id: string) {
    setTeamIds((prev) => prev.filter((x) => x !== id));
    setThresholds((prev) => { const n = { ...prev }; delete n[`t_${id}`]; return n; });
  }

  function setThreshold(key: string, val: string) {
    setThresholds((prev) => ({ ...prev, [key]: val }));
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-semibold text-ink-soft">{m.appts.assignedLabel}</label>

      {/* Chips */}
      {total > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {assigneeIds.map((uid) => {
            const u = users.find((x) => x.id === uid);
            if (!u) return null;
            const key = `u_${uid}`;
            return (
              <div key={uid} className="flex items-center gap-1 rounded-full border border-[var(--color-line)] bg-[var(--color-surface-2)] pl-2.5 pr-1 py-1">
                <span className="text-xs font-medium">👤 {u.name}</span>
                {showThresholds && (
                  <select
                    value={thresholds[key] ?? ""}
                    onChange={(e) => setThreshold(key, e.target.value)}
                    className={`${sel} ml-1`}
                    title={m.appts.notifyUntilTitle}
                  >
                    <option value="">{m.appts.notifyAlways}</option>
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>{m.appts.notifyUntil} {s.label}</option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => removeUser(uid)}
                  className="ml-0.5 grid size-5 shrink-0 place-items-center rounded-full text-ink-soft hover:bg-[var(--color-line)] hover:text-ink"
                  aria-label={`${m.appts.removeLabel} ${u.name}`}
                >
                  <IconX className="size-3" />
                </button>
                <input type="hidden" name="assigneeIds" value={uid} />
                {thresholds[key] && <input type="hidden" name={`notifyUntil_${uid}`} value={thresholds[key]} />}
              </div>
            );
          })}

          {teamIds.map((tid) => {
            const t = teams.find((x) => x.id === tid);
            if (!t) return null;
            const key = `t_${tid}`;
            return (
              <div key={tid} className="flex items-center gap-1 rounded-full border border-[var(--color-line)] bg-[var(--color-surface-2)] pl-2.5 pr-1 py-1">
                <span className="text-xs font-medium">👥 {t.name}</span>
                {showThresholds && (
                  <select
                    value={thresholds[key] ?? ""}
                    onChange={(e) => setThreshold(key, e.target.value)}
                    className={`${sel} ml-1`}
                    title={m.appts.notifyUntilTitle}
                  >
                    <option value="">{m.appts.notifyAlways}</option>
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>{m.appts.notifyUntil} {s.label}</option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => removeTeam(tid)}
                  className="ml-0.5 grid size-5 shrink-0 place-items-center rounded-full text-ink-soft hover:bg-[var(--color-line)] hover:text-ink"
                  aria-label={`${m.appts.removeLabel} ${t.name}`}
                >
                  <IconX className="size-3" />
                </button>
                <input type="hidden" name="teamIds" value={tid} />
                {thresholds[key] && <input type="hidden" name={`notifyUntil_team_${tid}`} value={thresholds[key]} />}
              </div>
            );
          })}
        </div>
      )}

      {/* Add dropdowns */}
      <div className="grid gap-2 sm:grid-cols-2">
        {availableUsers.length > 0 && (
          <select
            value=""
            onChange={(e) => { addUser(e.target.value); e.target.value = ""; }}
            className="h-10 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand"
          >
            <option value="">{m.appts.addPerson}</option>
            {availableUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        )}
        {availableTeams.length > 0 && (
          <select
            value=""
            onChange={(e) => { addTeam(e.target.value); e.target.value = ""; }}
            className="h-10 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand"
          >
            <option value="">{m.appts.addTeam}</option>
            {availableTeams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
      </div>

      {showThresholds && (
        <p className="text-[11px] text-ink-soft">
          {m.appts.thresholdHint}
        </p>
      )}
    </div>
  );
}
