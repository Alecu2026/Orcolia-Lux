/**
 * Promovează un utilizator la super-admin după email.
 *
 * Utilizare:
 *   node scripts/make-super-admin.mjs email@exemplu.com
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Utilizare: node scripts/make-super-admin.mjs email@exemplu.com");
  process.exit(1);
}

const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, isSuperAdmin: true } });
if (!user) {
  console.error(`Utilizatorul cu emailul „${email}" nu a fost găsit.`);
  process.exit(1);
}

if (user.isSuperAdmin) {
  console.log(`✅ ${user.name} (${email}) este deja super-admin.`);
  process.exit(0);
}

await prisma.user.update({ where: { email }, data: { isSuperAdmin: true } });
console.log(`✅ ${user.name} (${email}) a fost promovat la super-admin.`);

await prisma.$disconnect();
