import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getPayerMonthSlice, getPayerSnapshot } from "@/lib/queries/payers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Snapshot-ul tuturor plătitorilor (sau, cu ?month=YYYY-MM, facturile lunii) pentru motorul local din
 * /platitori și /notificari-platitori: browserul îl ține în memorie și filtrează în JS.
 *
 * Citirea din baza de date e costisitoare (toți plătitorii + ultima factură a fiecăruia), deci:
 *  - un singur calcul la un moment dat: cererile simultane (mai multe file/operatori) așteaptă același rezultat, nu citesc fiecare din nou;
 *  - cache pe server de `TTL_MS`: o editare (email, telefon…) se vede cel târziu după atât la o reîncărcare a listei. Nu servim niciodată
 *    date mai vechi decât TTL_MS, ca să nu apară „am salvat, dar se vede valoarea veche".
 */
let cached: { at: number; bytes: Uint8Array } | null = null;
let inflight: Promise<void> | null = null;
const TTL_MS = 30_000;

function refresh(): Promise<void> {
  if (!inflight) {
    inflight = (async () => {
      const t0 = Date.now();
      const rows = await getPayerSnapshot();
      const bytes = new TextEncoder().encode(JSON.stringify({ at: Date.now(), rows }));
      cached = { at: Date.now(), bytes };
      // timpul real al citirii: dacă e de zeci de secunde, baza de date e departe sau lentă (vezi docs/SERVER-PROPRIU.md)
      console.log(`[platitori-snapshot] ${rows.length} plătitori, ${(bytes.length / 1e6).toFixed(1)} MB, ${Date.now() - t0} ms`);
    })().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "payers.view")) return Response.json({ error: "Fără permisiune." }, { status: 403 });

  const month = new URL(req.url).searchParams.get("month");
  try {
    if (month) {
      return Response.json({ month, rows: await getPayerMonthSlice(month) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (!cached || Date.now() - cached.at > TTL_MS) await refresh();
    // Cu ~19.000 de plătitori JSON-ul are câțiva MB: peste ~4,5 MB, Vercel refuză un răspuns obișnuit al unei funcții
    // (500). Îl trimitem ca flux, în bucăți de 256 KB — limita nu se aplică răspunsurilor în streaming.
    const bytes = cached!.bytes;
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
