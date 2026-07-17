export default function Loading() {
  return (
    <main className="min-h-dvh bg-zinc-100 p-4">
      <div className="mx-auto max-w-3xl animate-pulse">
        <div className="rounded-2xl bg-white p-8 ring-1 ring-zinc-200">
          <div className="flex items-start justify-between border-b border-zinc-200 pb-6">
            <div className="flex items-center gap-4">
              <div className="size-16 rounded-lg bg-zinc-200" />
              <div>
                <div className="h-5 w-40 rounded bg-zinc-200" />
                <div className="mt-2 h-3 w-28 rounded bg-zinc-100" />
              </div>
            </div>
            <div className="h-8 w-32 rounded bg-zinc-200" />
          </div>
          <div className="space-y-2 py-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-5 w-full rounded bg-zinc-100" />
            ))}
          </div>
          <div className="ml-auto h-20 w-64 rounded bg-zinc-100" />
        </div>
      </div>
    </main>
  );
}
