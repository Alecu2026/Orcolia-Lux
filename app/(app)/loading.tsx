export default function Loading() {
  return (
    <div className="w-full animate-pulse">
      {/* taburi / filtre */}
      <div className="mb-4 flex gap-2">
        <div className="h-9 w-24 rounded-full bg-[var(--color-surface-2)]" />
        <div className="h-9 w-24 rounded-full bg-[var(--color-surface-2)]" />
        <div className="h-9 w-28 rounded-full bg-[var(--color-surface-2)]" />
      </div>

      {/* bară de acțiune / căutare */}
      <div className="mb-4 h-12 rounded-xl bg-[var(--color-surface-2)]" />

      {/* statistici (dashboard) */}
      <div className="mb-5 grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card p-4">
            <div className="h-7 w-10 rounded bg-[var(--color-surface-2)]" />
            <div className="mt-2 h-3 w-16 rounded bg-[var(--color-surface-2)]" />
          </div>
        ))}
      </div>

      {/* listă de carduri */}
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card flex items-center gap-3 p-4">
            <div className="size-10 shrink-0 rounded-full bg-[var(--color-surface-2)]" />
            <div className="flex-1">
              <div className="h-4 w-1/3 rounded bg-[var(--color-surface-2)]" />
              <div className="mt-2 h-3 w-1/2 rounded bg-[var(--color-surface-2)]" />
            </div>
            <div className="h-6 w-16 rounded-full bg-[var(--color-surface-2)]" />
          </div>
        ))}
      </div>
    </div>
  );
}
