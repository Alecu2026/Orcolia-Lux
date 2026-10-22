import { getCurrentUser, isSuper } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { isCronAuthorized } from "@/lib/cron-auth";
import os from "node:os";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Cât durează o interogare (ms), sau eroarea. */
async function time<T>(fn: () => Promise<T>): Promise<number | string> {
  const t0 = Date.now();
  try {
    await fn();
    return Date.now() - t0;
  } catch (e) {
    return e instanceof Error ? e.message.slice(0, 120) : "eroare";
  }
}

/**
 * Diagnostic de viteză pentru un server propriu — doar super-admin (sau CRON_SECRET). Arată:
 *  - `eventLoopLagMs`: cât de mult e blocat procesul Node acum (mare = ceva consumă tot procesorul, iar TOATE cererile așteaptă);
 *  - latența bazei de date (ping + câteva interogări simple);
 *  - memorie, procesor, versiunea de Node.
 * Deschide `/api/diag` în browser, conectat ca super-admin; apelează-l de mai multe ori, mai ales cât se încarcă o pagină lentă.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!isSuper(user) && !isCronAuthorized(req)) return Response.json({ error: "Doar super-admin." }, { status: 403 });

  // întârzierea buclei de evenimente: dacă e blocată, setImmediate pornește târziu
  const lag = await new Promise<number>((resolve) => {
    const t0 = Date.now();
    setImmediate(() => resolve(Date.now() - t0));
  });

  const pings: (number | string)[] = [];
  for (let i = 0; i < 3; i++) pings.push(await time(() => prisma.$runCommandRaw({ ping: 1 })));
  const [clientCount, sessionCount, notifCount] = await Promise.all([
    time(() => prisma.client.count()),
    time(() => prisma.session.count()),
    time(() => prisma.notification.count()),
  ]);

  const mem = process.memoryUsage();
  const mb = (n: number) => Math.round(n / 1_048_576);
  return Response.json({
    eventLoopLagMs: lag,
    db: { pingMs: pings, clientCountMs: clientCount, sessionCountMs: sessionCount, notificationCountMs: notifCount },
    memoryMb: { rss: mb(mem.rss), heapUsed: mb(mem.heapUsed), heapTotal: mb(mem.heapTotal) },
    system: { node: process.version, cpus: os.cpus().length, loadAvg: os.loadavg().map((x) => Math.round(x * 100) / 100), freeMemMb: mb(os.freemem()), totalMemMb: mb(os.totalmem()), uptimeMin: Math.round(process.uptime() / 60) },
  });
}
