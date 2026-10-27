"use client";

import { useT } from "@/lib/i18n/context";

type Opt = { id: string; name: string };
type Setting = { userId?: string; teamId?: string; notifyUntilStatus?: string | null };

/**
 * Fără permisiunea „Asignare": responsabilii se văd, dar nu se pot schimba. Valorile actuale se trimit mai departe ca să rămână neatinse
 * (altfel formularul le-ar goli, iar serverul ar refuza pentru că „asignarea" ar părea schimbată).
 */
export default function AssignmentLocked({
  users, teams, assigneeIds, teamIds, settings = [],
}: {
  users: Opt[]; teams: Opt[]; assigneeIds: string[]; teamIds: string[]; settings?: Setting[];
}) {
  const t = useT();
  const names = [
    ...assigneeIds.map((id) => users.find((u) => u.id === id)?.name ?? "—"),
    ...teamIds.map((id) => teams.find((x) => x.id === id)?.name ?? "—"),
  ];
  return (
    <div className="rounded-xl border border-dashed border-[var(--color-line)] px-3 py-2 text-sm text-ink-soft" title={t("Schimbarea responsabililor cere permisiunea „Asignare”.")}>
      {assigneeIds.map((id) => <input key={`u${id}`} type="hidden" name="assigneeIds" value={id} />)}
      {teamIds.map((id) => <input key={`t${id}`} type="hidden" name="teamIds" value={id} />)}
      {settings.map((s) =>
        s.notifyUntilStatus
          ? <input key={`n${s.userId ?? s.teamId}`} type="hidden" name={s.userId ? `notifyUntil_${s.userId}` : `notifyUntil_team_${s.teamId}`} value={s.notifyUntilStatus} />
          : null,
      )}
      <span className="font-medium text-ink">{t("Responsabili")}:</span> {names.length ? names.join(", ") : "—"}
    </div>
  );
}
