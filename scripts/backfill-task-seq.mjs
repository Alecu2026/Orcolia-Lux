/**
 * Asignează numere secvențiale (#1, #2, …) task-urilor care nu au seq setat.
 * Se rulează o singură dată după migrarea schemei.
 * Ordinea: createdAt ASC (task-urile mai vechi primesc numere mai mici).
 *
 * Utilizare: node scripts/backfill-task-seq.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const tasks = await prisma.task.findMany({
  select: { id: true, seq: true, createdAt: true },
  orderBy: { createdAt: "asc" },
});

const withoutSeq = tasks.filter((t) => !t.seq);
console.log(`Total task-uri: ${tasks.length}, fără seq: ${withoutSeq.length}`);

// Aflăm cea mai mare valoare de seq existentă ca să nu suprascriem task-uri noi
const maxExisting = tasks.reduce((m, t) => (t.seq && t.seq > m ? t.seq : m), 0);
console.log(`Seq maxim existent: ${maxExisting}`);

// Upsert counter la maxExisting dacă e mai mare decât ce e în BD
const counter = await prisma.counter.findFirst({ where: { name: "task" } });
if (!counter || counter.value < maxExisting) {
  await prisma.counter.upsert({
    where: { name: "task" },
    create: { name: "task", value: maxExisting },
    update: { value: maxExisting },
  });
  console.log(`Counter setat la ${maxExisting}`);
}

let assigned = 0;
let next = maxExisting + 1;
for (const t of withoutSeq) {
  await prisma.task.update({ where: { id: t.id }, data: { seq: next } });
  next++;
  assigned++;
  if (assigned % 20 === 0) console.log(`  ${assigned}/${withoutSeq.length} task-uri actualizate…`);
}

// Actualizăm counter-ul la valoarea finală
await prisma.counter.upsert({
  where: { name: "task" },
  create: { name: "task", value: next - 1 },
  update: { value: next - 1 },
});

console.log(`Gata! ${assigned} task-uri au primit seq. Counter final: ${next - 1}`);
await prisma.$disconnect();
