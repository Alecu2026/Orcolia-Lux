import { getCurrentUser } from "@/lib/dal";
import { can, canViewTask, canViewTaskData } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getMeterDetail, type MeterDetail } from "@/lib/queries/meters";
import { getPayerInvoices } from "@/lib/queries/payers";
import { getMeterSnap } from "@/lib/services/meter-cache";
import { listMeterReadings } from "@/lib/services/meter-readings";
import { TASK_STATUS_RO } from "@/lib/telegram";
import { plainMeter, type MeterRowBase } from "@/lib/meters";
import type { ReadingDto } from "@/lib/meter-readings";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const OBJECT_ID = /^[0-9a-f]{24}$/i;

export type MeterPageMeter = {
  detail: MeterDetail | null;
  field: ReadingDto[];
  /** Doar dacă a fost cerut (`row=1`): rândul din lista din memorie al serverului, pentru cine nu-l are deja în browser. */
  row: MeterRowBase | null;
};
export type MeterPagePayer = {
  invoices: { id: string; number: string; status: string; total: number; currency: string; issueDate: string; dueDate: string | null; token: string; label: string | null }[];
  tasks: { id: string; seq: number | null; type: string; title: string; status: string; statusRo: string; createdAt: string }[];
};

/**
 * Datele pe care pagina unui contor NU le are deja în browser (rândul contorului și al plătitorului vin din lista încărcată în memorie):
 *  - `?part=meter&id=…` — detaliile din 1C (istoric, calcul pe luni, consumator, sub-contor) și citirile din teren; `&row=1` și rândul contorului;
 *  - `?part=payer&client=…` — facturile și sarcinile/cererile plătitorului (doar ce are voie să vadă utilizatorul).
 * Cele două cereri pornesc în paralel, iar pagina arată fiecare secțiune imediat ce are datele ei.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "payers.view")) return Response.json({ error: "Fără permisiune." }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  try {
    if (sp.get("part") === "payer") {
      const client = sp.get("client") ?? "";
      if (!OBJECT_ID.test(client)) return Response.json({ error: "Plătitor invalid." }, { status: 400 });
      const [invoices, all] = await Promise.all([
        getPayerInvoices(client),
        canViewTaskData(user)
          ? prisma.task.findMany({
              where: { clientId: client },
              orderBy: { createdAt: "desc" },
              take: 40,
              select: { id: true, seq: true, type: true, title: true, status: true, createdAt: true, creatorId: true, assigneeId: true, extraAssigneeIds: true, teamId: true, extraTeamIds: true },
            })
          : Promise.resolve([]),
      ]);
      const body: MeterPagePayer = {
        invoices: invoices.slice(0, 12).map((i) => ({
          id: i.id,
          number: i.number,
          status: i.status,
          total: i.grandTotal,
          currency: i.currency,
          issueDate: i.issueDate.toISOString(),
          dueDate: i.dueDate ? i.dueDate.toISOString() : null,
          token: i.publicToken,
          label: i.billingPeriodLabel,
        })),
        tasks: all
          .filter((x) => canViewTask(user, x))
          .slice(0, 10)
          .map((x) => ({ id: x.id, seq: x.seq, type: x.type, title: x.title, status: x.status, statusRo: TASK_STATUS_RO[x.status] ?? x.status, createdAt: x.createdAt.toISOString() })),
      };
      return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
    }

    const id = sp.get("id") ?? "";
    if (!id || id.length > 300) return Response.json({ error: "Id invalid." }, { status: 400 });
    const wantRow = sp.get("row") === "1";
    const [detail, field, snap] = await Promise.all([getMeterDetail(id, { historyLimit: 120 }), listMeterReadings(id), wantRow ? getMeterSnap() : Promise.resolve(null)]);
    const found = snap?.rows.find((r) => r.id === id) ?? null;
    const body: MeterPageMeter = { detail, field, row: found ? plainMeter(found) : null };
    return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[contoare-page] eșuat:", e);
    return Response.json({ error: "Nu am putut încărca datele contorului." }, { status: 500 });
  }
}
