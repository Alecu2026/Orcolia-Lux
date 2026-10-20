import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { ingestPbxPayload, type PbxPayload } from "@/lib/services/pbx";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY = 64 * 1024;

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Corpul poate fi JSON (obiect sau listă de obiecte) sau formular (application/x-www-form-urlencoded). */
async function readPayloads(req: Request): Promise<PbxPayload[]> {
  const raw = await req.text();
  if (raw.length > MAX_BODY) throw new Error("too-large");
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/x-www-form-urlencoded")) {
    return [Object.fromEntries(new URLSearchParams(raw).entries())];
  }
  const j = JSON.parse(raw) as unknown;
  const list = Array.isArray(j) ? j : [j];
  return list.filter((x): x is PbxPayload => !!x && typeof x === "object" && !Array.isArray(x));
}

/**
 * Webhook PBX Moldcell: primește mesajele despre apeluri (mai multe pe apel, același `callid`) și le salvează.
 * Autentificare: câmpul `crm_token` din mesaj (sau antetul `x-crm-token` / `?token=`) trebuie să fie egal cu
 * variabila de mediu PBX_CRM_TOKEN. Fără token configurat, ruta refuză tot (altfel oricine ar putea scrie apeluri false).
 */
export async function POST(req: Request) {
  const expected = env.pbx.crmToken;
  if (!expected) {
    console.error("[pbx] PBX_CRM_TOKEN nu este setat — webhook-ul refuză mesajele.");
    return Response.json({ ok: false, error: "PBX neconfigurat." }, { status: 503 });
  }

  let payloads: PbxPayload[];
  try {
    payloads = await readPayloads(req);
  } catch (e) {
    const tooLarge = e instanceof Error && e.message === "too-large";
    return Response.json({ ok: false, error: tooLarge ? "Mesaj prea mare." : "Corp invalid." }, { status: tooLarge ? 413 : 400 });
  }
  if (payloads.length === 0 || payloads.length > 50) return Response.json({ ok: false, error: "Corp invalid." }, { status: 400 });

  const url = new URL(req.url);
  const fromHeader = req.headers.get("x-crm-token") ?? url.searchParams.get("token") ?? "";
  const stored: string[] = [];
  let contactName: string | null = null;
  for (const p of payloads) {
    const token = String(p.crm_token ?? fromHeader ?? "");
    if (!token || !safeEqual(token, expected)) return Response.json({ ok: false, error: "Token invalid." }, { status: 401 });
    try {
      // tokenul nu se păstrează în baza de date
      const { crm_token: _t, ...clean } = p;
      void _t;
      const { callId } = await ingestPbxPayload(clean);
      stored.push(callId);
      // Mesajul „contact" cere datele apelantului: dacă îl cunoaștem, îi întoarcem numele (câmpurile sunt cele uzuale în CRM-urile PBX).
      if (clean.cmd === "contact") {
        const call = await prisma.pbxCall.findUnique({ where: { callId }, select: { clientName: true } });
        contactName = call?.clientName ?? null;
      }
    } catch (e) {
      console.error("[pbx] salvare eșuată:", e);
      return Response.json({ ok: false, error: "Eroare la salvare." }, { status: 500 });
    }
  }
  // Conform specificației Moldcell (CRM REST API, 2.3): la `contact` răspunsul e { contact_name, responsible } — numele îl dăm doar dacă
  // îl știm; `responsible` NU îl trimitem (ar muta apelul automat la acel operator, dacă funcția e activă în PBX).
  if (payloads.length === 1 && payloads[0].cmd === "contact") {
    return Response.json(contactName ? { contact_name: contactName } : {});
  }
  return Response.json({ ok: true, received: stored.length });
}
