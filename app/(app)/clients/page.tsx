import Link from "next/link";
import { requirePermission } from "@/lib/dal";
import { listClients } from "@/lib/queries/clients";
import ClientSearch from "@/app/components/ClientSearch";
import ClientsList, { type ClientRow } from "@/app/components/ClientsList";
import ExportButton from "@/app/components/ExportButton";
import ImportButton from "@/app/components/ImportButton";
import { IconChevronLeft, IconChevronRight } from "@/app/components/icons";

export const dynamic = "force-dynamic";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; create?: string }>;
}) {
  const user = await requirePermission("clients.view");
  const { q = "", page: pageParam, create } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const { items, total, hasMore } = await listClients(user.id, {
    search: q,
    page,
  });

  const rows: ClientRow[] = items.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    telegramChatId: c.telegramChatId,
    notes: c.notes,
    noShowCount: c.noShowCount,
    lastAppointmentAt: c.lastAppointmentAt ? c.lastAppointmentAt.toISOString() : null,
  }));

  return (
    <div className="w-full">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex-1">
          <ClientSearch initial={q} />
        </div>
        <ExportButton entity="clients" params={{ q: q || undefined }} className="tap mb-4 h-12 shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-line)] px-3 text-sm text-ink-soft hover:bg-[var(--color-surface-2)]" />
        <ImportButton entity="clients" className="tap mb-4 h-12 shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-line)] px-3 text-sm text-ink-soft hover:bg-[var(--color-surface-2)]" />
      </div>
      <p className="mb-3 text-xs text-ink-soft">{total} clienți</p>
      <ClientsList items={rows} openCreate={create === "1"} />

      {(page > 1 || hasMore) && (
        <div className="mt-5 flex items-center justify-between">
          <PageLink disabled={page <= 1} href={`/clients?${qp(q, page - 1)}`}>
            <IconChevronLeft className="size-4" /> Anterior
          </PageLink>
          <span className="text-sm text-ink-soft">Pagina {page}</span>
          <PageLink disabled={!hasMore} href={`/clients?${qp(q, page + 1)}`}>
            Următor <IconChevronRight className="size-4" />
          </PageLink>
        </div>
      )}
    </div>
  );
}

function qp(q: string, page: number) {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (page > 1) p.set("page", String(page));
  return p.toString();
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-ink-soft opacity-40">
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className="tap card inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium">
      {children}
    </Link>
  );
}
