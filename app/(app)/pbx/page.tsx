import { requirePermission } from "@/lib/dal";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { DEMO } from "@/lib/demo";
import PbxTable, { type PbxCallRow } from "@/app/components/PbxTable";

export const dynamic = "force-dynamic";

export default async function PbxPage() {
  await requirePermission("clients.view");

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
      <PbxTable rows={rows} webhookUrl={`${env.appUrl.replace(/\/$/, "")}/api/pbx`} tokenConfigured={!!env.pbx.crmToken} />
    </div>
  );
}
