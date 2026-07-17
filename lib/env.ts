import "server-only";

/**
 * Validare centralizată a variabilelor de mediu.
 * Cele critice (DB, sesiune) sunt obligatorii; integrările (Telegram, SMTP, AI)
 * sunt opționale și se activează doar când sunt configurate.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Lipsește variabila de mediu obligatorie: ${name}`);
  }
  return v;
}

function optional(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  // Lazy: validate doar la accesare (nu la import) ca build-ul fără env să nu pice.
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get sessionSecret() {
    return required("SESSION_SECRET");
  },

  sessionCookieName: optional("SESSION_COOKIE_NAME", "pr_session"),
  sessionTtlDays: int("SESSION_TTL_DAYS", 180),

  appUrl: optional("NEXT_PUBLIC_APP_URL", "http://localhost:3000"),

  telegram: {
    botToken: optional("TELEGRAM_BOT_TOKEN"),
    webhookSecret: optional("TELEGRAM_WEBHOOK_SECRET"),
    get enabled() {
      return Boolean(process.env.TELEGRAM_BOT_TOKEN);
    },
  },

  cronSecret: optional("CRON_SECRET"),
  emailInboundSecret: optional("EMAIL_INBOUND_SECRET"),

  smtp: {
    host: optional("SMTP_HOST"),
    port: int("SMTP_PORT", 587),
    secure: optional("SMTP_SECURE", "false") === "true",
    user: optional("SMTP_USER"),
    pass: optional("SMTP_PASS"),
    from: optional("EMAIL_FROM", "Programări <no-reply@example.com>"),
    get enabled() {
      return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);
    },
  },

  imap: {
    host: optional("IMAP_HOST"),
    port: int("IMAP_PORT", 993),
    secure: optional("IMAP_SECURE", "true") === "true",
    user: optional("IMAP_USER"),
    pass: optional("IMAP_PASS"),
    mailbox: optional("IMAP_MAILBOX", "INBOX"),
    get enabled() {
      return Boolean(process.env.IMAP_HOST && process.env.IMAP_USER);
    },
  },

  ai: {
    openaiApiKey: optional("OPENAI_API_KEY"),
    transcribeModel: optional("AI_TRANSCRIBE_MODEL", "whisper-1"),
    parseModel: optional("AI_PARSE_MODEL", "gpt-4o-mini"),
    get enabled() {
      return Boolean(process.env.OPENAI_API_KEY);
    },
  },

  vapid: {
    publicKey: optional("NEXT_PUBLIC_VAPID_PUBLIC_KEY"),
    privateKey: optional("VAPID_PRIVATE_KEY"),
    subject: optional("VAPID_SUBJECT", "mailto:admin@example.com"),
    get enabled() {
      return Boolean(
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY,
      );
    },
  },

  blob: {
    token: optional("BLOB_READ_WRITE_TOKEN"),
    get enabled() {
      return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
    },
  },

  isProd: process.env.NODE_ENV === "production",

  // Aplicația e „activă" doar când are baza de date și secretul de sesiune.
  // Cât timp lipsesc, afișăm un ecran de configurare în loc de erori.
  get isConfigured() {
    return Boolean(process.env.DATABASE_URL && process.env.SESSION_SECRET);
  },
};
