import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getPayerMonthSlice, getPayerSnapshot } from "@/lib/queries/payers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Snapshot-ul tuturor plătitorilor (sau, cu ?month=YYYY-MM, facturile lunii) pentru motorul local din
 * /platitori și /notificari-platitori: browserul îl ține în memorie și filtrează în JS. Un cache scurt pe server
 * evită recitirea bazei de date dacă mai mulți operatori (sau mai multe file) îl cer în același minut.
 */
let cached: { at: number; bytes: Uint8Array } | null = null;
const TTL_MS = 30_000;

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "clients.view")) return Response.json({ error: "Fără permisiune." }, { status: 403 });

  const month = new URL(req.url).searchParams.get("month");
  try {
    if (month) {
      return Response.json({ month, rows: await getPayerMonthSlice(month) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (!cached || Date.now() - cached.at > TTL_MS) {
      cached = { at: Date.now(), bytes: new TextEncoder().encode(JSON.stringify({ at: Date.now(), rows: await getPayerSnapshot() })) };
    }
    // Cu ~19.000 de plătitori JSON-ul are câțiva MB: peste ~4,5 MB, Vercel refuză un răspuns obișnuit al unei funcții
    // (500). Îl trimitem ca flux, în bucăți de 256 KB — limita nu se aplică răspunsurilor în streaming.
    const bytes = cached.bytes;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 262_144) controller.enqueue(bytes.subarray(i, i + 262_144));
        controller.close();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[platitori-snapshot] eșuat:", e);
    return Response.json({ error: "Nu am putut încărca lista de plătitori." }, { status: 500 });
  }
}
