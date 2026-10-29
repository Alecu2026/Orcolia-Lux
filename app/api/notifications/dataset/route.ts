import { getCurrentUser } from "@/lib/dal";
import { getNotificationDataset, notificationVersion } from "@/lib/services/notification-dataset";

export const dynamic = "force-dynamic";

/**
 * Lista completă a notificărilor utilizatorului (cele mai noi 5000), compactă, gzip, cu ETag după versiune: dacă nu s-a schimbat nimic de la ultima cerere răspunsul e
 * „304” fără corp, iar serverul nici nu citește notificările (doar 3 numărători pe index).
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  try {
    const v = await notificationVersion(user.id);
    // ETag = doar structura (total + cea mai nouă): marcarea ca citite nu cere o nouă descărcare; ce s-a citit în altă parte se vede din „X-Unread” (numărul de necitite) față de cel local
    const etag = `W/"n-${v.structure}"`;
    const headers = { "Cache-Control": "private, no-cache", ETag: etag, "X-Unread": String(v.unread), "Access-Control-Expose-Headers": "X-Unread" };
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    const blob = await getNotificationDataset(user.id, v);
    return new Response(new Uint8Array(blob.gz), { headers: { ...headers, "Content-Type": "application/json", "Content-Encoding": "gzip" } });
  } catch (e) {
    console.error("[notificari-dataset] eșuat:", e);
    return Response.json({ error: "Nu am putut încărca notificările." }, { status: 500 });
  }
}
