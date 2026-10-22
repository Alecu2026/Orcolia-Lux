import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/dal";
import { searchClients } from "@/lib/queries/clients";
import { canAny } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ items: [] }, { status: 401 });

  // Căutarea de clienți alimentează selectoarele din formulare: oricine are voie să aleagă un client într-un formular (sau să vadă clienții).
  const allowed = canAny(user, ["clients.view", "payers.view", "invoices.create", "invoices.edit", "tasks.create", "tasks.edit", "appointments.manage", "projects.create", "projects.edit"]);
  if (!allowed) return NextResponse.json({ items: [] }, { status: 403 });

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const items = await searchClients(user.id, q, 8);
  return NextResponse.json({ items });
}
