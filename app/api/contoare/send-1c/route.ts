import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { pullFromOneC } from "@/lib/services/onec-pull";
import { listSendLogs, pingOneC, previewSend, sendReadings } from "@/lib/services/onec-readings";

export const dynamic = "force-dynamic";
// Extragere din 1C (~1–2 min) sau o rundă de trimitere (cel mult ~230 s + o cerere în curs): fiecare e o cerere separată.
export const maxDuration = 300;

/**
 * „Trimite către 1C” din Citiri teren (necesită „Export contoare și citiri teren”). Fiecare pas e o cerere separată (ca să încapă în limita de timp):
 *  - `{ mode: "preview" }` → ce s-ar trimite acum (numere pe surse, câteva documente ca exemplu); nu trimite nimic;
 *  - `{ mode: "ping" }`    → test de conexiune (listă goală: nu creează nimic în 1C);
 *  - `{ mode: "log" }`     → ultimele rulări din jurnal (pentru depanare);
 *  - `{ mode: "pull" }`    → extrage întâi din 1C (contoare, abonați, facturi) și pune datele la zi;
 *  - `{ mode: "send", exclude?: string[], first?: boolean, resend?: boolean, since?: string }` → trimite citirile în loturi (`resend` = și cele deja trimise; `since` = `since` primit în prima rundă); `remaining` > 0 = repetă cererea (cu `exclude` = `failedReadingIds` primite până acum), `aborted` = oprește.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "meters.export")) return Response.json({ error: "Fără permisiune." }, { status: 403 });

  let body: { mode?: string; exclude?: unknown; first?: unknown; resend?: unknown; since?: unknown; session?: unknown; meterIds?: unknown; periods?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* corp lipsă */
  }
  const actor = { id: user.id, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin };
  // ca la export: doar contoarele (și luna) din lista filtrată din pagină; fără ele = toate citirile
  const scope = Array.isArray(body.meterIds)
    ? {
        meterIds: body.meterIds.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 300).slice(0, 60_000),
        periods: Array.isArray(body.periods) ? body.periods.filter((x): x is string => typeof x === "string" && /^\d{4}-\d{2}$/.test(x)).slice(0, 3) : [],
      }
    : null;

  try {
    if (body.mode === "pull") return Response.json(await pullFromOneC(actor));
    if (body.mode === "ping") return Response.json(await pingOneC());
    if (body.mode === "log") return Response.json({ logs: await listSendLogs(15) });
    if (body.mode === "send") {
      const exclude = Array.isArray(body.exclude) ? body.exclude.filter((x): x is string => typeof x === "string" && /^[0-9a-f]{24}$/i.test(x)).slice(0, 50_000) : [];
      const since = typeof body.since === "string" && Number.isFinite(Date.parse(body.since)) ? body.since : null;
      return Response.json(await sendReadings(actor, { exclude, first: body.first !== false, resend: body.resend === true, since, session: typeof body.session === "string" ? body.session : null, scope }));
    }
    return Response.json(await previewSend(body.resend === true, scope));
  } catch (e) {
    console.error("[send-1c] eșuat:", e);
    return Response.json({ error: e instanceof Error ? e.message : "Eroare necunoscută." }, { status: 500 });
  }
}
