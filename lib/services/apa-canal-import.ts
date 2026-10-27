import "server-only";
import { randomBytes } from "node:crypto";
import iconv from "iconv-lite";
import { ObjectId } from "mongodb";
import type { Prisma } from "@prisma/client";
import { buildOneCRecords, makeNameFixer } from "../apa-canal-1c";
import { prisma } from "../prisma";
import { apaCanalDueDate } from "../apa-canal-due";

/**
 * Import date Apă-Canal dintr-un export 1C (JSON, de regulă codificat Windows-1251) — formatul
 * folosit de scripts/import-apa-canal-cahul-april2024.mjs pentru importul inițial (18.261
 * abonați, aprilie 2024). Acest modul e nucleul REFOLOSIT de API-ul de import (POST
 * /api/import/apa-canal-json) — scriptul CLI rămâne neatins (a rulat deja o dată, cu succes,
 * peste baza de producție) ca să nu riscăm să stricăm ceva ce deja funcționează.
 *
 * Fișierul are 6 tabele legate prin UID:
 *   Документы (Documente)            — sold/factură curentă (Начислено/ОплаченоДолг/СуммаКОплате)
 *   Абоненты (Abonenți)              — nume/contract/cont personal/adresă/telefon
 *   Потребители (Consumatori)        — zonă presiune apă/sector
 *   ИзмерительныеПриборы (Contoare)  — nr. contor, dată instalare/demontare
 *   Потребления (Citiri)             — citire precedentă/curentă
 *   РасчетСумм (Calcul sume)         — linii de facturare (apă/canal)
 */

export type ApaCanalRawData = {
  documente: Record<string, unknown>[];
  abonenti: Record<string, unknown>[];
  consumatori: Record<string, unknown>[];
  contoare: Record<string, unknown>[];
  citiri: Record<string, unknown>[];
  calculeSume: Record<string, unknown>[];
};

const LUNI_RO = [
  "IANUARIE", "FEBRUARIE", "MARTIE", "APRILIE", "MAI", "IUNIE",
  "IULIE", "AUGUST", "SEPTEMBRIE", "OCTOMBRIE", "NOIEMBRIE", "DECEMBRIE",
];

const SERVICE_RO: Record<string, string> = {
  "Потребление воды": "Serviciul de alimentare cu apă",
  "Сброс канализации": "Serviciul de canalizare",
};

const SECTOR_RO: Record<string, string> = {
  "Частный": "Sector privat",
  "Коммунальный": "Sector comunal",
};

const round2 = (n: unknown) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const oid = () => new ObjectId().toHexString();
const genToken = () => randomBytes(18).toString("base64url");
const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const str = (v: unknown) => String(v ?? "").trim();
const pad5 = (n: unknown) => {
  const s = String(Math.trunc(Number(n) || 0));
  return s.length < 5 ? s.padStart(5, "0") : s;
};

/**
 * Decodează bufferul brut. Acceptă atât exportul original (Windows-1251), cât și un JSON deja
 * UTF-8 — încearcă întâi UTF-8 (dacă parsează curat ȘI conține texte non-ASCII valide, adică nu
 * a fost de fapt Windows-1251 citit greșit ca UTF-8), altfel cade pe Windows-1251.
 */
export function parseApaCanalBuffer(input: Buffer): ApaCanalRawData {
  let obj: Record<string, unknown> | null = null;

  // Serviciile HTTP 1C întorc frecvent UTF-8 cu BOM (EF BB BF) sau UTF-16 — JSON.parse pică pe BOM.
  let buf = input;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.subarray(3);
  else if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) buf = Buffer.from(buf.subarray(2).toString("utf16le"), "utf-8");
  else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const sw = Buffer.from(buf.subarray(2));
    sw.swap16();
    buf = Buffer.from(sw.toString("utf16le"), "utf-8");
  }

  const tryUtf8 = () => {
    const text = buf.toString("utf-8");
    // Windows-1251 citit greșit ca UTF-8 produce caracterul de înlocuire U+FFFD în locul
    // literelor chirilice — dacă apare, nu e UTF-8 valid pentru datele astea.
    if (text.includes("�")) return null;
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const tryWin1251 = () => {
    const text = iconv.decode(buf, "win1251");
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  obj = tryUtf8() ?? tryWin1251();
  if (!obj) throw new Error("Răspunsul nu este JSON valid (nici UTF-8, nici Windows-1251).");

  // Unele API-uri împachetează datele ({ "data": {...} } sau o listă cu un singur obiect): le desfacem.
  const hasTables = (o: unknown): o is Record<string, unknown> =>
    !!o && typeof o === "object" && !Array.isArray(o) && Array.isArray((o as Record<string, unknown>)["Документы"]);
  if (!hasTables(obj)) {
    const root: unknown = obj;
    const candidates: unknown[] = Array.isArray(root) ? root : Object.values(obj);
    const inner = candidates.find(hasTables) ?? (candidates.length === 1 && Array.isArray(candidates[0]) ? (candidates[0] as unknown[]).find(hasTables) : undefined);
    if (inner) obj = inner as Record<string, unknown>;
  }

  const documente = (obj["Документы"] as Record<string, unknown>[]) ?? [];
  const abonenti = (obj["Абоненты"] as Record<string, unknown>[]) ?? [];
  const consumatori = (obj["Потребители"] as Record<string, unknown>[]) ?? [];
  const contoare = (obj["ИзмерительныеПриборы"] as Record<string, unknown>[]) ?? [];
  const citiri = (obj["Потребления"] as Record<string, unknown>[]) ?? [];
  const calculeSume = (obj["РасчетСумм"] as Record<string, unknown>[]) ?? [];

  if (documente.length === 0 || abonenti.length === 0) {
    throw new Error(
      "Nu găsesc tabelele așteptate (\"Документы\"/\"Абоненты\") — nu pare exportul 1C Apă-Canal (format diferit față de fișierul exportat?).",
    );
  }

  return { documente, abonenti, consumatori, contoare, citiri, calculeSume };
}

export type ExistingClientLite = {
  id: string;
  name: string;
  meterSeries: string | null;
  portalActivatedAt: Date | null;
  /** Data ultimei facturi (instantaneul din Client) — un import mai vechi nu are voie să o dea înapoi. */
  lastInvoiceIssueDate?: Date | null;
  /** Nr. contract 1C al firmelor (fără cont personal) — vezi Client.apaCanalContract. */
  apaCanalContract?: string | null;
};

export type ExistingInvoiceLite = {
  clientId: string | null;
  issueDate: Date;
  /** Valorile stocate — pentru a actualiza o factură existentă când 1C trimite date corectate. */
  id?: string;
  meterNumber?: string | null;
  meterPrevReading?: string | null;
  meterCurrReading?: string | null;
  subtotal?: number | null;
  datoriiAvans?: number | null;
  grandTotal?: number | null;
  dueDate?: Date | null;
};

// Scadența facturilor Apă-Canal = ziua de 25 a lunii facturii (vezi lib/apa-canal-due.ts).
const dueDateFrom = apaCanalDueDate;

export type ApaCanalPlanStats = {
  documenteTotale: number;
  sariteFaraAbonent: number;
  clientiNoiDeCreat: number;
  clientiExistentiActualizati: number;
  dinCareCuContActivatPastrat: number;
  coliziuniContPersonal: number;
  facturiDeCreat: number;
  facturiSaritePreexistente: number;
  /** Din cele existente: câte au primit date corectate din 1C (contor, citiri, sume). */
  facturiActualizate: number;
  liniiFacturaDeCreat: number;
  totalNecuvenit: number;
  totalDePlata: number;
};

/** Ce s-a întâmplat cu fiecare document din fișier/API — pentru raportul detaliat din "Sincronizare API". */
export type ApaCanalDocOutcome = {
  uid: string;
  number: string | null;
  name: string;
  contPersonal: string | null;
  /** НомерДоговора — singurul identificator al firmelor/instituțiilor, care nu au cont personal. */
  contract?: string | null;
  period: string | null;
  status: "nou" | "existent" | "actualizat" | "sarit";
  clientNou?: boolean;
  motiv?: string;
  /** La "actualizat": ce s-a schimbat (valoarea din aplicație → valoarea nouă din 1C). */
  diffs?: { camp: string; api: string; aplicatie: string }[];
  api: { calculat: number; datorie: number; deAchitat: number; citirePrec: string | null; citireCurenta: string | null } | null;
};

export type ApaCanalPlan = {
  clientsToCreate: Prisma.ClientCreateManyInput[];
  clientUpdates: { id: string; data: Prisma.ClientUpdateInput }[];
  invoicesToCreate: Prisma.InvoiceCreateManyInput[];
  itemsToCreate: Prisma.InvoiceItemCreateManyInput[];
  /** Facturi existente (aceeași lună) ale căror date din 1C s-au schimbat: câmpuri noi + liniile de calcul refăcute. */
  invoiceUpdates: { id: string; data: Prisma.InvoiceUpdateInput; items: Prisma.InvoiceItemCreateManyInput[] | null }[];
  stats: ApaCanalPlanStats;
  docs: ApaCanalDocOutcome[];
};

/**
 * Construiește planul de import (pur, fără nicio scriere în bază) — id-uri Mongo pre-generate,
 * ca să putem lega facturile/liniile de clienți fără dus-întors la bază per rând.
 *
 * Potrivire client (în ordinea asta): (1) clientul facturii cu același număr, deja în bază, (2) clientul
 * cu același cont personal (Лицевой счет), (3) nume normalizat — primul potrivit "consumă" acel client
 * existent (un nume care apare de 2 ori în fișier nu va suprascrie de 2 ori același client). Primele
 * două fac importul repetabil (același fișier / același API de mai multe ori nu dublează nimic, nici
 * măcar clienții ale căror nume au fost corectate între timp). Cont personal devine Client.meterSeries
 * (cod de login portal) — ÎNSĂ nu se atinge la clienții care și-au activat deja contul (le-ar bloca
 * login-ul), și nici dacă valoarea e deja folosită de alt client (coliziune, foarte rar).
 *
 * Număr factură: `AC-<cont personal>` (sau `AC-<uid>` fără cont). Dacă există deja o factură cu acel
 * număr din ALTĂ lună, cea nouă primește sufixul perioadei (`AC-<cont>-YYYYMM`) — deci o sincronizare
 * dintr-o perioadă nouă adaugă facturi noi, iar una din aceeași perioadă nu face nimic (nici nu
 * suprascrie facturile modificate manual).
 */
export function buildApaCanalPlan(
  data: ApaCanalRawData,
  ctx: {
    ownerId: string;
    existingClients: ExistingClientLite[];
    existingInvoiceNumbers: Set<string>;
    /** number → {clientId, issueDate}; permite potrivirea după factură și numerotarea pe perioade. */
    existingInvoices?: Map<string, ExistingInvoiceLite>;
  },
): ApaCanalPlan {
  const docByUid = new Map(data.documente.map((d) => [str(d.UID), d]));
  const subByUid = new Map(data.abonenti.map((a) => [str(a.UID), a]));

  const consumerByUid = new Map<string, Record<string, unknown>>();
  for (const c of data.consumatori) {
    const uid = str(c.UID);
    const prev = consumerByUid.get(uid);
    if (!prev || str(c["Период"]) > str(prev["Период"])) consumerByUid.set(uid, c);
  }

  const meterByUid = new Map<string, Record<string, unknown>>();
  for (const mtr of data.contoare) {
    const uid = str(mtr.UID);
    const prev = meterByUid.get(uid);
    const active = !mtr["ДатаСнятия"] || str(mtr["ДатаСнятия"]).startsWith("0001-01-01");
    if (!prev) { meterByUid.set(uid, mtr); continue; }
    const prevActive = !prev["ДатаСнятия"] || str(prev["ДатаСнятия"]).startsWith("0001-01-01");
    if (active && !prevActive) { meterByUid.set(uid, mtr); continue; }
    if (active === prevActive && str(mtr["ДатаУстановки"]) > str(prev["ДатаУстановки"])) {
      meterByUid.set(uid, mtr);
    }
  }

  // `meter` = contorul pe care s-a făcut citirea cea mai recentă a lunii (Потребления.ИзмерительныйПрибор).
  type Reading = { prev: number; curr: number; total: number; dataPokazanii: string; estimat: boolean; meter?: string };
  const readingByUid = new Map<string, Reading>();
  for (const r of data.citiri) {
    const uid = str(r.UID);
    const agg = readingByUid.get(uid) ?? { prev: 0, curr: 0, total: 0, dataPokazanii: "", estimat: false };
    agg.total += Number(r["ИтогПотребления"]) || 0;
    if (str(r["ДатаПоказаний"]) >= agg.dataPokazanii) {
      agg.dataPokazanii = str(r["ДатаПоказаний"]);
      agg.prev = Number(r["ПредыдущиеПоказания"]) || 0;
      agg.curr = Number(r["Показания"]) || 0;
      if (str(r["ИзмерительныйПрибор"])) agg.meter = str(r["ИзмерительныйПрибор"]);
    }
    if (str(r["Источник"]) !== "Контролер") agg.estimat = true;
    readingByUid.set(uid, agg);
  }

  const itemsByUid = new Map<string, Record<string, unknown>[]>();
  for (const it of data.calculeSume) {
    const uid = str(it.UID);
    const arr = itemsByUid.get(uid) ?? [];
    arr.push(it);
    itemsByUid.set(uid, arr);
  }

  const clientsByNameKey = new Map<string, ExistingClientLite[]>();
  for (const c of ctx.existingClients) {
    const list = clientsByNameKey.get(norm(c.name)) ?? [];
    list.push(c);
    clientsByNameKey.set(norm(c.name), list);
  }
  const clientBySeries = new Map(ctx.existingClients.filter((c) => c.meterSeries).map((c) => [c.meterSeries as string, c]));
  const clientByContract = new Map(ctx.existingClients.filter((c) => c.apaCanalContract).map((c) => [c.apaCanalContract as string, c]));
  const clientById = new Map(ctx.existingClients.map((c) => [c.id, c]));
  const existingInvoices = ctx.existingInvoices ?? new Map<string, ExistingInvoiceLite>();
  const usedMeterSeries = new Set(ctx.existingClients.map((c) => c.meterSeries).filter(Boolean) as string[]);
  const consumedNames = new Set<string>();
  const existingInvoiceNumbers = new Set(ctx.existingInvoiceNumbers);

  const clientsToCreate: Prisma.ClientCreateManyInput[] = [];
  const clientUpdates: { id: string; data: Prisma.ClientUpdateInput }[] = [];
  const invoicesToCreate: Prisma.InvoiceCreateManyInput[] = [];
  const itemsToCreate: Prisma.InvoiceItemCreateManyInput[] = [];
  const invoiceUpdates: ApaCanalPlan["invoiceUpdates"] = [];

  const buildItems = (invoiceId: string, rows: Record<string, unknown>[]): Prisma.InvoiceItemCreateManyInput[] =>
    rows.map((it, idx) => {
      const lineTotal = round2(it["Сумма"]);
      return {
        id: oid(),
        invoiceId,
        description: SERVICE_RO[str(it["ТипУслуги"])] ?? (str(it["ТипУслуги"]) || "Serviciu"),
        quantity: Number(it["Показания"]) || 0,
        unitPrice: Number(it["Цена"]) || 0,
        taxRate: 0,
        lineSubtotal: lineTotal,
        lineTotal,
        position: idx,
      };
    });

  let skippedNoDoc = 0;
  let meterSeriesCollisions = 0;
  let preservedActivated = 0;
  let matchedExisting = 0;
  let createdNew = 0;
  let skippedExistingInvoice = 0;
  const docs: ApaCanalDocOutcome[] = [];

  for (const [uid, doc] of docByUid) {
    const sub = subByUid.get(uid);
    if (!sub) {
      skippedNoDoc++;
      docs.push({ uid, number: null, name: "", contPersonal: null, period: null, status: "sarit", motiv: "Documentul nu are abonat în tabelul Абоненты (același UID)", api: null });
      continue;
    }

    const name = str(sub["Наименование"]);
    if (!name) {
      skippedNoDoc++;
      docs.push({ uid, number: null, name: "", contPersonal: str(sub["ЛицевойСчет"]) || null, contract: str(sub["НомерДоговора"]) || null, period: null, status: "sarit", motiv: "Abonatul nu are nume (Наименование gol)", api: null });
      continue;
    }

    const consumer = consumerByUid.get(uid);
    const meter = meterByUid.get(uid);
    const reading = readingByUid.get(uid);
    const items = itemsByUid.get(uid) ?? [];

    const contPersonalRaw = str(sub["ЛицевойСчет"]);

    const issueDate = new Date(str(doc["Дата"]));
    const baseNumber = contPersonalRaw ? `AC-${contPersonalRaw}` : `AC-${uid.slice(0, 8)}`;
    const baseExisting = existingInvoices.get(baseNumber);
    const sameMonth = (a: Date, b: Date) => a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
    const period = `${issueDate.getUTCFullYear()}${String(issueDate.getUTCMonth() + 1).padStart(2, "0")}`;
    const number = baseExisting && !sameMonth(baseExisting.issueDate, issueDate) ? `${baseNumber}-${period}` : baseNumber;
    const apiValues = {
      calculat: round2(doc["Начислено"]),
      datorie: round2(doc["ОплаченоДолг"]),
      deAchitat: round2(round2(doc["Начислено"]) + round2(doc["ОплаченоДолг"])),
      citirePrec: reading ? pad5(reading.prev) : null,
      citireCurenta: reading ? pad5(reading.curr) : null,
    };
    const docBase = { uid, number, name, contPersonal: contPersonalRaw || null, contract: str(sub["НомерДоговора"]) || null, period: `${period.slice(0, 4)}-${period.slice(4)}`, api: apiValues };

    const phone = str(sub["Телефон"]) || null;
    const consumAddress = [
      str(sub["Город"]),
      str(sub["Улица"]) ? `str. ${str(sub["Улица"])}` : "",
      str(sub["Дом"]) ? `nr. ${str(sub["Дом"])}` : "",
      str(sub["Квартира"]) ? `ap. ${str(sub["Квартира"])}` : "",
    ].filter(Boolean).join(", ") || null;
    const sectorRaw = str(sub["ТипСектора"]) || str(consumer?.["Участок"]);
    const sectorNr = sectorRaw ? (SECTOR_RO[sectorRaw] ?? sectorRaw) : null;
    // Contorul citit în luna facturii (dintre citiri), altfel cel activ din lista de contoare: la o lună mai veche,
    // contorul activ de azi poate fi altul decât cel de atunci (ex. înlocuit între timp).
    const meterNumber = reading?.meter || (meter ? str(meter["ИзмерительныйПрибор"]) || null : null);
    const meterCurrReadingNum = reading ? reading.curr : null;
    const meterReadingEstimated = reading ? reading.estimat : false;

    // Factura există deja (același abonat, aceeași perioadă): nu se creează alta. Dacă 1C trimite acum alte
    // valori (ex. nr. contorului corectat, citiri, sume), factura existentă se ACTUALIZEAZĂ cu ele — altfel o
    // corectură făcută în 1C nu ajungea niciodată în aplicație ("nu se actualizează datele").
    if (existingInvoiceNumbers.has(number)) {
      skippedExistingInvoice++;
      const stored = existingInvoices.get(number);
      const diffs: { camp: string; api: string; aplicatie: string }[] = [];
      let amountsChanged = false;
      if (stored?.id) {
        const meterKey = (v: string | null | undefined) => String(v ?? "").trim().replace(/^0+/, "");
        if (meterNumber && meterKey(meterNumber) !== meterKey(stored.meterNumber)) diffs.push({ camp: "Nr. contor", api: meterNumber, aplicatie: stored.meterNumber || "—" });
        const txt = (camp: string, api: string | null, app: string | null | undefined) => {
          if (api !== null && api !== (app ?? null)) diffs.push({ camp, api, aplicatie: app || "—" });
        };
        txt("Citire precedentă", apiValues.citirePrec, stored.meterPrevReading);
        txt("Citire curentă", apiValues.citireCurenta, stored.meterCurrReading);
        const num = (camp: string, api: number, app: number | null | undefined) => {
          if (Math.abs(api - (app ?? 0)) > 0.005) { diffs.push({ camp, api: api.toFixed(2), aplicatie: (app ?? 0).toFixed(2) }); amountsChanged = true; }
        };
        num("Calculat (MDL)", apiValues.calculat, stored.subtotal);
        num("Datorie/avans (MDL)", apiValues.datorie, stored.datoriiAvans);
        num("De achitat (MDL)", apiValues.deAchitat, stored.grandTotal);
      }
      if (stored?.id && diffs.length) {
        invoiceUpdates.push({
          id: stored.id,
          data: {
            ...(meterNumber ? { meterNumber } : {}),
            meterPrevReading: apiValues.citirePrec,
            meterCurrReading: apiValues.citireCurenta,
            isEstimatedVolume: meterReadingEstimated,
            subtotal: apiValues.calculat,
            datoriiAvans: apiValues.datorie,
            grandTotal: apiValues.deAchitat,
            dueDate: dueDateFrom(stored.issueDate),
            ...(sectorNr ? { sectorNr } : {}),
            ...(reading ? { monthlyConsumption: [{ label: String(issueDate.getUTCMonth() + 1), value: round2(reading.total) }] } : {}),
          },
          items: amountsChanged ? buildItems(stored.id, items) : null,
        });
        // Instantaneul de pe fișa plătitorului (contor, sold) — doar dacă e factura lui cea mai nouă.
        const owner = stored.clientId ? clientById.get(stored.clientId) : undefined;
        if (owner && (!owner.lastInvoiceIssueDate || issueDate >= owner.lastInvoiceIssueDate)) {
          clientUpdates.push({
            id: owner.id,
            data: {
              ...(meterNumber ? { meterNumber } : {}),
              meterCurrReading: meterCurrReadingNum,
              meterReadingEstimated,
              lastInvoiceGrandTotal: apiValues.deAchitat,
              ...(sectorNr ? { lastInvoiceSectorNr: sectorNr } : {}),
            },
          });
        }
        docs.push({ ...docBase, status: "actualizat", diffs });
      } else {
        docs.push({ ...docBase, status: "existent" });
      }
      continue;
    }

    // Identitatea clientului: factură → cont personal → (firme, fără cont) nr. contract → nume.
    // Numele doar ca ultimă variantă și DOAR spre un client fără identitate 1C (fără cont personal și fără
    // contract, adică unul din CRM, de dinaintea importului). Altfel o firmă ajungea pe contul unei persoane
    // cu același nume (s-a întâmplat: 12 facturi din sept. 2026), iar un abonat nou — pe contul unui omonim.
    const contractRaw = str(sub["НомерДоговора"]);
    const nameKey = norm(name);
    let existing: ExistingClientLite | undefined =
      (baseExisting?.clientId ? clientById.get(baseExisting.clientId) : undefined) ??
      (contPersonalRaw ? clientBySeries.get(contPersonalRaw) : undefined) ??
      (!contPersonalRaw && contractRaw ? clientByContract.get(contractRaw) : undefined);
    const matchedByIdentity = !!existing;
    if (!existing && !consumedNames.has(nameKey)) {
      existing = clientsByNameKey.get(nameKey)?.find((c) => !c.meterSeries && !c.apaCanalContract);
    }

    let meterSeries: string | null = null;
    if (contPersonalRaw) {
      if (existing && existing.meterSeries === contPersonalRaw) meterSeries = contPersonalRaw; // deja al lui
      else if (!usedMeterSeries.has(contPersonalRaw)) meterSeries = contPersonalRaw;
      else meterSeriesCollisions++;
    }

    // Calculat aici (nu mai jos, la construcția facturii) — Client.lastInvoice* trebuie
    // populat direct la import, ca /platitori (sold, status, sector) să nu depindă de o
    // reîmprospătare ulterioară care rulează doar la creare/editare individuală de factură.
    const subtotal = round2(doc["Начислено"]);
    const datoriiAvans = round2(doc["ОплаченоДолг"]);
    const grandTotal = round2(subtotal + datoriiAvans);

    let clientId: string;
    if (existing) {
      if (!matchedByIdentity) consumedNames.add(nameKey);
      matchedExisting++;
      clientId = existing.id;
      // Un import dintr-o perioadă mai veche nu are voie să dea înapoi instantaneul "ultima factură".
      const newest = !existing.lastInvoiceIssueDate || issueDate >= existing.lastInvoiceIssueDate;
      const upd: Prisma.ClientUpdateInput = {
        consumAddress: consumAddress ?? undefined,
        ...(newest
          ? {
              meterNumber,
              meterCurrReading: meterCurrReadingNum,
              meterReadingEstimated,
              lastInvoiceStatus: "SENT" as const,
              lastInvoiceGrandTotal: grandTotal,
              lastInvoiceSectorNr: sectorNr,
              lastInvoiceIssueDate: issueDate,
            }
          : {}),
      };
      existing.lastInvoiceIssueDate = newest ? issueDate : existing.lastInvoiceIssueDate;
      if (existing.portalActivatedAt) {
        preservedActivated++;
      } else if (meterSeries && meterSeries !== existing.meterSeries) {
        upd.meterSeries = meterSeries;
        if (existing.meterSeries) usedMeterSeries.delete(existing.meterSeries);
        usedMeterSeries.add(meterSeries);
      }
      if (!contPersonalRaw && contractRaw && !existing.apaCanalContract && !existing.meterSeries) {
        upd.apaCanalContract = contractRaw;
        existing.apaCanalContract = contractRaw;
        clientByContract.set(contractRaw, existing);
      }
      clientUpdates.push({ id: existing.id, data: upd });
    } else {
      createdNew++;
      clientId = oid();
      if (meterSeries) usedMeterSeries.add(meterSeries);
      clientsToCreate.push({
        id: clientId,
        userId: ctx.ownerId,
        name,
        phone,
        meterSeries,
        meterNumber,
        meterCurrReading: meterCurrReadingNum,
        meterReadingEstimated,
        consumAddress,
        lastInvoiceStatus: "SENT",
        lastInvoiceGrandTotal: grandTotal,
        lastInvoiceSectorNr: sectorNr,
        lastInvoiceIssueDate: issueDate,
        apaCanalImport: !meterSeries,
        apaCanalContract: !contPersonalRaw && contractRaw ? contractRaw : null,
      });
      const created: ExistingClientLite = {
        id: clientId, name, meterSeries, portalActivatedAt: null, lastInvoiceIssueDate: issueDate,
        apaCanalContract: !contPersonalRaw && contractRaw ? contractRaw : null,
      };
      clientsByNameKey.set(nameKey, [...(clientsByNameKey.get(nameKey) ?? []), created]);
      clientById.set(clientId, created);
      if (meterSeries) clientBySeries.set(meterSeries, created);
      if (created.apaCanalContract) clientByContract.set(created.apaCanalContract, created);
      consumedNames.add(nameKey);
    }

    existingInvoiceNumbers.add(number);
    docs.push({ ...docBase, status: "nou", clientNou: !existing });

    const invoiceId = oid();
    invoicesToCreate.push({
      id: invoiceId,
      number,
      status: "SENT",
      kind: "APA_CANAL",
      issueDate,
      dueDate: dueDateFrom(issueDate),
      contPersonal: contPersonalRaw || null,
      sectorNr,
      consumAddress,
      consumerName: name,
      meterNumber,
      meterPrevReading: reading ? pad5(reading.prev) : null,
      meterCurrReading: reading ? pad5(reading.curr) : null,
      isEstimatedVolume: meterReadingEstimated,
      billingPeriodLabel: `${LUNI_RO[issueDate.getUTCMonth()]} ${issueDate.getUTCFullYear()}`,
      recalculari: 0,
      penalitati: 0,
      datoriiAvans,
      monthlyConsumption: reading
        ? [{ label: String(issueDate.getUTCMonth() + 1), value: round2(reading.total) }]
        : [],
      clientId,
      currency: "MDL",
      subtotal,
      taxTotal: 0,
      grandTotal,
      publicToken: genToken(),
      userId: ctx.ownerId,
    });

    itemsToCreate.push(...buildItems(invoiceId, items));
  }

  const totalNecuvenit = round2(invoicesToCreate.reduce((s, i) => s + (i.subtotal as number), 0));
  const totalDePlata = round2(invoicesToCreate.reduce((s, i) => s + (i.grandTotal as number), 0));

  return {
    clientsToCreate,
    clientUpdates,
    invoicesToCreate,
    itemsToCreate,
    docs,
    invoiceUpdates,
    stats: {
      documenteTotale: docByUid.size,
      sariteFaraAbonent: skippedNoDoc,
      clientiNoiDeCreat: clientsToCreate.length,
      clientiExistentiActualizati: clientUpdates.length,
      dinCareCuContActivatPastrat: preservedActivated,
      coliziuniContPersonal: meterSeriesCollisions,
      facturiDeCreat: invoicesToCreate.length,
      facturiSaritePreexistente: skippedExistingInvoice,
      facturiActualizate: invoiceUpdates.length,
      liniiFacturaDeCreat: itemsToCreate.length,
      totalNecuvenit,
      totalDePlata,
    },
  };
}

const CHUNK = 1000;

async function chunkedCreateMany<T>(
  createMany: (args: { data: T[] }) => Promise<{ count: number }>,
  rows: T[],
): Promise<number> {
  let created = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const res = await createMany({ data: rows.slice(i, i + CHUNK) });
    created += res.count;
  }
  return created;
}

export type ApaCanalApplyResult = {
  clientsCreated: number;
  clientsUpdated: number;
  invoicesCreated: number;
  itemsCreated: number;
  invoicesUpdated: number;
};

// Interfață minimală, scrisă de mână (NU derivată din PrismaClient) — clientul din
// lib/prisma.ts e rezultatul unui $extends() ale cărui delegate-uri au un tip generic intern
// diferit de PrismaClient brut și nu se potrivesc structural cu Pick<PrismaClient, ...>, deși
// la runtime metodele chemate aici (createMany/update) au exact aceeași semnătură funcțională.
type ApaCanalPrisma = {
  client: {
    createMany(args: { data: Prisma.ClientCreateManyInput[] }): Promise<{ count: number }>;
  };
  invoice: {
    createMany(args: { data: Prisma.InvoiceCreateManyInput[] }): Promise<{ count: number }>;
    update(args: { where: { id: string }; data: Prisma.InvoiceUpdateInput }): Promise<unknown>;
  };
  invoiceItem: {
    createMany(args: { data: Prisma.InvoiceItemCreateManyInput[] }): Promise<{ count: number }>;
    deleteMany(args: { where: { invoiceId: string } }): Promise<{ count: number }>;
  };
  $runCommandRaw(command: object): Promise<unknown>;
};

/** `Date` → EJSON `{$date}` (altfel ajunge string simplu în Mongo, nefiltrabil ca dată la citire);
 * restul valorilor merg ca atare. `undefined` e omis explicit din `$set` (nu doar lăsat să cadă la
 * JSON.stringify), ca intenția „nu atinge câmpul ăsta" să rămână clară. */
function toSetDoc(data: Record<string, unknown>): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    set[k] = v instanceof Date ? { $date: v.toISOString() } : v;
  }
  return set;
}

/**
 * Actualizează clienții existenți printr-o singură comandă nativă MongoDB `update` per lot (bulk,
 * un round-trip pentru mii de actualizări), nu câte un apel Prisma per client. La ~18.700 clienți
 * de actualizat, varianta anterioară (update() individual, 50 în paralel) a dus sincronizarea peste
 * limita de 300 s a funcției Vercel — timeout real, observat 2026-10-10 (log: "Task timed out after
 * 300 seconds"), care lăsa și blocarea de sincronizare agățată 10 minute (vezi acquireSyncLock),
 * fiindcă un kill forțat de platformă sare peste blocul `finally` care ar fi eliberat-o.
 */
async function bulkUpdateClients(
  prisma: ApaCanalPrisma,
  updates: { id: string; data: Prisma.ClientUpdateInput }[],
): Promise<number> {
  if (!updates.length) return 0;
  const CHUNK = 2000;
  let modified = 0;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const slice = updates.slice(i, i + CHUNK);
    const res = (await prisma.$runCommandRaw({
      update: "Client",
      updates: slice.map((u) => ({
        q: { _id: { $oid: u.id } },
        u: { $set: toSetDoc(u.data as Record<string, unknown>) },
      })),
      ordered: false,
    })) as { n?: number; nModified?: number };
    modified += res.nModified ?? res.n ?? slice.length;
  }
  return modified;
}

type OneCPrisma = {
  invoice: {
    findMany(args: { where: { kind: "APA_CANAL" }; select: { number: true; clientId: true } }): Promise<{ number: string; clientId: string | null }[]>;
  };
  client: {
    findMany(args: { select: { id: true; name: true; meterSeries: true } }): Promise<{ id: string; name: string; meterSeries: string | null }[]>;
  };
  oneCRecord: {
    deleteMany(args: { where: { uid: { in: string[] } } }): Promise<{ count: number }>;
    createMany(args: { data: Prisma.OneCRecordCreateManyInput[] }): Promise<{ count: number }>;
  };
};

/**
 * Păstrează "Tabelul 1C" (colecția OneCRecord, un rând per UID cu TOATE datele din cele 6 tabele)
 * în pas cu fiecare import: înlocuiește înregistrările abonaților din fișier. Rulat după
 * applyApaCanalPlan, ca facturile să existe deja (legătura cu clientul se face după nr. factură).
 */
export async function syncOneCRecords(prisma: OneCPrisma, data: ApaCanalRawData): Promise<number> {
  const invs = await prisma.invoice.findMany({ where: { kind: "APA_CANAL" }, select: { number: true, clientId: true } });
  const clientByNumber = new Map(invs.map((i) => [i.number, i.clientId]));
  // Numele cu "?" (Ș/Ț pierdute de exportul 1C) se iau din clienții din PWA, unde sunt deja corectate.
  const clients = await prisma.client.findMany({ select: { id: true, name: true, meterSeries: true } });
  const records = buildOneCRecords(data, { fixName: makeNameFixer(clients, clientByNumber) });

  // Loturi de câte 500 de UID-uri (fiecare: șterge vechile + inserează noile), câte 4 în paralel — loturile
  // au UID-uri diferite, deci nu se calcă între ele. Secvențial, ~18.000 de înregistrări durau ~100 s din
  // cele 300 s ale funcției.
  const CHUNK = 500;
  const PARALLEL = 4;
  const chunks: (typeof records)[] = [];
  for (let i = 0; i < records.length; i += CHUNK) chunks.push(records.slice(i, i + CHUNK));
  let written = 0;
  for (let i = 0; i < chunks.length; i += PARALLEL) {
    const counts = await Promise.all(
      chunks.slice(i, i + PARALLEL).map(async (slice) => {
        await prisma.oneCRecord.deleteMany({ where: { uid: { in: slice.map((r) => r.uid) } } });
        const res = await prisma.oneCRecord.createMany({
          data: slice.map((r) => ({
            ...r,
            clientId: (r.invoiceNumber && clientByNumber.get(r.invoiceNumber)) || null,
            consumers: r.consumers as unknown as Prisma.InputJsonValue,
            meters: r.meters as unknown as Prisma.InputJsonValue,
            readings: r.readings as unknown as Prisma.InputJsonValue,
            lines: r.lines as unknown as Prisma.InputJsonValue,
          })),
        });
        return res.count;
      }),
    );
    written += counts.reduce((x, y) => x + y, 0);
  }
  return written;
}

/**
 * Pipeline-ul complet, comun importului din fișier și sincronizării din API: parsare → plan → (opțional)
 * scriere + Tabelul 1C. Fără `commit` doar calculează planul (statistici), fără nicio scriere.
 * Un eșec la Tabelul 1C nu strică importul deja scris — doar se raportează în log.
 */
export async function importApaCanalBuffer(buf: Buffer, opts: { ownerId: string; commit: boolean }) {
  const data = parseApaCanalBuffer(buf);

  const [existingClients, existingInvoices] = await Promise.all([
    // Toți clienții, nu doar ai utilizatorului care rulează importul: aplicația e a unei singure firme,
    // iar plătitorii aparțin celui care i-a importat prima dată — altfel, la o sincronizare pornită de
    // altcineva, toți ar părea "noi" și s-ar dubla.
    prisma.client.findMany({
      select: { id: true, name: true, meterSeries: true, portalActivatedAt: true, lastInvoiceIssueDate: true, apaCanalContract: true },
    }),
    prisma.invoice.findMany({
      select: {
        id: true, number: true, clientId: true, issueDate: true, meterNumber: true, meterPrevReading: true,
        meterCurrReading: true, subtotal: true, datoriiAvans: true, grandTotal: true, dueDate: true,
      },
    }),
  ]);

  const plan = buildApaCanalPlan(data, {
    ownerId: opts.ownerId,
    existingClients,
    existingInvoiceNumbers: new Set(existingInvoices.map((i) => i.number)),
    existingInvoices: new Map(existingInvoices.map((i) => [i.number, i])),
  });
  if (!opts.commit) return { data, plan, applied: null as ApaCanalApplyResult | null };

  const applied = await applyApaCanalPlan(prisma, plan);
  try {
    await syncOneCRecords(prisma, data);
    // Lista de contoare (/contoare) se construiește din aceste înregistrări: o reconstruim în fundal.
    await import("./meter-cache").then((m) => m.invalidateMeters()).catch((e) => console.error("[apa-canal-import] nu am putut marca lista de contoare:", e));
  } catch (e) {
    console.error("[apa-canal-import] sincronizarea Tabelului 1C a eșuat:", e);
  }
  return { data, plan, applied };
}

export type SyncReportDiff = { camp: string; api: string; aplicatie: string };
export type SyncReportRow = {
  number: string | null;
  name: string;
  contPersonal: string | null;
  contract?: string | null;
  period: string | null;
  deAchitat: number | null;
  clientNou?: boolean;
  motiv?: string;
  diffs?: SyncReportDiff[];
};
export type SyncReport = {
  /** Câte rânduri are fiecare tabel în răspuns — aceleași cifre ca în Node-RED. */
  tabele: { nume: string; ro: string; randuri: number }[];
  documenteUnice: number;
  documenteRepetate: number;
  counts: { noi: number; noiCuClientNou: number; identice: number; diferite: number; sarite: number };
  noi: SyncReportRow[];
  diferite: SyncReportRow[];
  identice: SyncReportRow[];
  sarite: SyncReportRow[];
  /** Listele de mai sus sunt tăiate la LIST_LIMIT rânduri, ca răspunsul să rămână mic la 18.000 de abonați. */
  limita: number;
};

const REPORT_LIST_LIMIT = 300;
const money2 = (n: number) => n.toFixed(2);

/**
 * Raportul detaliat pentru "Sincronizare API": pentru fiecare document din API — factură nouă, factură deja
 * existentă IDENTICĂ, deja existentă dar cu valori DIFERITE (care anume), sau sărit (de ce). Facturile existente
 * nu sunt modificate de sincronizare (vezi buildApaCanalPlan); raportul doar arată dacă datele din API mai
 * corespund cu cele din aplicație.
 */
// Comparația cu facturile existente se face deja în buildApaCanalPlan (în memorie) — aici nu mai citim nimic
// din bază: un `number: { in: [~18.000] }` dura ~80 s.
export async function buildSyncReport(data: ApaCanalRawData, plan: ApaCanalPlan): Promise<SyncReport> {
  const noi: SyncReportRow[] = [];
  const diferite: SyncReportRow[] = [];
  const identice: SyncReportRow[] = [];
  const sarite: SyncReportRow[] = [];
  let noiCuClientNou = 0;

  for (const d of plan.docs) {
    const base: SyncReportRow = { number: d.number, name: d.name, contPersonal: d.contPersonal, contract: d.contract ?? null, period: d.period, deAchitat: d.api?.deAchitat ?? null };
    if (d.status === "sarit") {
      sarite.push({ ...base, motiv: d.motiv });
    } else if (d.status === "nou") {
      if (d.clientNou) noiCuClientNou++;
      noi.push({ ...base, clientNou: d.clientNou });
    } else if (d.status === "actualizat") {
      diferite.push({ ...base, diffs: d.diffs });
    } else {
      identice.push(base);
    }
  }

  const tabele = [
    { nume: "Документы", ro: "Documente (chitanțe)", randuri: data.documente.length },
    { nume: "Абоненты", ro: "Abonați", randuri: data.abonenti.length },
    { nume: "Потребители", ro: "Consumatori", randuri: data.consumatori.length },
    { nume: "ИзмерительныеПриборы", ro: "Contoare", randuri: data.contoare.length },
    { nume: "Потребления", ro: "Citiri", randuri: data.citiri.length },
    { nume: "РасчетСумм", ro: "Linii de calcul (apă/canal)", randuri: data.calculeSume.length },
  ];

  return {
    tabele,
    documenteUnice: plan.docs.length,
    documenteRepetate: data.documente.length - plan.docs.length,
    counts: { noi: noi.length, noiCuClientNou, identice: identice.length, diferite: diferite.length, sarite: sarite.length },
    noi: noi.slice(0, REPORT_LIST_LIMIT),
    diferite: diferite.slice(0, REPORT_LIST_LIMIT),
    identice: identice.slice(0, REPORT_LIST_LIMIT),
    sarite: sarite.slice(0, REPORT_LIST_LIMIT),
    limita: REPORT_LIST_LIMIT,
  };
}

/** Scrie planul efectiv în bază (batch-uit — vezi scripts/import-apa-canal-cahul-april2024.mjs). */
export async function applyApaCanalPlan(
  prisma: ApaCanalPrisma,
  plan: ApaCanalPlan,
): Promise<ApaCanalApplyResult> {
  const clientsCreated = await chunkedCreateMany(
    (args) => prisma.client.createMany(args),
    plan.clientsToCreate,
  );

  const clientsUpdated = await bulkUpdateClients(prisma, plan.clientUpdates);

  const invoicesCreated = await chunkedCreateMany(
    (args) => prisma.invoice.createMany(args),
    plan.invoicesToCreate,
  );
  const itemsCreated = await chunkedCreateMany(
    (args) => prisma.invoiceItem.createMany(args),
    plan.itemsToCreate,
  );

  // Facturi existente cu date corectate în 1C: câmpurile noi + (dacă s-au schimbat sumele) liniile de calcul refăcute.
  let invoicesUpdated = 0;
  for (let i = 0; i < plan.invoiceUpdates.length; i += 25) {
    const slice = plan.invoiceUpdates.slice(i, i + 25);
    await Promise.all(
      slice.map(async (u) => {
        await prisma.invoice.update({ where: { id: u.id }, data: u.data });
        if (u.items) {
          await prisma.invoiceItem.deleteMany({ where: { invoiceId: u.id } });
          if (u.items.length) await prisma.invoiceItem.createMany({ data: u.items });
        }
      }),
    );
    invoicesUpdated += slice.length;
  }

  return { clientsCreated, clientsUpdated, invoicesCreated, itemsCreated, invoicesUpdated };
}
