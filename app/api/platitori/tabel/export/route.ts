import * as XLSX from "xlsx";
import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { ONEC_COLUMNS, type OneCConsumer, type OneCLine, type OneCMeter, type OneCReading } from "@/lib/apa-canal-1c";
import { buildOneCWhere, keepLatest, oneCPeriodIndex, parseOneCQuery } from "@/lib/queries/onec";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Cell = string | number | null;
type SheetKey = "main" | "consumers" | "meters" | "readings" | "lines";

const SHEETS: Record<SheetKey, { title: string; file: string; headers: string[]; widths: number[] }> = {
  main: {
    title: "Tabel comun (UID)",
    file: "tabel-comun",
    headers: [...ONEC_COLUMNS.map((c) => c.label), "Factură PWA", "Total PWA", "Diferență PWA − 1C"],
    widths: [...ONEC_COLUMNS.map((c) => c.w), 110, 100, 120],
  },
  consumers: {
    title: "Consumatori",
    file: "consumatori",
    headers: ["UID", "Abonat", "Perioadă", "Consumator", "IDNO / ИНН", "Început consum", "Sfârșit consum", "Zonă presiune", "Sector (Участок)", "Nr. consumatori", "Suprafață"],
    widths: [250, 200, 90, 220, 110, 100, 100, 100, 150, 90, 80],
  },
  meters: {
    title: "Contoare",
    file: "contoare",
    headers: ["UID", "Abonat", "Perioadă", "Consumator", "IDNO / ИНН", "Contor", "Data instalării", "Nr. sigiliu", "Data scoaterii", "Sub-abonat", "Sub-contract", "Sub-cont personal", "Sub-consumator", "Sub-contor"],
    widths: [250, 200, 90, 220, 110, 100, 100, 100, 100, 150, 100, 100, 150, 100],
  },
  readings: {
    title: "Citiri",
    file: "citiri",
    headers: ["UID", "Abonat", "Consumator", "IDNO / ИНН", "Contor", "Sursa", "Citire anterioară", "Data citirii ant.", "Citire curentă", "Data citirii", "Consum", "Valoare medie", "Consum subcontoare"],
    widths: [250, 200, 220, 110, 100, 100, 100, 100, 100, 100, 80, 90, 100],
  },
  lines: {
    title: "Linii calcul",
    file: "linii-calcul",
    headers: ["UID", "Abonat", "Consumator", "IDNO / ИНН", "Contor", "Serviciu", "Volum", "Tarif", "Sumă", "Data"],
    widths: [250, 200, 220, 110, 100, 180, 80, 80, 90, 100],
  },
};

/**
 * Exportă tabelul 1C în Excel, cu filtru interactiv pe fiecare coloană și aceleași filtre ca pe ecran.
 * O foaie pe descărcare (`?sheet=`): toate 5 într-un singur fișier ar ține ~1,7 GB de memorie pe server.
 * Răspunsul se trimite în flux: un fișier de zeci de MB depășește limita de 4,5 MB a răspunsurilor
 * "normale" ale funcțiilor Vercel, dar nu și pe a celor transmise în flux.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Autentificare necesară.", { status: 401 });
  if (!can(user, "payers.view") || !can(user, "payers.export")) return new Response("Fără permisiune de export.", { status: 403 });

  const sp = new URL(req.url).searchParams;
  const requested = sp.get("sheet") ?? "";
  const sheetKey: SheetKey = requested in SHEETS ? (requested as SheetKey) : "main";
  const def = SHEETS[sheetKey];
  const query = parseOneCQuery(sp);
  const [where, index] = await Promise.all([buildOneCWhere(query), oneCPeriodIndex()]);

  // Doar coloanele necesare foii cerute (fără listele-copil la foaia principală, și invers).
  const select: Record<string, true> = { id: true, uid: true, nume: true, invoiceNumber: true };
  if (sheetKey === "main") for (const c of ONEC_COLUMNS) select[c.key] = true;
  else select[sheetKey] = true;

  const pwa = new Map<string, number>();
  if (sheetKey === "main") {
    const invs = await prisma.invoice.findMany({ where: { kind: "APA_CANAL" }, select: { number: true, grandTotal: true } });
    for (const i of invs) pwa.set(i.number, i.grandTotal);
  }

  // Citire în ordinea _id (index) + sortare aici: un sort pe server peste documente cu liste mari
  // depășește limita de memorie de 32 MB a MongoDB.
  const CHUNK = 1500;
  type Rec = { id: string; uid: string; nume: string | null; invoiceNumber: string | null } & Record<string, unknown>;
  const records: Rec[] = [];
  for (let cursor: string | undefined; ; ) {
    const batch = (await prisma.oneCRecord.findMany({
      where,
      orderBy: { id: "asc" },
      take: CHUNK,
      select: select as never,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })) as unknown as Rec[];
    if (!batch.length) break;
    records.push(...batch);
    cursor = batch[batch.length - 1].id;
    if (batch.length < CHUNK) break;
  }
  records.sort((x, y) => (x.nume ?? "").localeCompare(y.nume ?? "", "ro") || x.uid.localeCompare(y.uid));

  const rows: Cell[][] = [];
  for (const r of keepLatest(records, query.period, index)) {
    if (sheetKey === "main") {
      const total = r.invoiceNumber ? pwa.get(r.invoiceNumber) ?? null : null;
      const de = (r.deAchitat as number | null) ?? 0;
      rows.push([
        ...ONEC_COLUMNS.map((c) => (r[c.key] as Cell) ?? null),
        r.invoiceNumber,
        total,
        total == null ? null : Math.round((total - de + Number.EPSILON) * 100) / 100,
      ]);
      continue;
    }
    const head: Cell[] = [r.uid, r.nume];
    if (sheetKey === "consumers")
      for (const c of (r.consumers as OneCConsumer[] | null) ?? [])
        rows.push([...head, c.perioada, c.nume, c.inn, c.inceput, c.sfarsit, c.zona, c.sector, c.nrPersoane, c.suprafata]);
    else if (sheetKey === "meters")
      for (const m of (r.meters as OneCMeter[] | null) ?? [])
        rows.push([...head, m.perioada, m.consumator, m.inn, m.contor, m.dataInstalare, m.sigiliu, m.dataScoatere, m.subAbonat, m.subContract, m.subCont, m.subConsumator, m.subContor]);
    else if (sheetKey === "readings")
      for (const x of (r.readings as OneCReading[] | null) ?? [])
        rows.push([...head, x.consumator, x.inn, x.contor, x.sursa, x.citirePrec, x.dataPrec, x.citire, x.dataCitire, x.consum, x.medie, x.consumSubcontoare]);
    else
      for (const l of (r.lines as OneCLine[] | null) ?? [])
        rows.push([...head, l.consumator, l.inn, l.contor, l.serviciu, l.volum, l.tarif, l.suma, l.data]);
  }
  records.length = 0;

  const ws = XLSX.utils.aoa_to_sheet([def.headers, ...rows]); // celulele null rămân goale
  ws["!cols"] = def.widths.map((w) => ({ wch: Math.round(w / 7) }));
  // Filtru interactiv (săgeata din capul fiecărei coloane) — exact ce au cerut cei de la 1C.
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length, 1), c: def.headers.length - 1 } }) };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, def.title);

  const buf = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer);
  const CH = 64 * 1024;
  let off = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (off >= buf.length) return ctrl.close();
      ctrl.enqueue(buf.subarray(off, off + CH));
      off += CH;
    },
  });
  const day = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="1c-${def.file}-${day}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
