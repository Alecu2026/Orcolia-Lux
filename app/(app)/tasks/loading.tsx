export default function Loading() {
  return (
    <div className="w-full">
      {/* Scope tabs */}
      <div className="mb-3 flex gap-2">
        {[80, 64, 96].map((w, i) => (
          <div key={i} className="h-8 animate-pulse rounded-full bg-[var(--color-surface-2)]" style={{ width: w }} />
        ))}
      </div>

      {/* Filter bar */}
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="h-9 min-w-40 flex-1 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
        {[88, 104, 96, 88, 80, 96, 88].map((w, i) => (
          <div key={i} className="h-9 animate-pulse rounded-lg bg-[var(--color-surface-2)]" style={{ width: w }} />
        ))}
      </div>

      {/* Create buttons */}
      <div className="mb-3 flex gap-2">
        <div className="h-10 flex-1 animate-pulse rounded-xl bg-[var(--color-surface-2)]" />
        <div className="h-10 flex-1 animate-pulse rounded-xl bg-[var(--color-surface-2)]" />
      </div>

      {/* Task rows */}
      <div className="flex flex-col gap-1.5">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="card flex items-center gap-2.5 px-3 py-2">
            <div className="size-2.5 shrink-0 animate-pulse rounded-full bg-[var(--color-surface-2)]" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div
                className="h-3.5 animate-pulse rounded bg-[var(--color-surface-2)]"
                style={{ width: `${50 + ((i * 17) % 35)}%` }}
              />
              <div
                className="h-2.5 animate-pulse rounded bg-[var(--color-surface-2)]"
                style={{ width: `${25 + ((i * 11) % 30)}%` }}
              />
            </div>
            <div className="hidden h-8 w-16 animate-pulse rounded-lg bg-[var(--color-surface-2)] sm:block" />
            <div className="h-8 w-28 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
          </div>
        ))}
      </div>
    </div>
  );
}
