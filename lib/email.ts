import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";

let cached: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.smtp.enabled) return null;
  if (!cached) {
    cached = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: { user: env.smtp.user, pass: env.smtp.pass },
    });
  }
  return cached;
}

export type ReminderEmailData = {
  to: string;
  clientName: string;
  service: string;
  date: string;
  time: string;
  fromName?: string | null;
  fromAddr?: string | null;
};

function template(d: ReminderEmailData): string {
  return `<!doctype html>
<html lang="ro"><body style="margin:0;background:#f5f6f8;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:480px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
        <tr><td style="background:#0d9488;padding:20px 24px;color:#fff;font-size:18px;font-weight:700">
          Reminder programare
        </td></tr>
        <tr><td style="padding:24px">
          <p style="margin:0 0 14px;font-size:16px">Bună, <b>${d.clientName}</b>.</p>
          <p style="margin:0 0 18px;font-size:15px;line-height:1.5">
            Ai programare la <b>${d.service}</b> pe <b>${d.date}</b> la <b>${d.time}</b>.
          </p>
          <div style="background:#ccfbf1;border-radius:12px;padding:14px 16px;margin-bottom:18px">
            <div style="font-size:13px;color:#0f766e">📅 ${d.date} &nbsp; 🕐 ${d.time}</div>
          </div>
          <p style="margin:0;font-size:14px;color:#475569">
            Te rugăm să confirmi dacă poți ajunge.
          </p>
        </td></tr>
        <tr><td style="padding:14px 24px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8">
          Mesaj automat — te rugăm să nu răspunzi.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export type TaskReminderEmailData = {
  to: string;
  userName: string;
  taskTitle: string;
  seq: number | null | undefined;
  taskUrl: string;
  isOverdue?: boolean;
};

function taskReminderTemplate(d: TaskReminderEmailData): string {
  const badge = d.isOverdue
    ? `<div style="background:#fee2e2;border-radius:8px;padding:10px 14px;margin-bottom:16px;color:#991b1b;font-weight:600">⏰ Task în întârziere</div>`
    : `<div style="background:#ede9fe;border-radius:8px;padding:10px 14px;margin-bottom:16px;color:#5b21b6;font-weight:600">🔔 Reamintire task</div>`;
  const ref = d.seq != null ? ` <span style="color:#6366f1">#${d.seq}</span>` : "";
  return `<!doctype html>
<html lang="ro"><body style="margin:0;background:#f5f6f8;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:480px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
        <tr><td style="background:#6366f1;padding:20px 24px;color:#fff;font-size:18px;font-weight:700">
          Stefan CRM
        </td></tr>
        <tr><td style="padding:24px">
          <p style="margin:0 0 14px;font-size:16px">Bună, <b>${d.userName}</b>.</p>
          ${badge}
          <p style="margin:0 0 18px;font-size:15px;line-height:1.5">
            Task-ul <b>${d.taskTitle}</b>${ref} necesită atenția ta.
          </p>
          <a href="${d.taskUrl}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">
            Deschide task
          </a>
        </td></tr>
        <tr><td style="padding:14px 24px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8">
          Mesaj automat — te rugăm să nu răspunzi.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export async function sendTaskReminderEmail(d: TaskReminderEmailData): Promise<void> {
  const transporter = getTransporter();
  if (!transporter) throw new Error("SMTP neconfigurat.");
  const from = env.smtp.from;
  const subject = d.isOverdue ? `⏰ Task în întârziere: ${d.taskTitle}` : `🔔 Reamintire task: ${d.taskTitle}`;
  await transporter.sendMail({
    from,
    to: d.to,
    subject,
    text: `Bună, ${d.userName}. Task-ul „${d.taskTitle}"${d.seq != null ? ` (#${d.seq})` : ""} necesită atenția ta. ${d.taskUrl}`,
    html: taskReminderTemplate(d),
  });
}

export type InvoiceEmailData = {
  to: string;
  clientName: string;
  invoiceNumber: string;
  grandTotal: number;
  currency: string;
  dueDate: Date | null;
  publicUrl: string;
  companyName?: string | null;
  fromName?: string | null;
  fromAddr?: string | null;
};

function invoiceTemplate(d: InvoiceEmailData): string {
  const fmt = (n: number) =>
    n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dueLine = d.dueDate
    ? `<p style="margin:0 0 8px;font-size:14px;color:#475569">Scadență: <b>${d.dueDate.toLocaleDateString("ro-RO")}</b></p>`
    : "";
  const company = d.companyName ? `<b>${d.companyName}</b>` : "furnizorul dumneavoastră";
  return `<!doctype html>
<html lang="ro"><body style="margin:0;background:#f5f6f8;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
        <tr><td style="background:#6366f1;padding:20px 28px;color:#fff;font-size:19px;font-weight:700">
          🧾 Factură nouă
        </td></tr>
        <tr><td style="padding:28px">
          <p style="margin:0 0 16px;font-size:16px">Bună, <b>${d.clientName}</b>.</p>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.6">
            ${company} v-a emis o factură nouă.
          </p>
          <div style="background:#f1f5f9;border-radius:12px;padding:18px 20px;margin-bottom:24px">
            <p style="margin:0 0 8px;font-size:14px;color:#475569">Nr. factură: <b>${d.invoiceNumber}</b></p>
            ${dueLine}
            <p style="margin:0;font-size:18px;font-weight:700;color:#0f172a">
              Total: ${fmt(d.grandTotal)} ${d.currency}
            </p>
          </div>
          <a href="${d.publicUrl}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:13px 24px;border-radius:10px;font-weight:600;font-size:15px">
            Vizualizează factura
          </a>
        </td></tr>
        <tr><td style="padding:14px 28px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8">
          Mesaj automat — te rugăm să nu răspunzi la acest email.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export async function sendInvoiceEmail(d: InvoiceEmailData): Promise<void> {
  const transporter = getTransporter();
  if (!transporter) throw new Error("SMTP neconfigurat.");
  const from =
    d.fromName && d.fromAddr ? `${d.fromName} <${d.fromAddr}>` : env.smtp.from;
  const subject = d.companyName
    ? `Factură ${d.invoiceNumber} — ${d.companyName}`
    : `Factură ${d.invoiceNumber}`;
  await transporter.sendMail({
    from,
    to: d.to,
    subject,
    text: `Bună, ${d.clientName}. Aveți o factură nouă (${d.invoiceNumber}) în valoare de ${d.grandTotal} ${d.currency}. Vizualizați: ${d.publicUrl}`,
    html: invoiceTemplate(d),
  });
}

export type VerificationCodeEmailData = {
  to: string;
  name: string;
  code: string;
  purpose: "PASSWORD_CHANGE" | "PASSWORD_RESET";
};

function verificationCodeTemplate(d: VerificationCodeEmailData): string {
  const title = d.purpose === "PASSWORD_RESET" ? "Resetare parolă" : "Schimbare parolă";
  const desc =
    d.purpose === "PASSWORD_RESET"
      ? "Ai cerut resetarea parolei contului tău. Folosește codul de mai jos pentru a continua."
      : "Ai cerut schimbarea parolei contului tău. Folosește codul de mai jos pentru a confirma.";
  return `<!doctype html>
<html lang="ro"><body style="margin:0;background:#f5f6f8;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:480px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
        <tr><td style="background:#0d9488;padding:20px 24px;color:#fff;font-size:18px;font-weight:700">
          🔐 ${title}
        </td></tr>
        <tr><td style="padding:28px">
          <p style="margin:0 0 16px;font-size:16px">Bună, <b>${d.name}</b>.</p>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.6">${desc}</p>
          <div style="background:#f1f5f9;border-radius:12px;padding:20px;margin-bottom:20px;text-align:center">
            <span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#0f766e">${d.code}</span>
          </div>
          <p style="margin:0;font-size:13px;color:#64748b">Codul expiră în 15 minute. Dacă nu ai cerut tu această acțiune, ignoră acest email.</p>
        </td></tr>
        <tr><td style="padding:14px 24px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8">
          Mesaj automat — te rugăm să nu răspunzi.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export async function sendVerificationCodeEmail(d: VerificationCodeEmailData): Promise<void> {
  const transporter = getTransporter();
  if (!transporter) throw new Error("SMTP neconfigurat.");
  const subject = d.purpose === "PASSWORD_RESET" ? "Codul tău de resetare parolă" : "Codul tău de schimbare parolă";
  await transporter.sendMail({
    from: env.smtp.from,
    to: d.to,
    subject,
    text: `Bună, ${d.name}. Codul tău este: ${d.code} (expiră în 15 minute).`,
    html: verificationCodeTemplate(d),
  });
}

/** Trimite reminder-ul. Aruncă eroare la eșec (pentru logica de retry). */
export async function sendReminderEmail(d: ReminderEmailData): Promise<void> {
  const transporter = getTransporter();
  if (!transporter) throw new Error("SMTP neconfigurat.");

  const from =
    d.fromName && d.fromAddr
      ? `${d.fromName} <${d.fromAddr}>`
      : env.smtp.from;

  await transporter.sendMail({
    from,
    to: d.to,
    subject: "Reminder programare",
    text: `Bună, ${d.clientName}. Ai programare la ${d.service} pe ${d.date} la ${d.time}. Te rugăm să confirmi dacă poți ajunge.`,
    html: template(d),
  });
}
