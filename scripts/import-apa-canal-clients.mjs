// Script one-off: citește public/Tabel1.xlsx (clienți Apă-Canal noi), completează coloana
// "Номер договора" (lipsă la toți) cu numere random unice — placeholder de "Serie contor"
// pentru portalul de client, până vin numerele reale — scrie Excel-ul actualizat înapoi ca
// Tabel1-completat.xlsx (originalul rămâne neatins), și creează câte un Client per rând sub
// contul Gheorghe.
import XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";
import { randomInt } from "node:crypto";

const prisma = new PrismaClient();

const SRC = "public/Tabel1.xlsx";
const OUT = "public/Tabel1-completat.xlsx";
const OWNER_EMAIL = "caramangheorghe7b@gmail.com";

const COL = {
  N: 0,
  name: 1,
  contPersonal: 3, // Лицевой счет
  contract: 4, // Номер договора — devine "Serie contor"
  phone: 12, // Телефон
  sector: 13, // Участок
};

function randomSeries(existing) {
  let n;
  do {
    n = String(randomInt(100000, 1000000)); // 6 cifre
  } while (existing.has(n));
  existing.add(n);
  return n;
}

async function main() {
  const owner = await prisma.user.findUnique({ where: { email: OWNER_EMAIL }, select: { id: true, name: true } });
  if (!owner) throw new Error(`Nu găsesc contul owner: ${OWNER_EMAIL}`);

  const existingSeries = new Set(
    (await prisma.client.findMany({ where: { meterSeries: { not: null } }, select: { meterSeries: true } }))
      .map((c) => c.meterSeries)
      .filter(Boolean),
  );

  const wb = XLSX.readFile(SRC);
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  const created = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[COL.contract]) {
      row[COL.contract] = randomSeries(existingSeries);
    }
  }

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const name = String(row[COL.name] || "").trim();
    if (!name) continue;
    const meterSeries = String(row[COL.contract]);
    const phone = String(row[COL.phone] || "").trim() || null;

    const client = await prisma.client.upsert({
      where: { meterSeries },
      update: { name, phone },
      create: { userId: owner.id, name, phone, meterSeries },
      select: { id: true, name: true, meterSeries: true },
    });
    created.push(client);
  }

  const newSheet = XLSX.utils.aoa_to_sheet(rows);
  const newWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(newWb, newSheet, sheetName);
  XLSX.writeFile(newWb, OUT);

  console.log(`Excel actualizat scris în ${OUT}`);
  console.log(`Clienți creați/actualizați (${created.length}):`);
  for (const c of created) console.log(`  - ${c.name}: serie ${c.meterSeries}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
