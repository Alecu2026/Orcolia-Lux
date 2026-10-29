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

/**
 * Prima variabilă găsită dintre `names`, indiferent de litere mari/mici (SMS_HTTP_TOKEN, sms_token, Sms_Token…):
 * întâi potrivire exactă, apoi fără să țină cont de majuscule. Pe Vercel numele sunt sensibile la litere, iar unii le scriu cu mici.
 */
function anyEnv(...names: string[]): string {
  for (const n of names) {
    const v = process.env[n]?.trim();
    if (v) return v;
  }
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  for (const [k, v] of Object.entries(process.env)) {
    if (v?.trim() && wanted.has(k.toLowerCase())) return v.trim();
  }
  return "";
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
  // Adresa la care serverul se poate apela pe el însuși (ex. http://127.0.0.1:3000), pentru generarea PDF-ului de factură. Pe un server
  // propriu, adresa publică nu e mereu accesibilă din interior (NAT/firewall). Dacă lipsește, se folosește NEXT_PUBLIC_APP_URL.
  internalAppUrl: optional("INTERNAL_APP_URL"),

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

  // SMS: Twilio (TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + SMS_FROM) sau orice gateway HTTP propriu
  // (SMS_HTTP_URL [+ SMS_HTTP_TOKEN]) care primește POST JSON { to, message, from } — vezi lib/sms.ts.
  sms: {
    from: optional("SMS_FROM"),
    twilioSid: optional("TWILIO_ACCOUNT_SID"),
    twilioToken: optional("TWILIO_AUTH_TOKEN"),
    // Numele acceptate (mari sau mici): SMS_HTTP_URL / SMS_URL și SMS_HTTP_TOKEN / SMS_TOKEN (adică și `sms_token`).
    httpUrl: anyEnv("SMS_HTTP_URL", "SMS_URL"),
    httpToken: anyEnv("SMS_HTTP_TOKEN", "SMS_TOKEN"),
    /** "accahul" = gateway-ul ACC Cahul (POST { smsid, nr_tel, content, sms_token }); gol = detectat după domeniu, altfel formatul generic. */
    httpFormat: optional("SMS_HTTP_FORMAT"),
    get provider(): "twilio" | "http" | null {
      if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.SMS_FROM) return "twilio";
      if (anyEnv("SMS_HTTP_URL", "SMS_URL")) return "http";
      return null;
    },
    get enabled() {
      return this.provider !== null;
    },
  },

  // Apeluri de notificare (robot) prin gateway-ul propriu, pe același server ca SMS-urile (ex. https://node.dns.accahul.md/call):
  // POST JSON { smsid, nr_tel, content, sms_token } — vezi lib/call-gateway.ts. Adresa: CALL_HTTP_URL (sau CALL_URL); dacă lipsește și
  // SMS_HTTP_URL e pe accahul.md, se folosește același server cu /call. Tokenul: CALL_HTTP_TOKEN / CALL_TOKEN, altfel cel de SMS.
  voice: {
    get url(): string {
      const own = anyEnv("CALL_HTTP_URL", "CALL_URL");
      if (own) return own;
      try {
        const sms = new URL(anyEnv("SMS_HTTP_URL", "SMS_URL"));
        return /(^|\.)accahul\.md$/i.test(sms.hostname) ? `${sms.origin}/call` : "";
      } catch {
        return "";
      }
    },
    get token(): string {
      return anyEnv("CALL_HTTP_TOKEN", "CALL_TOKEN") || anyEnv("SMS_HTTP_TOKEN", "SMS_TOKEN");
    },
    get enabled(): boolean {
      return Boolean(this.url && this.token);
    },
  },

  // PBX Moldcell: webhook-ul /api/pbx acceptă doar mesaje cu acest token (câmpul crm_token din integrarea CRM a PBX-ului).
  pbx: {
    // Numele variabilei: CRM_TOKEN (sau crm_token, ca în mesajele Moldcell); PBX_CRM_TOKEN rămâne acceptat pentru compatibilitate.
    // Cheia de autorizare spre PBX („Key for authorization in the PBX"), pentru redarea înregistrărilor dacă PBX-ul o cere.
    apiKey: anyEnv("PBX_API_KEY"),
    // Adresa API-ului CRM al PBX-ului tău (PBX_API_URL); implicit PBX-ul Orcolia-Lux.
    apiUrl: anyEnv("PBX_API_URL") || "https://orcolialux.pbx.moldcell.md/crmapi/v1",
    // Operatorul (login sau număr scurt) care primește apelul implicit la „Sună" — se poate schimba din pagină.
    callUser: anyEnv("PBX_CALL_USER"),
    crmToken: anyEnv("CRM_TOKEN", "PBX_CRM_TOKEN"),
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

  // Fișierele (poze, atașamente) se salvează pe discul serverului, în UPLOAD_DIR (vezi lib/storage.ts).
  storage: {
    dir: optional("UPLOAD_DIR"),
    enabled: true,
  },

  isProd: process.env.NODE_ENV === "production",

  // Aplicația e „activă" doar când are baza de date și secretul de sesiune.
  // Cât timp lipsesc, afișăm un ecran de configurare în loc de erori.
  get isConfigured() {
    return Boolean(process.env.DATABASE_URL && process.env.SESSION_SECRET);
  },
};
