import "server-only";
import { createHmac } from "node:crypto";
import { env } from "./env";
import { deliveryErrorText, logDelivery } from "./delivery-log";

const BASE = () => `https://api.telegram.org/bot${env.telegram.botToken}`;

export type InlineButton =
  | { text: string; callback_data: string }
  | { text: string; url: string };

/** Buton URL care deschide task-ul direct în PWA. */
export function taskOpenButton(seq: number | null | undefined, taskId: string): InlineButton[][] {
  const label = seq != null ? `🔗 Deschide sarcină #${seq}` : "🔗 Deschide sarcină";
  return [[{ text: label, url: `${env.appUrl}/tasks/${taskId}` }]];
}

/** Metodele care trimit un mesaj nou (celelalte — editare, ștergere, răspuns la buton — nu intră în jurnal). */
const LOGGED_METHODS = new Set(["sendMessage", "sendPhoto", "sendDocument"]);

/** Din butoanele mesajului (link spre /tasks/<id>) aflăm despre ce sarcină / tichet e vorba. */
function objectFromKeyboard(body: Record<string, unknown>): { objectType: string; objectId: string } | null {
  const rows = (body.reply_markup as { inline_keyboard?: { url?: string }[][] } | undefined)?.inline_keyboard;
  for (const row of rows ?? []) for (const b of row) {
    const m = b.url ? /\/(tasks|tickets)\/([0-9a-f]{24})/i.exec(b.url) : null;
    if (m) return { objectType: m[1] === "tickets" ? "ticket" : "task", objectId: m[2] };
  }
  return null;
}

async function tgLog(method: string, body: Record<string, unknown>, status: "SENT" | "FAILED" | "SKIPPED", extra: { error?: string; providerId?: string; durationMs: number }) {
  if (!LOGGED_METHODS.has(method)) return;
  const chat = String(body.chat_id ?? "");
  const text = String(body.text ?? body.caption ?? "");
  const firstLine = text.replace(/<[^>]+>/g, "").split("\n").find((l) => l.trim())?.trim().slice(0, 200) ?? null;
  const who = await telegramRecipient(chat);
  await logDelivery({
    channel: "TELEGRAM",
    status,
    to: chat,
    toUserId: who?.userId ?? null,
    toName: who?.name ?? null,
    subject: method === "sendMessage" ? firstLine : `[${method === "sendPhoto" ? "poză" : "document"}] ${firstLine ?? ""}`.trim(),
    body: text || (typeof body.photo === "string" ? String(body.photo) : typeof body.document === "string" ? String(body.document) : null),
    ...objectFromKeyboard(body),
    ...extra,
  });
}

const chatCache = new Map<string, { at: number; v: { userId: string | null; name: string | null } | null }>();
/** Cui aparține un chat Telegram (cont legat → utilizator); ținut 2 minute în memorie, ca jurnalul să nu încarce baza de date. */
async function telegramRecipient(chatId: string): Promise<{ userId: string | null; name: string | null } | null> {
  const hit = chatCache.get(chatId);
  if (hit && Date.now() - hit.at < 120_000) return hit.v;
  let v: { userId: string | null; name: string | null } | null = null;
  try {
    const { prisma } = await import("./prisma");
    const acc = await prisma.telegramAccount.findFirst({ where: { chatId }, select: { userId: true, firstName: true, lastName: true, username: true, user: { select: { name: true } } } });
    if (acc) v = { userId: acc.userId, name: acc.user?.name ?? ([acc.firstName, acc.lastName].filter(Boolean).join(" ") || (acc.username ? `@${acc.username}` : null)) };
    // chat setat manual de administrator la utilizator (fără cont legat prin bot)
    if (!v?.userId) {
      const u = await prisma.user.findFirst({ where: { telegramChatId: chatId }, select: { id: true, name: true } });
      if (u) v = { userId: u.id, name: u.name };
    }
  } catch {}
  if (chatCache.size > 500) chatCache.clear();
  chatCache.set(chatId, { at: Date.now(), v });
  return v;
}

async function tgCall<T = unknown>(
  method: string,
  body: Record<string, unknown>,
): Promise<T | null> {
  const t0 = Date.now();
  if (!env.telegram.botToken) {
    console.error(`[telegram] ${method} omis: TELEGRAM_BOT_TOKEN nu este configurat`);
    await tgLog(method, body, "SKIPPED", { error: "TELEGRAM_BOT_TOKEN nu este configurat.", durationMs: 0 });
    return null;
  }
  try {
    const res = await fetch(`${BASE()}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data?.ok) {
      console.error(`[telegram] ${method} a răspuns cu eroare:`, data?.description ?? data);
      await tgLog(method, body, "FAILED", { error: String(data?.description ?? `HTTP ${res.status}`), durationMs: Date.now() - t0 });
      return null;
    }
    const mid = (data.result as { message_id?: number } | undefined)?.message_id;
    await tgLog(method, body, "SENT", { providerId: mid != null ? String(mid) : undefined, durationMs: Date.now() - t0 });
    return data.result as T;
  } catch (e) {
    console.error(`[telegram] ${method} request eșuat:`, e);
    await tgLog(method, body, "FAILED", { error: deliveryErrorText(e), durationMs: Date.now() - t0 });
    return null;
  }
}

export function sendMessage(
  chatId: string | number,
  text: string,
  keyboard?: InlineButton[][],
) {
  return tgCall("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
    disable_web_page_preview: true,
  });
}

export function sendPhoto(
  chatId: string | number,
  photoUrl: string,
  caption?: string,
  keyboard?: InlineButton[][],
) {
  return tgCall("sendPhoto", {
    chat_id: chatId,
    photo: photoUrl,
    caption,
    parse_mode: "HTML",
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
  });
}

export function sendDocument(
  chatId: string | number,
  documentUrl: string,
  caption?: string,
  keyboard?: InlineButton[][],
) {
  return tgCall("sendDocument", {
    chat_id: chatId,
    document: documentUrl,
    caption,
    parse_mode: "HTML",
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
  });
}

export function editMessageText(
  chatId: string | number,
  messageId: number,
  text: string,
  keyboard?: InlineButton[][],
) {
  return tgCall("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
  });
}

export function deleteMessage(chatId: string | number, messageId: number) {
  return tgCall("deleteMessage", { chat_id: chatId, message_id: messageId });
}

/** Răspuns instant la callback (ca botul să nu pară lent). */
export function answerCallback(callbackId: string, text?: string) {
  return tgCall("answerCallbackQuery", {
    callback_query_id: callbackId,
    text,
    cache_time: 0,
  });
}

export function getMe() {
  return tgCall<{ username: string; first_name: string }>("getMe", {});
}

export function setWebhook(url: string) {
  return tgCall("setWebhook", {
    url,
    secret_token: env.telegram.webhookSecret,
    allowed_updates: ["message", "callback_query"],
  });
}

export function deleteWebhook() {
  return tgCall("deleteWebhook", {});
}

/** Descarcă un fișier Telegram (ex. voice) ca ArrayBuffer. */
export async function getFileBuffer(fileId: string): Promise<ArrayBuffer | null> {
  const file = await tgCall<{ file_path: string }>("getFile", { file_id: fileId });
  if (!file?.file_path) return null;
  const res = await fetch(
    `https://api.telegram.org/file/bot${env.telegram.botToken}/${file.file_path}`,
  );
  if (!res.ok) return null;
  return res.arrayBuffer();
}

/**
 * Link invizibil (caracter zero-width ca text de ancoră) — Telegram îl randează ca pe un
 * link real (clic-abil, deschide URL-ul), dar fără niciun text vizibil în mesaj. Folosit
 * ca să atașăm un deep-link discret către PWA (ex. lângă un #id) fără să "murdărim" mesajul.
 */
export function invisibleLink(url: string): string {
  return `<a href="${url}">​</a>`;
}

/** Token de linkare semnat (userId + HMAC trunchiat). */
export function signLinkToken(userId: string): string {
  const sig = createHmac("sha256", env.sessionSecret)
    .update(userId)
    .digest("base64url")
    .slice(0, 16);
  return `${userId}.${sig}`;
}

export function verifyLinkToken(token: string): string | null {
  const [userId, sig] = token.split(".");
  if (!userId || !sig) return null;
  const expected = createHmac("sha256", env.sessionSecret)
    .update(userId)
    .digest("base64url")
    .slice(0, 16);
  return sig === expected ? userId : null;
}

/** Meniul principal (butoane). */
export function mainMenu(): InlineButton[][] {
  return [
    [
      { text: "📋 Sarcinile mele", callback_data: "MY_TASKS" },
    ],
    [
      { text: "📅 Azi", callback_data: "TODAY" },
      { text: "📆 Mâine", callback_data: "TOMORROW" },
    ],
    [
      { text: "🗓 Săptămâna", callback_data: "WEEK" },
      { text: "➕ Adaugă", callback_data: "ADD" },
    ],
    [
      { text: "🔍 Caută client", callback_data: "SEARCH" },
      { text: "🎤 Voce", callback_data: "VOICE" },
    ],
    [{ text: "⚙️ Setări", callback_data: "SETTINGS" }],
  ];
}

/** Meniu redus pentru lucrători fără acces CRM (task-uri + zile). */
export function workerMenu(): InlineButton[][] {
  return [
    [{ text: "📋 Sarcinile mele", callback_data: "MY_TASKS" }],
    [
      { text: "📅 Azi", callback_data: "TODAY" },
      { text: "📆 Mâine", callback_data: "TOMORROW" },
    ],
    [{ text: "🗓 Săptămâna", callback_data: "WEEK" }],
  ];
}

export const TASK_STATUS_RO: Record<string, string> = {
  NEW: "Nou",
  ASSIGNED: "Asignat",
  READ: "Citit",
  IN_PROGRESS: "În lucru",
  ON_HOLD: "În așteptare",
  REVIEW: "În verificare",
  DONE: "Finalizat",
  CANCELLED: "Anulat",
};

export const TASK_TYPE_RO: Record<string, string> = {
  TASK: "Sarcină",
  TICKET: "Cerere",
};

export const TASK_PRIORITY_RO: Record<string, string> = {
  LOW: "Scăzută",
  MEDIUM: "Medie",
  HIGH: "Ridicată",
  URGENT: "Urgentă",
};

/** Buton unic pentru task finalizat/anulat — permite redeschiderea direct din mesaj. */
export function taskReopenButton(taskId: string): InlineButton[][] {
  return [[{ text: "↩️ Redeschide sarcină", callback_data: `TST:IN_PROGRESS:${taskId}` }]];
}

/** Butoane pentru muncitor (acțiuni + progres). */
export function taskStatusButtons(taskId: string): InlineButton[][] {
  return [
    [
      { text: "👁 Am citit", callback_data: `TST:READ:${taskId}` },
      { text: "▶️ Încep lucrul", callback_data: `TST:IN_PROGRESS:${taskId}` },
    ],
    [
      { text: "⏸ În așteptare", callback_data: `TST:ON_HOLD:${taskId}` },
      { text: "👀 La verificare", callback_data: `TST:REVIEW:${taskId}` },
    ],
    [
      { text: "✅ Am finalizat", callback_data: `TST:DONE:${taskId}` },
      { text: "✖️ Nu pot executa", callback_data: `TST:CANCELLED:${taskId}` },
    ],
    [
      { text: "0%", callback_data: `TPR:0:${taskId}` },
      { text: "25%", callback_data: `TPR:25:${taskId}` },
      { text: "50%", callback_data: `TPR:50:${taskId}` },
      { text: "75%", callback_data: `TPR:75:${taskId}` },
      { text: "100%", callback_data: `TPR:100:${taskId}` },
    ],
  ];
}

/** Butoanele din ecranul de detalii task: status + progres + adăugare comentariu. */
export function taskDetailButtons(taskId: string): InlineButton[][] {
  return [...taskStatusButtons(taskId), [{ text: "💬 Adaugă comentariu", callback_data: `TCOMM:${taskId}` }]];
}

/** Butoane per programare. */
export function apptButtons(id: string): InlineButton[][] {
  return [
    [
      { text: "✅ Confirmă", callback_data: `ST_CONFIRM:${id}` },
      { text: "✔️ Finalizat", callback_data: `ST_DONE:${id}` },
    ],
    [
      { text: "❌ Anulează", callback_data: `ST_CANCEL:${id}` },
      { text: "🚫 No-show", callback_data: `ST_NOSHOW:${id}` },
    ],
  ];
}
