// Curățare one-off: șterge plătitorii-placeholder creați de scripts/import-axioma-water-meters.mjs
// (nume „Contor S09841061", „cont personal" secvențial 1,2,3…) care n-au primit niciodată date reale.
//
// SIGUR PRIN IMPLICIT: fără argumente doar AFIȘEAZĂ ce ar șterge (dry-run). Ștergerea reală cere --apply.
//   node --env-file=.env scripts/cleanup-axioma-placeholders.mjs            # doar listează
//   node --env-file=.env scripts/cleanup-axioma-placeholders.mjs --apply    # șterge
// Cu --toate: nu mai caută doar „Contor S…", ci ORICE plătitor fără facturi (aceleași protecții de mai jos):
//   node --env-file=.env scripts/cleanup-axioma-placeholders.mjs --toate           # doar listează
//   node --env-file=.env scripts/cleanup-axioma-placeholders.mjs --toate --apply   # șterge
// (DATABASE_URL din .env trebuie să arate spre baza pe care vrei s-o cureți.)
//
// Se șterg DOAR plătitorii care îndeplinesc TOATE condițiile:
//   - (fără --toate) numele începe cu „Contor S" urmat de cifre (placeholder-ul scriptului Axioma)
//   - nu au nicio factură, programare, proiect sau task
//   - nu au cont de portal activat
// Orice altceva (inclusiv un „Contor S…" care a primit între timp facturi/cont) rămâne neatins.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const ALL = process.argv.includes("--toate");
const NAME_RE = /^Contor\s+S\d+/i;
const CHUNK = 100;

async function main() {
  console.log(`Mod: ${APPLY ? "ȘTERGERE REALĂ (--apply)" : "dry-run (nu se șterge nimic)"} · căutare: ${ALL ? "TOȚI plătitorii fără facturi (--toate)" : "doar Contor S…"}`);

  const candidates = ALL
    ? await prisma.client.findMany({
        // „plătitor" = are cont personal sau nr. de contract 1C (la fel ca în aplicație)
        where: { OR: [{ meterSeries: { not: null } }, { apaCanalContract: { not: null } }] },
        select: { id: true, name: true, meterSeries: true, portalPasswordHash: true, email: true, phone: true },
      })
    : (
        await prisma.client.findMany({
          where: { name: { startsWith: "Contor", mode: "insensitive" } },
          select: { id: true, name: true, meterSeries: true, portalPasswordHash: true, email: true, phone: true },
        })
      ).filter((c) => NAME_RE.test(c.name));
  console.log(`Plătitori examinați: ${candidates.length}`);

  const ids = candidates.map((c) => c.id);
  const groupIds = async (model) => {
    const out = new Set();
    for (let i = 0; i < ids.length; i += 500) {
      const rows = await prisma[model].groupBy({ by: ["clientId"], where: { clientId: { in: ids.slice(i, i + 500) } }, _count: { _all: true } });
      rows.forEach((r) => out.add(r.clientId));
    }
    return out;
  };
  const [inv, appt, proj, task] = await Promise.all([groupIds("invoice"), groupIds("appointment"), groupIds("project"), groupIds("task")]);

  const keep = { cuFacturi: 0, cuActivitate: 0, cuCont: 0 };
  const del = [];
  for (const c of candidates) {
    if (inv.has(c.id)) keep.cuFacturi++;
    else if (appt.has(c.id) || proj.has(c.id) || task.has(c.id)) keep.cuActivitate++;
    else if (c.portalPasswordHash) keep.cuCont++;
    else del.push(c);
  }
  console.log(`Rămân (au facturi): ${keep.cuFacturi} · (programări/proiecte/task-uri): ${keep.cuActivitate} · (cont portal activ): ${keep.cuCont}`);
  console.log(`De șters: ${del.length}`);
  if (ALL) {
    const nonPlaceholder = del.filter((c) => !NAME_RE.test(c.name));
    console.log(`   din care NU sunt Contor S…: ${nonPlaceholder.length}`);
    for (const c of nonPlaceholder.slice(0, 15)) console.log(`     * ${c.name} (cont personal ${c.meterSeries ?? "—"}${c.email ? ", " + c.email : ""}${c.phone ? ", " + c.phone : ""})`);
  }
  for (const c of del.slice(0, 10)) console.log(`   - ${c.name} (cont personal ${c.meterSeries ?? "—"})`);
  if (del.length > 10) console.log(`   … și încă ${del.length - 10}`);

  if (!APPLY) {
    console.log("\nNu s-a șters nimic. Rulează din nou cu --apply ca să ștergi.");
    return;
  }

  let deleted = 0;
  for (let i = 0; i < del.length; i += CHUNK) {
    const batch = del.slice(i, i + CHUNK).map((c) => c.id);
    await prisma.payerNote.deleteMany({ where: { clientId: { in: batch } } });
    const r = await prisma.client.deleteMany({ where: { id: { in: batch } } });
    deleted += r.count;
    process.stdout.write(`\r  șterși ${deleted}/${del.length}`);
  }
  console.log(`\nGata. Șterși: ${deleted}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
