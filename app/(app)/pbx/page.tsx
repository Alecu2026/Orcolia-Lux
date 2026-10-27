import { requirePermission } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { DEMO } from "@/lib/demo";
import Link from "next/link";
import PbxTable, { type PbxCallRow } from "@/app/components/PbxTable";
import NotifyCallsTable, { type NotifyCallRow } from "@/app/components/NotifyCallsTable";
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

  if (tab === "notificari") {
    const queue = DEMO ? [] : await prisma.notifyCall.findMany({ take: 20000, orderBy: { createdAt: "desc" } });
    // Starea/durata/înregistrarea vin din apelul PBX cu același callId (potrivire în memorie — mai rapid decât `in` pe mii de id-uri).
    const dialedIds = new Set(queue.map((q) => q.callId).filter((x): x is string => !!x));
    const pbx = dialedIds.size
      ? await prisma.pbxCall.findMany({
          take: 20000,
          orderBy: { updatedAt: "desc" },
          select: { callId: true, status: true, state: true, durationSec: true, recordingUrl: true, rating: true },
        })
      : [];
    const byCall = new Map(pbx.filter((c) => dialedIds.has(c.callId)).map((c) => [c.callId, c]));
    const rows: NotifyCallRow[] = queue.map((q) => {
      const c = q.callId ? byCall.get(q.callId) : undefined;
      return {
        id: q.id,
        campaignId: q.campaignId,
        clientId: q.clientId,
        clientName: q.clientName,
        phone: q.phone,
        text: q.text,
        at: q.createdAt.toISOString(),
        dialedAt: q.dialedAt?.toISOString() ?? null,
        operator: q.operator,
        callId: q.callId,
        status: q.status,
        note: q.note,
        userName: q.userName,
        pbxStatus: c?.status ?? null,
        pbxState: c?.state ?? null,
        durationSec: c?.durationSec ?? null,
        hasRecording: !!c?.recordingUrl,
        rating: c?.rating ?? null,
      };
    });
    return (
      <div className="w-full">
        {tabs}
        <NotifyCallsTable rows={rows} defaultOperator={env.pbx.callUser} canManage={can(user, "pbx.manage")} />
      </div>
    );
  }

  // Toate apelurile odată; filtrarea/sortarea/paginarea rulează în browser (vezi DataTable). Sortăm în JS (documentele sunt mici).
  const calls = DEMO ? [] : await prisma.pbxCall.findMany({ take: 20000 });
  const rows: PbxCallRow[] = calls
    .map((c) => ({
      id: c.id,
      callId: c.callId,
      direction: c.direction,
      phone: c.phone,
      phoneE164: c.phoneE164,
      diversion: c.diversion,
      pbxUser: c.pbxUser,
      ext: c.ext,
      status: c.status,
      state: c.state,
      durationSec: c.durationSec,
      waitSec: c.waitSec,
      // până sosește „history" (cu ora de start), folosim momentul primului mesaj
      at: (c.startAt ?? c.firstSeenAt).toISOString(),
      lastCmd: c.lastCmd,
      eventCount: c.eventCount,
      clientId: c.clientId,
      clientName: c.clientName,
      recordingUrl: c.recordingUrl,
      rating: c.rating,
      groupName: c.groupName,
      lineName: c.lineName,
      note: c.note,
    }))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return (
    <div className="w-full">
      {tabs}
      <PbxTable rows={rows} webhookUrl={`${env.appUrl.replace(/\/$/, "")}/api/pbx`} tokenConfigured={!!env.pbx.crmToken} canManage={can(user, "pbx.manage")} canTask={can(user, "tasks.create")} canClient={can(user, "clients.create")} />
    </div>
  );
}
