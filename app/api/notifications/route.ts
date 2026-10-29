import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/dal";
import { listNotificationFeed, unreadCount } from "@/lib/queries/notifications";
import { isNotificationKind } from "@/lib/notification-kind";
import { notificationVersion } from "@/lib/services/notification-dataset";

export const dynamic = "force-dynamic";

/**
 * Inbox-ul de notificări (doar ale utilizatorului curent):
 *  - `?count=1` → doar numărul de necitite (clopoțelul, la interval);
 *  - `?after=<ISO>` → notificările mai noi decât acel moment (apar live în inbox);
 *  - `?before=<ISO>` → cele mai vechi (derulare infinită);
 *  - `kind` (tasks / tickets / appointments / meters) și `unread=1` filtrează; `limit` max 50.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Neautentificat" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  if (sp.get("count") === "1") return NextResponse.json({ unread: await unreadCount(user.id) });

  const date = (k: string) => {
    const v = sp.get(k);
    const d = v ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  };
  const kind = sp.get("kind");
  const res = await listNotificationFeed(user.id, {
    before: date("before"),
    after: date("after"),
    kind: isNotificationKind(kind) ? kind : null,
    unreadOnly: sp.get("unread") === "1",
    limit: Math.min(50, Math.max(1, Number(sp.get("limit")) || 30)),
  });
  // „ce e nou”: cu versiunea structurii, ca lista din browser (cache) să rămână valabilă fără o nouă descărcare
  const etag = sp.get("after") && res.items.length > 0 ? `W/"n-${(await notificationVersion(user.id)).structure}"` : undefined;
  return NextResponse.json(etag ? { ...res, etag } : res, { headers: { "Cache-Control": "no-store" } });
}
