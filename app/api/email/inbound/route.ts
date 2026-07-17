import { NextRequest, NextResponse } from "next/server";
import { processInboundEmail } from "@/lib/services/email-ticket";
import { detectSpam } from "@/lib/spam-filter";
import { isRateLimited } from "@/lib/rate-limit";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Suportă Mailgun (form), SendGrid (JSON array), Postmark (JSON object)
async function parseEmailFromRequest(req: NextRequest) {
  const ct = req.headers.get("content-type") || "";

  if (ct.includes("application/json")) {
    const body = await req.json();
    // SendGrid wraps in array
    const msg = Array.isArray(body) ? body[0] : body;
    return {
      fromEmail: extractEmail(msg.from ?? msg.From ?? ""),
      fromName: extractName(msg.from ?? msg.From ?? ""),
      subject: msg.subject ?? msg.Subject ?? "",
      bodyText: msg.text ?? msg.TextBody ?? "",
      bodyHtml: msg.html ?? msg.HtmlBody ?? "",
      messageId: cleanId(msg["message-id"] ?? msg.MessageID ?? ""),
      inReplyTo: cleanId(msg["in-reply-to"] ?? msg.InReplyTo ?? ""),
      references: msg.references ?? msg.References ?? "",
    };
  }

  // Mailgun multipart/form-data
  const formData = await req.formData();
  const from = formData.get("from")?.toString() ?? "";
  return {
    fromEmail: extractEmail(from),
    fromName: extractName(from),
    subject: formData.get("subject")?.toString() ?? "",
    bodyText: formData.get("body-plain")?.toString() ?? "",
    bodyHtml: formData.get("body-html")?.toString() ?? "",
    messageId: cleanId(formData.get("Message-Id")?.toString() ?? ""),
    inReplyTo: cleanId(formData.get("In-Reply-To")?.toString() ?? ""),
    references: formData.get("References")?.toString() ?? "",
  };
}

function extractEmail(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

function extractName(from: string): string {
  const m = from.match(/^(.+?)\s*</);
  return m ? m[1].replace(/^["']|["']$/g, "").trim() : "";
}

function cleanId(id: string): string {
  return id.replace(/^<|>$/g, "").trim();
}

export async function POST(req: NextRequest) {
  // Verificare secret (header X-Email-Secret sau query param secret)
  const secret = req.headers.get("x-email-secret") ?? req.nextUrl.searchParams.get("secret") ?? "";
  if (env.emailInboundSecret && secret !== env.emailInboundSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let email: Awaited<ReturnType<typeof parseEmailFromRequest>>;
  try {
    email = await parseEmailFromRequest(req);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (!email.fromEmail) {
    return NextResponse.json({ error: "No sender" }, { status: 400 });
  }

  // Rate limiting: max 10 emails per hour per sender
  if (isRateLimited(email.fromEmail, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  // Spam filter
  const spamReason = detectSpam(email.fromEmail, email.subject, email.bodyText);
  if (spamReason) {
    console.log(`[email-inbound] spam blocat: ${email.fromEmail} — ${spamReason}`);
    return NextResponse.json({ ok: true, skipped: "spam" });
  }

  try {
    const result = await processInboundEmail(email);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[email-inbound]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
