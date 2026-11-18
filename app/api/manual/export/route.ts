import { getCurrentUser } from "@/lib/dal";
import { canEditManual } from "@/lib/manual-editor";
import { readAllManualShotsFull } from "@/lib/services/manual-shots";
import { buildPackage } from "@/lib/manual/package";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Exportul tuturor pozelor din manual într-un singur fișier ZIP (poze + manifest): îl iei de pe serverul de lucru și îl imporți în producție, unde pozele ajung singure la locul lor (după cheie).
 * Doar contul editor.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!canEditManual(user.email)) return Response.json({ error: "Nu ai dreptul să exporți pozele din manual." }, { status: 403 });
  try {
    const shots = await readAllManualShotsFull();
    if (shots.length === 0) return Response.json({ error: "Nu există poze de exportat." }, { status: 404 });
    const zip = buildPackage(shots);
    const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Bucharest" });
    return new Response(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="manual-poze-${day}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[manual-export] eșuat:", e);
    return Response.json({ error: "Nu am putut crea pachetul. Încearcă din nou." }, { status: 500 });
  }
}
