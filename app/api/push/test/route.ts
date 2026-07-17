import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/dal";
import { sendPushToUser } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Neautentificat" }, { status: 401 });

  const res = await sendPushToUser(user.id, {
    title: "Programări",
    body: "Notificările funcționează corect.",
    url: "/dashboard",
  });
  return NextResponse.json({ ok: true, ...res });
}
