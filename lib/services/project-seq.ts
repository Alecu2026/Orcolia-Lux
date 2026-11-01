import "server-only";
import { prisma } from "../prisma";
import { lookupEpoch } from "../lookup-memory";

/** Atribuie seq secvențial tuturor proiectelor care nu au încă unul (apelat de pagina Proiecte; nu e o acțiune apelabilă din browser). */
const g = globalThis as unknown as { __projectSeqChecked?: number };

export async function backfillProjectSeq(): Promise<void> {
  // Proiectele create din acțiuni primesc numărul la creare; cele create prin import îl primesc aici. Verificarea rulează doar după o scriere pe Project (epoca din lookup-memory), nu la fiecare vizită a paginii.
  const epoch = lookupEpoch();
  if (g.__projectSeqChecked === epoch) return;
  g.__projectSeqChecked = epoch;
  const projects = await prisma.project.findMany({
    where: { seq: null },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!projects.length) return;

  // Pornește contorul de unde e acum (sau de la 0 dacă nu există)
  const existing = await prisma.counter.findUnique({ where: { name: "project-seq" }, select: { value: true } });
  let next = existing?.value ?? 0;

  for (const p of projects) {
    next += 1;
    await prisma.project.update({ where: { id: p.id }, data: { seq: next } });
  }

  await prisma.counter.upsert({
    where: { name: "project-seq" },
    create: { name: "project-seq", value: next },
    update: { value: next },
  });
}
