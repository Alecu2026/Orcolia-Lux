import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getMeterDetail, type MeterDetailResponse } from "@/lib/queries/meters";
import { prisma } from "@/lib/prisma";
import { listMeterReadings } from "@/lib/services/meter-readings";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Detaliile unui contor pentru pop-up: câmpurile brute din 1C, calculul, consumatorul și istoricul citirilor (toate lunile importate). */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "payers.view")) return Response.json({ error: "Fără permisiune." }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const id = sp.get("id") ?? "";
  const invoiceNumber = (sp.get("invoice") ?? "").slice(0, 60);
  if (!id || id.length > 300) return Response.json({ error: "Id invalid." }, { status: 400 });
  try {
    const detail = await getMeterDetail(id);
    if (!detail) return Response.json({ error: "Contorul nu mai există în ultima sincronizare. Reîncarcă lista." }, { status: 404 });
    // Factura curentă a abonatului (nr. din tabel) → id + token public, ca pop-up-ul să o poată deschide direct.
    const invoice = invoiceNumber ? await prisma.invoice.findUnique({ where: { number: invoiceNumber }, select: { id: true, publicToken: true } }) : null;
    const field = await listMeterReadings(id, 3);
    const body: MeterDetailResponse = { ...detail, invoice, field };
    return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[contoare-detail] eșuat:", e);
    return Response.json({ error: "Nu am putut încărca detaliile." }, { status: 500 });
  }
}
