import { requirePermission } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { canImpersonatePortal, canImpersonateUser, IMPERSONATION_HOURS } from "@/lib/impersonation";
import { effectivePermissionKeys } from "@/lib/permissions";
import { getT } from "@/lib/i18n/server-t";

export const dynamic = "force-dynamic";

const btn = "tap h-8 rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong";

/**
 * Simulare de login: intri în contul unui subaltern sau în portalul unui client și faci exact ce poate face el.
 * Regulile (cine pe cine) sunt în lib/impersonation.ts; sesiunea expiră fix după 6 ore.
 */
export default async function SimularePage({ searchParams }: { searchParams: Promise<{ q?: string; eroare?: string }> }) {
  const t = await getT();
  const user = await requirePermission("users.impersonate");
  const { q = "", eroare } = await searchParams;
  const query = q.trim().slice(0, 60);

  const candidates = await prisma.user.findMany({
    where: { isActive: true, id: { not: user.id } },
    select: { id: true, name: true, email: true, role: true, permissions: true, isSuperAdmin: true, isActive: true, taskViewScope: true, taskViewTeamIds: true, taskViewMemberIds: true },
    orderBy: { name: "asc" },
  });
  const users = candidates.filter((u) => canImpersonateUser(user, u).ok);

  const portalAllowed = canImpersonatePortal(user);
  const clients = portalAllowed
    ? await prisma.client.findMany({
        where: {
          portalPasswordHash: { not: null },
          ...(query
            ? {
                OR: [
                  { name: { contains: query, mode: "insensitive" } },
                  { meterSeries: { contains: query, mode: "insensitive" } },
                  { apaCanalContract: { contains: query, mode: "insensitive" } },
                  { email: { contains: query, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        select: { id: true, name: true, meterSeries: true, apaCanalContract: true, email: true, portalLastLoginAt: true },
        orderBy: query ? { name: "asc" } : { portalLastLoginAt: "desc" },
        take: query ? 30 : 15,
      })
    : [];

  return (
    <div className="flex w-full max-w-4xl flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">{t("Simulare de login")}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {t("Intri în contul unui subaltern sau în portalul unui client și vezi și faci exact ce poate face el.")} {t("Simularea expiră singură după")} {IMPERSONATION_HOURS} {t("ore")}; {t("în Audit Logs, acțiunile apar ca „Nume (simulat de tine)”.")}
        </p>
        <p className="mt-1 text-xs text-ink-soft">{t("În simulare nu se pot schimba parola, emailul sau notificările contului simulat.")}</p>
      </div>

      {eroare && <div className="rounded-xl border border-st-cancelled/40 bg-st-cancelled/10 px-3 py-2 text-sm text-st-cancelled" role="alert">{t(eroare)}</div>}

      <section className="card p-4">
        <h2 className="text-sm font-bold">{t("Conturi de utilizator")} <span className="font-normal text-ink-soft">({users.length})</span></h2>
        <p className="mb-2 text-xs text-ink-soft">{t("Se afișează doar conturile în care ai voie să intri: fără administratori și fără conturi cu permisiuni pe care tu nu le ai.")}</p>
        {users.length === 0 ? (
          <p className="py-3 text-sm text-ink-soft">{t("Nu există conturi în care ai voie să intri.")}</p>
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {users.map((u) => (
              <li key={u.id} data-user-id={u.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{u.name}</p>
                  <p className="truncate text-xs text-ink-soft">{u.email} · {effectivePermissionKeys(u.permissions).length} {t("permisiuni")}</p>
                </div>
                <form method="post" action="/api/simulare/user">
                  <input type="hidden" name="userId" value={u.id} />
                  <button type="submit" className={btn}>{t("Intră în cont")}</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-4">
        <h2 className="text-sm font-bold">{t("Portal clienți")}</h2>
        {!portalAllowed ? (
          <p className="py-3 text-sm text-ink-soft">{t("Pentru simulare în portal ai nevoie și de acces la Plătitori sau Clienți.")}</p>
        ) : (
          <>
            <form method="get" className="my-2 flex gap-2">
              <input name="q" defaultValue={query} placeholder={t("Caută cont portal (nume, cont, contract, email)")} className="h-9 min-w-0 flex-1 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand" />
              <button type="submit" className="tap h-9 rounded-xl border border-[var(--color-line)] px-3 text-sm font-medium hover:bg-[var(--color-surface-2)]">{t("Caută")}</button>
            </form>
            <p className="mb-1 text-xs text-ink-soft">{query ? t("Rezultate") : t("Ultimii clienți conectați în portal")}</p>
            {clients.length === 0 ? (
              <p className="py-3 text-sm text-ink-soft">{t("Niciun cont de portal găsit.")}</p>
            ) : (
              <ul className="divide-y divide-[var(--color-line)]">
                {clients.map((c) => (
                  <li key={c.id} data-client-id={c.id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{c.name}</p>
                      <p className="truncate text-xs text-ink-soft">{[c.meterSeries, c.apaCanalContract, c.email].filter(Boolean).join(" · ") || "—"}</p>
                    </div>
                    <form method="post" action="/api/simulare/portal">
                      <input type="hidden" name="clientId" value={c.id} />
                      <button type="submit" className={btn}>{t("Intră în portal")}</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}
