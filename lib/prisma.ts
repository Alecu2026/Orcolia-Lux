import "server-only";
import { PrismaClient } from "@prisma/client";
import { bumpTaskEpoch } from "./task-epoch";
import { clearStaffSessionCache } from "./staff-session-cache";

const WRITE_OPS = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany"]);

/**
 * Singleton Prisma — evită epuizarea conexiunilor în dev (HMR re-execută modulele).
 */
function createClient() {
  const base = new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });

  // Plasă de siguranță, la nivel de client (nu doar în acțiunea de bootstrap): indiferent
  // pe ce cale ajunge să fie creat contul — pagina de înregistrare, un script, o cale nouă
  // adăugată ulterior — dacă e PRIMUL utilizator din tot sistemul, devine automat ADMIN +
  // super-admin. Altfel, un prim cont creat pe o cale la care nu ne-am gândit ar rămâne STAFF
  // fără super-admin, fără nicio cale de auto-recuperare din interiorul aplicației.
  return base.$extends({
    query: {
      // Orice scriere în Task marchează lista completă din memorie ca depășită (vezi lib/task-epoch.ts).
      task: {
        async $allOperations({ operation, args, query }) {
          const result = await query(args);
          if (WRITE_OPS.has(operation)) bumpTaskEpoch();
          return result;
        },
      },
      user: {
        async $allOperations({ operation, args, query }) {
          if (operation === "create") {
            const count = await base.user.count();
            if (count === 0) {
              (args as { data: object }).data = { ...(args as { data: object }).data, role: "ADMIN", isSuperAdmin: true };
            }
          }
          const result = await query(args);
          // sesiunea personalului ține minte utilizatorul (lib/staff-session-cache.ts): orice scriere — permisiuni, echipe, dezactivare, parolă, ștergere — o invalidează
          if (WRITE_OPS.has(operation)) clearStaffSessionCache();
          return result;
        },
      },
      session: {
        async $allOperations({ operation, args, query }) {
          const result = await query(args);
          if (WRITE_OPS.has(operation)) clearStaffSessionCache(); // deconectare, expirare, sesiune nouă, parolă schimbată
          return result;
        },
      },
    },
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createClient> | undefined;
};

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
