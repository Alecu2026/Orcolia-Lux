import { Skeleton } from "@/app/components/MeterBits";

/** Apare INSTANT la click pe un contor (scheletul paginii), cât timp se încarcă datele reale. */
export default function Loading() {
  return (
    <div className="flex w-full flex-col gap-4" aria-busy="true">
      <div className="h-5 w-40 animate-pulse rounded bg-[var(--color-surface-2)]" />
      <Skeleton className="h-32" />
      <Skeleton className="h-96" />
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}
