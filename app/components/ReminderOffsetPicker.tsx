"use client";

import { REMINDER_PRESETS } from "@/lib/reminder-presets";

const chip =
  "tap w-full rounded-xl px-3 py-2.5 text-sm font-medium border border-[var(--color-line)] text-center";

export default function ReminderOffsetPicker({
  name,
  value,
  onChange,
}: {
  name: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  function toggle(key: string) {
    onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
  }

  return (
    <>
      {value.map((p) => (
        <input key={p} type="hidden" name={name} value={p} />
      ))}
      <div className="grid grid-cols-2 gap-2">
        {REMINDER_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => toggle(p.key)}
            className={`${chip} ${value.includes(p.key) ? "bg-brand text-white" : ""}`}
          >
            {p.label}
          </button>
        ))}
      </div>
    </>
  );
}
