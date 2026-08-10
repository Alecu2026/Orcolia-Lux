// Import one-off: public/device_admin_table_axioma_w1_water_meters_list.xlsx — export de la
// sistemul de contorizare Axioma W1 (1045 contoare, adresă/GPS/indice curent), dar FĂRĂ nume
// proprietar și FĂRĂ număr de contract (acelea vin din 1C, integrare separată, ulterioară).
// Pentru testare: numărul de contract ("Serie contor" pt. portal) devine secvențial (1,2,3...),
// iar numele e un placeholder pe baza ID-ului contorului, până vine integrarea reală cu 1C.
//
// Salvează și un instantaneu al datelor de contor (meterNumber/meterCurrReading/consumAddress)
// pe Client, folosit ca să generăm automat prima factură Apă-Canal la activarea contului
// (vezi confirmClientRegistration în app/actions/client-auth.ts) — rulabil și ca update pass
// (upsert pe meterSeries) dacă rulezi din nou peste clienți deja importați.
import XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const SRC = "public/device_admin_table_axioma_w1_water_meters_list.xlsx";
const OWNER_EMAIL = "caramangheorghe7b@gmail.com";

const COL = { entityName: 0, currVolume: 3, adresa: 6, blocNr: 7, apartmentNr: 8 };

async function main() {
  const owner = await prisma.user.findUnique({ where: { email: OWNER_EMAIL }, select: { id: true } });
  if (!owner) throw new Error(`Nu găsesc contul owner: ${OWNER_EMAIL}`);

  const wb = XLSX.readFile(SRC);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });

  let created = 0;
  let updated = 0;
  let noReading = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const entityName = String(row[COL.entityName] || "").trim();
    if (!entityName) continue;
    const meterSeries = String(i);

    const adresa = String(row[COL.adresa] || "").trim();
    const blocNr = String(row[COL.blocNr] || "").trim();
    const apartmentNr = String(row[COL.apartmentNr] || "").trim();
    const consumAddress = [adresa, blocNr && `bl. ${blocNr}`, apartmentNr && `ap. ${apartmentNr}`]
      .filter(Boolean)
      .join(", ");

    const rawVolume = String(row[COL.currVolume] || "").trim();
    const hasReading = rawVolume !== "";
    if (!hasReading) noReading++;
    const meterCurrReading = hasReading ? Number(rawVolume.replace(/[^\d.]/g, "")) || 0 : 0;

    const fields = {
      meterNumber: entityName,
      meterCurrReading,
      meterReadingEstimated: !hasReading,
      consumAddress: consumAddress || null,
    };

    const existing = await prisma.client.findUnique({ where: { meterSeries }, select: { id: true } });
    if (existing) {
      await prisma.client.update({ where: { id: existing.id }, data: fields });
      updated++;
    } else {
      await prisma.client.create({
        data: {
          userId: owner.id,
          name: `Contor ${entityName}`, // placeholder — numele real vine din 1C, ulterior
          meterSeries,
          ...fields,
        },
      });
      created++;
    }
  }

  console.log(`Clienți creați: ${created}, actualizați: ${updated}, fără citire încă: ${noReading}.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
