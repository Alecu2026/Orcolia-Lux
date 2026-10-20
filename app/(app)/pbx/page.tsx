import { requirePermission } from "@/lib/dal";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { DEMO } from "@/lib/demo";
import Link from "next/link";
import PbxTable, { type PbxCallRow } from "@/app/components/PbxTable";
import NotifyCallsTable, { type NotifyCallRow } from "@/app/components/NotifyCallsTable";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "apeluri", label: "Apeluri" },
  { key: "notificari", label: "Notificări apel" },
] as const;

export default async function PbxPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requirePermission("clients.view");
  const tab = (await searchParams).tab === "notificari" ? "notificari" : "apeluri";
  const tabs = (
    <div className="mb-2 flex gap-1.5">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.key === "apeluri" ? "/pbx" : "/pbx?tab=notificari"}
          className={`tap inline-flex h-8 cursor-pointer items-center rounded-lg border px-3 text-xs font-semibold ${tab === t.key ? "border-brand bg-brand text-white" : "border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)]"}`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );

  if (tab === "notificari") {
    const calls = DEMO ? [] : await prisma.notifyCall.findMany({ take: 20000, orderBy: { createdAt: "desc" } });
    const rows: NotifyCallRow[] = calls.map((c) => ({
      id: c.id,
      callSid: c.callSid,
      campaignId: c.campaignId,
      clientId: c.clientId,
      clientName: c.clientName,
      phone: c.phone,
      voice: c.voice,
      text: c.text,
      status: c.status,
      at: c.createdAt.toISOString(),
      durationSec: c.durationSec,
      reply: c.reply,
      replyDigits: c.replyDigits,
      userName: c.userName,
    }));
    return (
      <div className="w-full">
        {tabs}
        <NotifyCallsTable rows={rows} />
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
      <PbxTable rows={rows} webhookUrl={`${env.appUrl.replace(/\/$/, "")}/api/pbx`} tokenConfigured={!!env.pbx.crmToken} />
    </div>
  );
}
