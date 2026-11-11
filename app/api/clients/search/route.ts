import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/dal";
import { clientBrief, searchClients } from "@/lib/queries/clients";
import { canAny } from "@/lib/permissions";

/**
 * Căutarea de clienți pentru câmpurile cu sugestii.
 *  - `?q=text` → primele 8 potriviri (nume, telefon; la plătitori și contul / contractul);
 *  - `&kind=payer` → doar plătitorii (din 1C); `&kind=client` → doar clienții obișnuiți (fără plătitori);
 *  - `?id=<id>` → un singur client (ca formularul să știe dacă e plătitor sau client și cum se numește).
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ items: [] }, { status: 401 });

  // Căutarea de clienți alimentează selectoarele din formulare: oricine are voie să aleagă un client într-un formular (sau să vadă clienții).
  const allowed = canAny(user, ["clients.view", "payers.view", "invoices.create", "invoices.edit", "tasks.create", "tasks.edit", "appointments.manage", "projects.create", "projects.edit"]);
  if (!allowed) return NextResponse.json({ items: [] }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    if (!/^[0-9a-f]{24}$/i.test(id)) return NextResponse.json({ item: null });
    return NextResponse.json({ item: await clientBrief(id) });
  }

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const k = req.nextUrl.searchParams.get("kind");
  const kind = k === "payer" || k === "client" ? k : undefined;
  const items = await searchClients(user.id, q, 8, kind);
  return NextResponse.json({ items });
}
