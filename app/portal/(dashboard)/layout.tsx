import Link from "next/link";
import { requireClient } from "@/lib/client-dal";
import { getCompanySettings } from "@/lib/queries/company";
import { clientLogout } from "@/app/actions/client-auth";

export const dynamic = "force-dynamic";

export default async function PortalDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const client = await requireClient();
  const company = await getCompanySettings();

  return (
    <div className="min-h-dvh bg-[var(--color-app)]">
      <header className="border-b border-[var(--color-line)] bg-[var(--color-surface)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div>
            <p className="text-sm font-bold leading-4">{company.companyName || "Portal client"}</p>
            <p className="text-xs text-ink-soft">{client.name}</p>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/portal" className="text-ink-soft hover:text-ink">
              Facturi
            </Link>
            <Link href="/portal/tickets" className="text-ink-soft hover:text-ink">
              Tichete
            </Link>
            <form action={clientLogout}>
              <button type="submit" className="tap text-ink-soft hover:text-ink">
                Deconectare
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}
