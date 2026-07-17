export default function Loading() {
  return (
    <div className="w-full">
      <div className="mb-3">
        <div className="h-5 w-32 animate-pulse rounded bg-[var(--color-surface-2)]" />
        <div className="mt-1 h-3 w-64 animate-pulse rounded bg-[var(--color-surface-2)]" />
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-9 w-32 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-xl bg-[var(--color-surface-2)]" />
        ))}
      </div>
    </div>
  );
}
