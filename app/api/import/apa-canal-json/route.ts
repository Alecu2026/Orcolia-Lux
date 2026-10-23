import { revalidateTag } from "next/cache";
import { rebuildPayerSnap } from "@/lib/services/payer-cache";
import { rebuildInvoiceSnap } from "@/lib/services/invoice-cache";
import { del } from "@vercel/blob";
import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { logAudit } from "@/lib/services/audit";
import { importApaCanalBuffer } from "@/lib/services/apa-canal-import";

// Fișierul poate depăși cu mult limita de 4.5 MB pentru corpul unui request către o funcție
// serverless Vercel — de-asta clientul îl urcă întâi direct în Vercel Blob (vezi
// /api/upload/apa-canal-import + ApaCanalJsonImport.tsx) și trimite aici doar URL-ul rezultat;
// noi îl descărcăm server-side (fără limita aceea) și abia apoi îl procesăm.
// Import complet (~18k documente) durează sub 2 minute local — alocăm marjă generoasă.
export const maxDuration = 300;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "invoices.create") || !can(user, "clients.create")) {
    return Response.json({ error: "Nu ai permisiunea de a importa date Apă-Canal." }, { status: 403 });
  }

  let body: { blobUrl?: string; commit?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Cerere invalidă." }, { status: 400 });
  }
  const blobUrl = body.blobUrl?.trim();
  const commit = body.commit === true;
  if (!blobUrl) return Response.json({ error: "Lipsește fișierul (blobUrl)." }, { status: 400 });

  let buf: Buffer;
  try {
    const fileRes = await fetch(blobUrl);
    if (!fileRes.ok) throw new Error(`status ${fileRes.status}`);
    buf = Buffer.from(await fileRes.arrayBuffer());
  } catch (e) {
    return Response.json(
      { error: `Nu s-a putut descărca fișierul urcat: ${e instanceof Error ? e.message : "eroare necunoscută"}.` },
      { status: 400 },
    );
  }

  let result: Awaited<ReturnType<typeof importApaCanalBuffer>>;
  try {
    result = await importApaCanalBuffer(buf, { ownerId: user.id, commit });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Fișier invalid." }, { status: 400 });
  }
  const { plan, applied } = result;

  if (!commit || !applied) {
    return Response.json({ dryRun: true, stats: plan.stats });
  }

  await del(blobUrl).catch(() => {});
  // expire:0 — invalidare imediată (import creează mii de clienți; stale-while-revalidate ar
  // ține lista veche până la următoarea vizită "max").
  revalidateTag("clients", { expire: 0 });
  await rebuildPayerSnap("import 1C").catch((e) => console.error("[payer-cache] după import:", e));
  await rebuildInvoiceSnap("import 1C").catch((e) => console.error("[invoice-cache] după import 1C:", e));

  await logAudit(
    { id: user.id, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin },
    {
      action: "invoice.bulk_import",
      module: "Invoices",
      objectName: `Import Apă-Canal JSON — ${plan.stats.documenteTotale} documente`,
      newValue: `Clienți noi: ${applied.clientsCreated}, actualizați: ${applied.clientsUpdated}. Facturi: ${applied.invoicesCreated}, linii: ${applied.itemsCreated}.`,
    },
  );

  return Response.json({ dryRun: false, stats: plan.stats, applied });
}
