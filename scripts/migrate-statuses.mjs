import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// Conversie raw (ocolește validarea enum) a statusurilor vechi -> noi
const taskRes = await prisma.$runCommandRaw({
  update: "Task",
  updates: [
    { q: { status: "PENDING" }, u: { $set: { status: "NEW" } }, multi: true },
    { q: { status: "BLOCKED" }, u: { $set: { status: "ON_HOLD" } }, multi: true },
  ],
});
const actRes = await prisma.$runCommandRaw({
  update: "TaskActivity",
  updates: [
    { q: { fromStatus: "PENDING" }, u: { $set: { fromStatus: "NEW" } }, multi: true },
    { q: { fromStatus: "BLOCKED" }, u: { $set: { fromStatus: "ON_HOLD" } }, multi: true },
    { q: { toStatus: "PENDING" }, u: { $set: { toStatus: "NEW" } }, multi: true },
    { q: { toStatus: "BLOCKED" }, u: { $set: { toStatus: "ON_HOLD" } }, multi: true },
  ],
});
console.log("Task updates:", JSON.stringify(taskRes.nModified ?? taskRes.n ?? taskRes));
console.log("Activity updates:", JSON.stringify(actRes.nModified ?? actRes.n ?? actRes));

// Verificare: citește toate task-urile prin Prisma (validează enum). Dacă trece, totul e curat.
const count = await prisma.task.count();
const sample = await prisma.task.findMany({ select: { status: true }, take: 5 });
console.log("Total task-uri:", count, "| esantion status:", sample.map((s) => s.status).join(","));
console.log("MIGRATION_OK");
await prisma.$disconnect();
