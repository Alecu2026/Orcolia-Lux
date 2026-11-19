/**
 * Dă un cod (1, 2, 3, …) utilizatorilor care nu au încă (cod folosit în numărul sarcinilor: „cod-AN/nr”).
 * Ordinea: createdAt ASC (conturile mai vechi primesc coduri mai mici). Codurile deja puse nu se ating.
 * Nu e obligatoriu: un cont fără cod primește unul automat la prima sarcină creată; scriptul doar le dă dinainte, într-o ordine previzibilă.
 *
 * Utilizare: node --env-file=.env scripts/backfill-user-code.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const users = await prisma.user.findMany({ select: { id: true, name: true, code: true, createdAt: true }, orderBy: { createdAt: "asc" } });
const used = new Set(users.filter((u) => u.code != null).map((u) => u.code));
let next = 1;
let assigned = 0;
for (const u of users) {
  if (u.code != null) continue;
  while (used.has(next)) next++;
  await prisma.user.update({ where: { id: u.id }, data: { code: next } });
  used.add(next);
  console.log(`  ${u.name}: cod ${next}`);
  assigned++;
}
console.log(`Gata! ${assigned} utilizatori au primit cod (din ${users.length}).`);
await prisma.$disconnect();
