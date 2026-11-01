import { requirePermission } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { canImpersonatePortal, canImpersonateUser, IMPERSONATION_HOURS } from "@/lib/impersonation";
import { effectivePermissionKeys } from "@/lib/permissions";
import SimulatePortalTable from "@/app/components/SimulatePortalTable";
import { decodeAccount } from "@/lib/portal-accounts";
import { getPortalAccountsSnap } from "@/lib/services/portal-accounts-cache";
import { getT } from "@/lib/i18n/server-t";

export const dynamic = "force-dynamic";

/** Câte conturi sunt activate și primele 100 după ultima logare — calculate o singură dată per versiune a listei din memorie (nu la fiecare vizită, pe zeci de mii de rânduri). */
const summaries = new WeakMap<object, { activeTotal: number; initialPortal: ReturnType<typeof decodeAccount>[] }>();
function activeSummary(snap: Awaited<ReturnType<typeof getPortalAccountsSnap>>) {
  let r = summaries.get(snap);
  if (!r) {
    const active = snap.tuples.filter((t) => t[5] === 1);
    const top = active.slice().sort((a, b) => (b[7] ?? 0) - (a[7] ?? 0)).slice(0, 100).map(decodeAccount);
    r = { activeTotal: active.length, initialPortal: top };
    summaries.set(snap, r);
  }
  return r;
}

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

  const portalAllowed = canImpersonatePortal(user);
  // conturile de utilizator (puține) și lista conturilor de portal din memoria serverului pornesc odată; lista completă a portalului (zeci de mii) vine în browser, nu în pagină
  const [candidates, snap] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true, id: { not: user.id } },
      select: { id: true, name: true, email: true, role: true, permissions: true, isSuperAdmin: true, isActive: true, taskViewScope: true, taskViewTeamIds: true, taskViewMemberIds: true },
      orderBy: { name: "asc" },
    }),
    portalAllowed ? getPortalAccountsSnap() : Promise.resolve(null),
  ]);
  const users = candidates.filter((u) => canImpersonateUser(user, u).ok);

  // primele conturi activate (cei conectați cel mai recent), ca pagina să nu fie goală până sosește lista completă
  const { activeTotal, initialPortal } = snap ? activeSummary(snap) : { activeTotal: 0, initialPortal: [] };

  return (
    <div className="flex w-full flex-col gap-5">
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
            <p className="mb-2 mt-1 text-xs text-ink-soft">{t("Conturile cu portal activat. Caută după nume, cont personal, contract sau email, sau filtrează după ultima logare și data activării.")}</p>
            <SimulatePortalTable initial={initialPortal} total={snap?.tuples.length ?? 0} activeTotal={activeTotal} q={query || undefined} />
          </>
        )}
      </section>
    </div>
  );
}
