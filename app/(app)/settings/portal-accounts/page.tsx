import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { fmtDate } from "@/app/components/invoice-meta";
import { IconChevronLeft } from "@/app/components/icons";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function PortalAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const user = await requireUser();
  if (!can(user, "admin")) redirect("/settings");

  const { q = "", status = "all", page: pageRaw } = await searchParams;
  const page = Math.max(1, Number(pageRaw) || 1);

  const where: Prisma.ClientWhereInput = {
    meterSeries: { not: null },
    ...(status === "activated" ? { portalPasswordHash: { not: null } } : {}),
    ...(status === "pending" ? { portalPasswordHash: null } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { meterSeries: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, activatedCount, accounts] = await Promise.all([
    prisma.client.count({ where: { meterSeries: { not: null } } }),
    prisma.client.count({ where: { meterSeries: { not: null }, portalPasswordHash: { not: null } } }),
    prisma.client.findMany({
      where,
      orderBy: { portalActivatedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        meterSeries: true,
        email: true,
        portalPasswordHash: true,
        portalActivatedAt: true,
        portalLastLoginAt: true,
        createdAt: true,
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (overrides: Record<string, string>) => {
    const p = new URLSearchParams({ q, status, ...overrides });
    if (!p.get("q")) p.delete("q");
    return `?${p.toString()}`;
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
        <IconChevronLeft className="size-4" /> Înapoi la setări
      </Link>

      <div>
        <h1 className="text-xl font-bold">Conturi portal clienți</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {activatedCount} activate din {total} conturi eligibile (au serie de contor).
        </p>
      </div>

      <form className="flex flex-wrap items-center gap-2" method="GET">
        <input
          name="q"
          defaultValue={q}
          placeholder="Caută nume, serie, email…"
          className="h-10 min-w-0 flex-1 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand"
        />
        <select
          name="status"
          defaultValue={status}
          className="h-10 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand"
        >
          <option value="all">Toate</option>
          <option value="activated">Activate</option>
          <option value="pending">Neactivate</option>
        </select>
        <button type="submit" className="tap h-10 rounded-xl bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong">
          Filtrează
        </button>
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-[var(--color-line)] text-left text-xs uppercase tracking-wide text-ink-soft">
              <th className="px-4 py-2.5">Nume</th>
              <th className="px-4 py-2.5">Serie contor</th>
              <th className="px-4 py-2.5">Email</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Activat la</th>
              <th className="px-4 py-2.5">Ultima logare</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className="border-b border-[var(--color-line)] last:border-0">
                <td className="px-4 py-2.5 font-medium">{a.name}</td>
                <td className="px-4 py-2.5 tabular-nums text-ink-soft">{a.meterSeries}</td>
                <td className="px-4 py-2.5 text-ink-soft">{a.email || "—"}</td>
                <td className="px-4 py-2.5">
                  {a.portalPasswordHash ? (
                    <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand-strong">Activat</span>
                  ) : (
                    <span className="rounded-full bg-[var(--color-surface-2)] px-2.5 py-0.5 text-xs font-medium text-ink-soft">Neactivat</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-ink-soft">{a.portalActivatedAt ? fmtDate(a.portalActivatedAt) : "—"}</td>
                <td className="px-4 py-2.5 text-ink-soft">{a.portalLastLoginAt ? fmtDate(a.portalLastLoginAt) : "—"}</td>
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink-soft">
                  Niciun cont găsit.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <Link
            href={qs({ page: String(Math.max(1, page - 1)) })}
            className={`tap h-9 rounded-lg border border-[var(--color-line)] px-3 leading-9 ${page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-[var(--color-surface-2)]"}`}
          >
            ← Anterior
          </Link>
          <span className="text-ink-soft">
            Pagina {page} din {totalPages}
          </span>
          <Link
            href={qs({ page: String(Math.min(totalPages, page + 1)) })}
            className={`tap h-9 rounded-lg border border-[var(--color-line)] px-3 leading-9 ${page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-[var(--color-surface-2)]"}`}
          >
            Următor →
          </Link>
        </div>
      )}
    </div>
  );
}
