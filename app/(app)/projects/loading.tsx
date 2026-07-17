export default function Loading() {
  return (
    <div className="w-full">
      <div className="mb-3 h-12 w-full animate-pulse rounded-xl bg-[var(--color-surface-2)]" />
      <div className="mb-3 flex gap-2">
        <div className="h-9 flex-1 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
        <div className="h-9 w-32 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
      </div>
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-[var(--color-surface-2)]" />
        ))}
      </div>
    </div>
  );
}
