import "server-only";
import { prisma } from "../prisma";

/** Atribuie seq secvențial tuturor proiectelor care nu au încă unul (apelat de pagina Proiecte; nu e o acțiune apelabilă din browser). */
export async function backfillProjectSeq(): Promise<void> {
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
