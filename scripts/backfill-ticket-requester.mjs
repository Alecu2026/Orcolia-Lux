// Tichetele create din portalul clientului înainte de „Creat de = solicitantul” au ca creator un administrator-substitut.
// Scriptul completează solicitantul (fromName / fromEmail = clientul) DOAR la tichetele care au dovada creării din portal:
// notificarea „📨 Tichet nou de la <client>” trimisă la creare. Implicit rulează în modul „doar afișare”; cu --apply scrie.
//   DATABASE_URL=... node scripts/backfill-ticket-requester.mjs          # doar listează
//   DATABASE_URL=... node scripts/backfill-ticket-requester.mjs --apply  # aplică
import { PrismaClient } from "@prisma/client";

const apply = process.argv.includes("--apply");
const prisma = new PrismaClient();

const notifs = await prisma.notification.findMany({
  where: { title: { startsWith: "📨 Tichet nou de la " }, taskId: { not: null } },
  select: { taskId: true },
});
const taskIds = [...new Set(notifs.map((n) => n.taskId).filter(Boolean))];

const tickets = await prisma.task.findMany({
  where: { id: { in: taskIds }, type: "TICKET", emailSource: false, fromName: null, fromEmail: null, clientId: { not: null } },
  select: { id: true, seq: true, title: true, client: { select: { id: true, name: true, email: true } }, creator: { select: { name: true } } },
});

console.log(`${tickets.length} tichete din portal fără solicitant (din ${taskIds.length} cu notificare de portal)`);
for (const t of tickets) {
  if (!t.client) continue;
  console.log(`  #${t.seq ?? "?"} „${t.title}” — acum: ${t.creator?.name} → va arăta: ${t.client.name}`);
  if (apply) {
    await prisma.task.update({ where: { id: t.id }, data: { fromName: t.client.name, fromEmail: t.client.email ?? null } });
  }
}
console.log(apply ? "Aplicat." : "Nimic modificat (adaugă --apply pentru a scrie).");
await prisma.$disconnect();
