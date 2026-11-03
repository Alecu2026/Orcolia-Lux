import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { DEMO } from "@/lib/demo";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/services/audit";
import { invalidatePayers } from "@/lib/services/payer-cache";
import { openIssuesByClient } from "@/lib/services/meter-issues";
import { ISSUE_LABELS } from "@/lib/meter-issues";
import { buildPayerNoticesPdf, type PayerNotice } from "@/lib/pdf/payer-notice-pdf";
import {
  NOTIFY_MAX_EMAIL_BODY,
  NOTIFY_MAX_SUBJECT,
  NOTIFY_PDF_PART_SIZE,
  buildVars,
  renderTemplate,
  usesTokens,
} from "@/lib/payer-notify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ID_RE = /^[0-9a-f]{24}$/i;
const CAMPAIGN_RE = /^[\w-]{8,64}$/;
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

type Issue = { contor: string; kind: keyof typeof ISSUE_LABELS; dueAt: string | null };
function issueVars(list: Issue[] | undefined): { issues: string | null; issueDue: string | null } {
  if (!list || list.length === 0) return { issues: null, issueDue: null };
  const text = list.slice(0, 3).map((i) => `${ISSUE_LABELS[i.kind]} (contor ${i.contor})`).join("; ") + (list.length > 3 ? ` și încă ${list.length - 3}` : "");
  const due = list.map((i) => i.dueAt).filter((d): d is string => !!d).sort()[0] ?? null;
  return { issues: text, issueDue: due };
}

/**
 * Notificări tipărite: PDF cu câte o foaie separată pentru fiecare plătitor din `ids` (cel mult o parte de NOTIFY_PDF_PART_SIZE; clientul cere pe rând părțile).
 * Cu `preview: true` se face doar foaia primului plătitor, fără să se scrie nimic în jurnal. Altfel fiecare plătitor primește un rând în jurnalul de notificări
 * (canal PDF, o singură dată pe campanie) și „Ultima notificare” se actualizează — ca la celelalte canale.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "payers.notify")) return Response.json({ error: "Fără permisiune de a trimite notificări." }, { status: 403 });
  if (DEMO) return Response.json({ error: "Mod demo: conectează o bază de date." }, { status: 400 });

  let input: { campaignId?: unknown; part?: unknown; totalPlanned?: unknown; ids?: unknown; title?: unknown; body?: unknown; preview?: unknown };
  try {
    input = await req.json();
  } catch {
    return Response.json({ error: "Cerere invalidă." }, { status: 400 });
  }
  const preview = input.preview === true;
  const campaignId = String(input.campaignId ?? "");
  if (!CAMPAIGN_RE.test(campaignId)) return Response.json({ error: "Campanie invalidă." }, { status: 400 });
  const rawIds = Array.isArray(input.ids) ? input.ids : [];
  const ids = [...new Set(rawIds.map(String))];
  if (ids.length === 0 || ids.length > NOTIFY_PDF_PART_SIZE || ids.some((id) => !ID_RE.test(id))) return Response.json({ error: "Listă de plătitori invalidă." }, { status: 400 });
  const title = String(input.title ?? "");
  const body = String(input.body ?? "");
  if (!body.trim()) return Response.json({ error: "Scrie textul PDF-ului." }, { status: 400 });
  if (title.length > NOTIFY_MAX_SUBJECT) return Response.json({ error: `Titlul depășește ${NOTIFY_MAX_SUBJECT} de caractere.` }, { status: 400 });
  if (body.length > NOTIFY_MAX_EMAIL_BODY) return Response.json({ error: `Textul depășește ${NOTIFY_MAX_EMAIL_BODY} de caractere.` }, { status: 400 });
  const part = Math.max(0, Math.floor(Number(input.part) || 0));
  const totalPlanned = Math.max(ids.length, Math.floor(Number(input.totalPlanned) || ids.length));

  const wantIds = preview ? ids.slice(0, 1) : ids;
  const needsInvoice = usesTokens(title, body);
  const needsIssues = /\{(neregula|termen_remediere)\}/.test(`${title}\n${body}`);
  const issuesBy = needsIssues ? await openIssuesByClient(wantIds) : new Map<string, Issue[]>();

  const [clients, invoices, already, company] = await Promise.all([
    prisma.client.findMany({
      where: { id: { in: wantIds }, OR: [{ meterSeries: { not: null } }, { apaCanalContract: { not: null } }] },
      select: { id: true, name: true, meterSeries: true, apaCanalContract: true, consumAddress: true },
    }),
    needsInvoice
      ? prisma.invoice.findMany({
          where: { clientId: { in: wantIds } },
          orderBy: { issueDate: "desc" },
          select: { clientId: true, number: true, grandTotal: true, currency: true, dueDate: true, publicToken: true },
        })
      : Promise.resolve([]),
    preview
      ? Promise.resolve([])
      : prisma.payerNotificationLog.findMany({ where: { campaignId, clientId: { in: wantIds }, channel: "PDF", status: "SENT" }, select: { clientId: true } }),
    prisma.companySettings.findUnique({ where: { singleton: "main" }, select: { companyName: true } }),
  ]);

  const latestInvoice = new Map<string, (typeof invoices)[number]>();
  for (const inv of invoices) if (inv.clientId && !latestInvoice.has(inv.clientId)) latestInvoice.set(inv.clientId, inv);
  const byId = new Map(clients.map((c) => [c.id, c]));

  const notices: PayerNotice[] = [];
  const logs: { campaignId: string; clientId: string; clientName: string; channel: string; to: string; status: string; error: string | null; subject: string | null; body: string; userId: string; userName: string }[] = [];
  const alreadyLogged = new Set(already.map((a) => a.clientId));
  for (const id of wantIds) {
    const c = byId.get(id);
    if (!c) continue; // plătitor șters sau fără cont: nu are foaie
    const inv = latestInvoice.get(c.id);
    const account = c.meterSeries ?? c.apaCanalContract;
    const vars = buildVars({
      invoiceLink: inv?.publicToken ? `${env.appUrl.replace(/\/$/, "")}/invoice/public/${inv.publicToken}` : null,
      name: c.name,
      account,
      amount: inv?.grandTotal ?? null,
      currency: inv?.currency ?? null,
      invoiceNumber: inv?.number ?? null,
      dueDate: inv?.dueDate ?? null,
      address: c.consumAddress,
      ...issueVars(issuesBy.get(c.id)),
    });
    const t = oneLine(renderTemplate(title, vars));
    const text = renderTemplate(body, vars);
    notices.push({ name: c.name, account, address: c.consumAddress, title: t, text });
    if (!preview && !alreadyLogged.has(c.id)) {
      logs.push({ campaignId, clientId: c.id, clientName: c.name, channel: "PDF", to: c.consumAddress ?? "tipărit", status: "SENT", error: null, subject: t || null, body: text, userId: user.id, userName: user.name });
    }
  }
  if (notices.length === 0) return Response.json({ error: "Niciun plătitor valid în această parte." }, { status: 400 });

  const companyName = company?.companyName ?? "";
  const today = new Date().toLocaleDateString("ro-RO", { timeZone: "Europe/Bucharest", day: "2-digit", month: "2-digit", year: "numeric" });
  let pdf: Buffer;
  try {
    pdf = await buildPayerNoticesPdf({
      companyName,
      today,
      notices,
      labels: { to: "Către", account: "Cont", address: "Adresa", sheet: "Foaia", notice: "Notificare", date: "Data" },
    });
  } catch (e) {
    console.error("[notify-pdf] generare eșuată:", e);
    return Response.json({ error: "Nu am putut genera PDF-ul. Încearcă din nou." }, { status: 500 });
  }

  // Jurnalul și „Ultima notificare" se scriu DUPĂ generare; o eroare de scriere nu anulează PDF-ul (la fel ca la celelalte canale).
  if (!preview) {
    if (logs.length) await prisma.payerNotificationLog.createMany({ data: logs }).catch((e) => console.error("[notify-pdf] jurnal:", e));
    const notified = notices.length ? [...byId.keys()] : [];
    if (notified.length) {
      await prisma.client.updateMany({ where: { id: { in: notified } }, data: { lastNotifiedAt: new Date() } }).catch((e) => console.error("[notify-pdf] lastNotifiedAt:", e));
      await invalidatePayers({ soft: true });
    }
    if (part === 0) {
      await logAudit(
        { id: user.id, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin },
        {
          action: "payer.notify",
          module: "Notifications",
          objectId: campaignId,
          objectName: `Notificare plătitori (PDF tipărit) către ${totalPlanned} destinatari`,
          newValue: oneLine(title).slice(0, 120) || body.slice(0, 120),
        },
      );
    }
  }

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="notificari-${part + 1}.pdf"`,
      "Cache-Control": "no-store",
      "X-Notice-Count": String(notices.length),
    },
  });
}
