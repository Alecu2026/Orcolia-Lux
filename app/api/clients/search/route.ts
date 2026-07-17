import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/dal";
import { searchClients } from "@/lib/queries/clients";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ items: [] }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const items = await searchClients(user.id, q, 8);
  return NextResponse.json({ items });
}
