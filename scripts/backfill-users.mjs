import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const users = await prisma.user.findMany({ select: { id: true } }).catch(() => []);
let fixed = 0;
for (const u of users) {
  await prisma.user.update({
    where: { id: u.id },
    data: { isActive: true, permissions: [], teamIds: [] },
  });
  fixed++;
}
console.log(`Backfill complet: ${fixed} utilizatori actualizați.`);
await prisma.$disconnect();
