import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { tasksByProject } from "@/lib/queries/invoices";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !can(user, "invoices.view")) {
    return NextResponse.json({ items: [] }, { status: 401 });
  }
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ items: [] });
  const items = await tasksByProject(projectId);
  return NextResponse.json({ items });
}
