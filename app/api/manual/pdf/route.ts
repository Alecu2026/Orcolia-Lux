import { getCurrentUser } from "@/lib/dal";
import { canViewManual, manualAudience, manualFor } from "@/lib/services/manual-access";
import { canEditManual } from "@/lib/manual-editor";
import { isManualPublished } from "@/lib/services/manual-state";
import { withoutEmptyShots } from "@/lib/manual/access";
import { prisma } from "@/lib/prisma";
import { DEMO } from "@/lib/demo";
import { readAllManualShots } from "@/lib/services/manual-shots";
import { withSharp } from "@/lib/services/image-pool";
import { buildManualPdf, type ManualImage } from "@/lib/pdf/manual-pdf";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * „Manual de utilizare” ca PDF (pdfkit, ca decontarea și facturile; fără browser). Pozele se citesc din baza de date (sunt deja optimizate) și se pregătesc pentru PDF (JPEG, cel mult 1400 px lățime), apoi intră în fișier.
 * ?placeholders=0 → locurile fără poză nu apar deloc (altfel apar ca un cadru galben cu instrucțiunea). Îl descarcă cine vede manualul.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!canViewManual(user, await isManualPublished())) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  // doar paginile la care are acces (aceleași ca în pagina manualului)
  const { sections: allowed, keys } = manualFor(user);
  const editor = canEditManual(user.email);
  // cadrele goale („Aici pui poza”) le primește doar editorul; ceilalți primesc doar pozele puse
  const placeholders = editor && new URL(req.url).searchParams.get("placeholders") !== "0";

  try {
    const shots = await readAllManualShots();
    const sections = editor ? allowed : withoutEmptyShots(allowed, new Set(shots.keys()));
    const images = new Map<string, ManualImage>();
    const keys2 = [...shots.keys()].filter((k) => keys.has(k));
    // conversie în paralel limitat (câteva imagini odată)
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, keys2.length) }, async () => {
        for (;;) {
          const k = keys2[next++];
          if (k === undefined) return;
          const src = shots.get(k);
          if (!src) continue;
          try {
            const buf = await withSharp((sharp) =>
              sharp(src, { failOn: "none" }).rotate().flatten({ background: "#ffffff" }).resize({ width: 1400, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer(),
            );
            images.set(k, { buf });
          } catch (e) {
            console.error(`[manual-pdf] poza „${k}” nu a putut fi citită:`, String((e as Error)?.message ?? e).slice(0, 120));
          }
        }
      }),
    );

    const company = DEMO ? null : await prisma.companySettings.findUnique({ where: { singleton: "main" }, select: { companyName: true, apaCanalCompanyLine: true } }).catch(() => null);
    const today = new Date().toLocaleDateString("ro-RO", { timeZone: "Europe/Bucharest", day: "2-digit", month: "2-digit", year: "numeric" });
    const pdf = await buildManualPdf({
      companyName: company?.apaCanalCompanyLine?.trim() || company?.companyName || "",
      today,
      sections,
      audience: manualAudience(user),
      images,
      placeholders,
      shotsTotal: keys.size,
    });
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="manual-de-utilizare.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[manual-pdf] generare eșuată:", e);
    return Response.json({ error: "Nu am putut genera PDF-ul. Încearcă din nou." }, { status: 500 });
  }
}
