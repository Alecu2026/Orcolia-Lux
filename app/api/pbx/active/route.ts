import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { DEMO } from "@/lib/demo";
import { getCallerContext } from "@/lib/services/pbx";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

const LIVE_MS = 3 * 60_000; // un apel fără „history" e considerat în curs cel mult 3 minute de la ultimul mesaj
const ENDED_MS = 25_000; // după încheiere, cardul mai rămâne câteva secunde (apoi dispare singur)

/**
 * Apelurile în curs (sau abia încheiate), cu datele curente ale apelantului — pentru popup-ul „Apel primit" din aplicație.
 * Aplicația îl interoghează la câteva secunde; interogarea e ieftină (un index pe updatedAt).
 */
// Lista apelurilor e aceeași pentru toți utilizatorii: o calculăm o dată la ~2 s și o împărțim (cererile simultane o așteaptă pe aceeași),
// ca interogările din baza de date să nu crească odată cu numărul de utilizatori și file deschise.
let shared: { at: number; calls: unknown[] } | null = null;
let sharedInflight: Promise<unknown[]> | null = null;
const SHARE_MS = 2_000;

async function liveCalls(): Promise<unknown[]> {
  if (shared && Date.now() - shared.at < SHARE_MS) return shared.calls;
  if (!sharedInflight) {
    sharedInflight = computeCalls()
      .then((calls) => {
        shared = { at: Date.now(), calls };
        return calls;
      })
      .finally(() => {
        sharedInflight = null;
      });
  }
  return sharedInflight;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "pbx.view")) return Response.json({ calls: [] });
  if (DEMO) return Response.json({ calls: [] });
  return Response.json({ calls: await liveCalls() });
}

async function computeCalls() {
  const now = Date.now();
  const rows = await prisma.pbxCall.findMany({
    where: { updatedAt: { gte: new Date(now - LIVE_MS) } },
    take: 10,
    select: {
      callId: true, direction: true, phone: true, phoneE164: true, diversion: true, pbxUser: true, ext: true,
      status: true, state: true, durationSec: true, startAt: true, firstSeenAt: true, updatedAt: true,
      clientId: true, clientName: true, note: true,
    },
  });

  const calls = [];
  for (const c of rows) {
    const finished = !!c.status || c.state === "COMPLETED" || c.state === "CANCELLED";
    // finalizat → doar câteva secunde; în curs → cât mai sosesc mesaje
    if (finished && now - c.updatedAt.getTime() > ENDED_MS) continue;
    if (c.direction === "out" && !c.state && !c.status) continue;
    const context = c.clientId ? await getCallerContext(c.clientId) : null;
    calls.push({
      callId: c.callId,
      direction: c.direction,
      phone: c.phone,
      diversion: c.diversion,
      operator: c.pbxUser,
      ext: c.ext,
      status: c.status,
      state: c.state,
      finished,
      at: (c.startAt ?? c.firstSeenAt).toISOString(),
      note: c.note,
      context,
    });
  }
  calls.sort((a, b) => (a.at < b.at ? 1 : -1));
  return calls;
}
