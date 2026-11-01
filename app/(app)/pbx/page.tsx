import { requirePermission } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { env } from "@/lib/env";
import { callsHead, notifyHead } from "@/lib/services/pbx-data";
import { DEMO } from "@/lib/demo";
import Link from "next/link";
import PbxTable from "@/app/components/PbxTable";
import NotifyCallsTable from "@/app/components/NotifyCallsTable";
import { getT } from "@/lib/i18n/server-t";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "apeluri", label: "Apeluri" },
  { key: "notificari", label: "Notificări apel" },
] as const;

export default async function PbxPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tr = await getT();
  const user = await requirePermission("pbx.view");
  const tab = (await searchParams).tab === "notificari" ? "notificari" : "apeluri";
  const tabs = (
    <div className="mb-2 flex gap-1.5">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.key === "apeluri" ? "/pbx" : "/pbx?tab=notificari"}
          className={`tap inline-flex h-8 cursor-pointer items-center rounded-lg border px-3 text-xs font-semibold ${tab === t.key ? "border-brand bg-brand text-white" : "border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)]"}`}
        >
          {tr(t.label)}
        </Link>
      ))}
    </div>
  );

  // Pagina primește doar primele rânduri (proaspete); lista completă vine în browser și se completează cu diferența (vezi lib/services/pbx-data.ts).
  if (tab === "notificari") {
    const queue = DEMO ? [] : (await notifyHead()).rows;
    return (
      <div className="w-full">
        {tabs}
        <NotifyCallsTable rows={queue} defaultOperator={env.pbx.callUser} canManage={can(user, "pbx.manage")} />
      </div>
    );
  }

  const rows = DEMO ? [] : (await callsHead()).rows;

  return (
    <div className="w-full">
      {tabs}
      <PbxTable rows={rows} webhookUrl={`${env.appUrl.replace(/\/$/, "")}/api/pbx`} tokenConfigured={!!env.pbx.crmToken} canManage={can(user, "pbx.manage")} canTask={can(user, "tasks.create")} canClient={can(user, "clients.create")} />
    </div>
  );
}
