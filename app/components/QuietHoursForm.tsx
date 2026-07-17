"use client";

import { useActionState, useEffect } from "react";
import { updateQuietHours, type SettingsState } from "@/app/actions/settings";
import type { QuietHoursConfig } from "@/lib/quiet-hours";
import { useToast } from "./toast";
import { useMessages } from "@/lib/i18n/context";

const inp =
  "h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";

export default function QuietHoursForm({
  config,
  canEdit,
}: {
  config: QuietHoursConfig;
  canEdit: boolean;
}) {
  const toast = useToast();
  const m = useMessages();
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    updateQuietHours,
    undefined,
  );

  useEffect(() => {
    if (state?.ok) toast.success(m.settings.quietHoursSaved);
    else if (state?.error) toast.error(state.error);
  }, [state, toast, m]);

  return (
    <div className="card flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-base font-bold">{m.settings.quietHoursTitle}</h2>
        <p className="text-sm text-ink-soft">
          {m.settings.quietHoursDesc}
        </p>
      </div>

      {!canEdit ? (
        <div className="rounded-xl border border-[var(--color-line)] px-4 py-3 text-sm">
          {config.quietHoursEnabled ? (
            <p>
              {m.settings.quietHoursActive}{" "}
              <b>
                {config.quietHoursStart} – {config.quietHoursEnd}
              </b>{" "}
              ({config.quietHoursTz})
            </p>
          ) : (
            <p className="text-ink-soft">{m.settings.quietHoursDisabled}</p>
          )}
          <p className="mt-1 text-xs text-ink-soft">{m.settings.quietHoursSuperAdminOnly}</p>
        </div>
      ) : (
        <form action={action} className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              name="quietHoursEnabled"
              defaultChecked={config.quietHoursEnabled}
              className="size-4 rounded accent-brand"
            />
            {m.settings.quietHoursEnable}
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-ink-soft">{m.settings.quietHoursFrom}</span>
              <input
                type="time"
                name="quietHoursStart"
                defaultValue={config.quietHoursStart}
                required
                className={inp}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-ink-soft">{m.settings.quietHoursTo}</span>
              <input
                type="time"
                name="quietHoursEnd"
                defaultValue={config.quietHoursEnd}
                required
                className={inp}
              />
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <span className="text-xs text-ink-soft">{m.settings.quietHoursTzLabel}</span>
              <input
                type="text"
                name="quietHoursTz"
                defaultValue={config.quietHoursTz}
                placeholder="Europe/Bucharest"
                className={inp}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={pending}
            className="tap self-start h-9 rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
          >
            {pending ? m.common.saving : m.common.save}
          </button>
        </form>
      )}
    </div>
  );
}
