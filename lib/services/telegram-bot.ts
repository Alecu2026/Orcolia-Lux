import "server-only";
import { prisma } from "../prisma";
import {
  sendMessage,
  answerCallback,
  mainMenu,
  workerMenu,
  apptButtons,
  taskDetailButtons,
  getFileBuffer,
  verifyLinkToken,
  TASK_STATUS_RO,
  TASK_PRIORITY_RO,
  type InlineButton,
} from "../telegram";
import { getUserTimezone } from "../queries/settings";
import { listByDateKey, listByDateKeys } from "../queries/appointments";
import { searchClients } from "../queries/clients";
import { listCategories } from "../queries/categories";
import { createAppointment, changeStatus } from "./appointments";
import { createTask, changeTaskStatus, changeTaskProgress, addTaskComment, notifyNewTask } from "./tasks";
import { transcribeAudio } from "./voice";
import { todayKey, tomorrowKey, weekKeys, formatTime, formatDate, humanDay, dayBoundsUtc, dateKeyOf } from "../date";
import { getQuietHoursSettings } from "../queries/company";
import { isQuietTime } from "../quiet-hours";
import type { AppointmentStatus, TaskStatus } from "@prisma/client";

const STATUS_RO: Record<AppointmentStatus, string> = {
  NEW: "Nou",
  CONFIRMED: "Confirmat",
  IN_PROGRESS: "În lucru",
  DONE: "Finalizat",
  CANCELLED: "Anulat",
  NO_SHOW: "Absent",
};

type LinkedUser = { userId: string; chatId: string; isAdmin: boolean; teamIds: string[] };

/** Returnează meniul potrivit rolului: admin → meniu complet, lucrător → doar task-uri. */
function menuFor(user: LinkedUser): InlineButton[][] {
  return user.isAdmin ? mainMenu() : workerMenu();
}

/** Clauza OR pentru a găsi task-urile unui worker (direct asignat SAU via echipă, inclusiv extra). */
function workerTaskWhere(user: LinkedUser) {
  const ors: object[] = [
    { assigneeId: user.userId },
    { extraAssigneeIds: { has: user.userId } },
  ];
  if (user.teamIds.length > 0) {
    ors.push({ teamId: { in: user.teamIds } });
    ors.push({ extraTeamIds: { hasSome: user.teamIds } });
  }
  return { OR: ors };
}

/** Doar conturi APROBATE de admin (userId setat) — cele pending rămân fără acces la funcții. */
async function resolveUser(telegramUserId: number | string): Promise<LinkedUser | null> {
  const acc = await prisma.telegramAccount.findUnique({
    where: { telegramUserId: String(telegramUserId) },
    select: { userId: true, chatId: true, user: { select: { role: true, teamIds: true } } },
  });
  if (!acc?.userId) return null;
  const isAdmin = acc.user?.role === "ADMIN";
  return { userId: acc.userId, chatId: acc.chatId, isAdmin, teamIds: acc.user?.teamIds ?? [] };
}

/** Mesaj contextual când userul nu e încă utilizabil (pending vs niciodată /start). */
async function notLinkedMessage(telegramUserId: number | string): Promise<string> {
  const acc = await prisma.telegramAccount.findUnique({
    where: { telegramUserId: String(telegramUserId) },
    select: { userId: true },
  });
  if (acc && !acc.userId) {
    return "⏳ Cererea ta a fost înregistrată. Un administrator trebuie să-ți activeze contul — vei fi notificat aici imediat ce se face asta.";
  }
  return "👋 Trimite /start ca să te înregistrezi.";
}

/** Task-urile active ale lucrătorului (direct asignat + via echipă). */
async function myOpenTasks(user: LinkedUser) {
  return prisma.task.findMany({
    where: { ...workerTaskWhere(user), status: { notIn: ["DONE", "CANCELLED"] } },
    select: { id: true, title: true, status: true, priority: true, progress: true, dueAt: true },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 15,
  });
}

async function renderMyTasks(chatId: string | number, user: LinkedUser) {
  const tasks = await myOpenTasks(user);
  if (tasks.length === 0) {
    await sendMessage(chatId, "📋 Nu ai task-uri active momentan.", menuFor(user));
    return;
  }
  await sendMessage(chatId, `📋 <b>Task-urile tale</b> (${tasks.length})`, undefined);
  for (const t of tasks) {
    const line =
      `<b>${escapeHtml(t.title)}</b>\n` +
      `${TASK_STATUS_RO[t.status]} · ${TASK_PRIORITY_RO[t.priority]}${t.progress > 0 ? ` · ${t.progress}%` : ""}`;
    await sendMessage(chatId, line, [
      [{ text: "ℹ️ Detalii", callback_data: `TDET:${t.id}` }],
      [{ text: "◀️ Înapoi", callback_data: "MY_TASKS" }],
    ]);
  }
}

async function renderTaskDetail(chatId: string | number, user: LinkedUser, taskId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, ...workerTaskWhere(user) },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      progress: true,
      dueAt: true,
      comments: {
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { body: true, createdAt: true, user: { select: { name: true } } },
      },
    },
  });
  if (!task) {
    await sendMessage(chatId, "❌ Task inexistent sau nu este al tău.", menuFor(user));
    return;
  }
  const tz = await getUserTimezone(user.userId);
  const lines = [
    `📋 <b>${escapeHtml(task.title)}</b>`,
    task.description ? escapeHtml(task.description) : "",
    "",
    `Status: <b>${TASK_STATUS_RO[task.status]}</b> · ${TASK_PRIORITY_RO[task.priority]}${task.progress > 0 ? ` · ${task.progress}%` : ""}`,
  ];
  if (task.dueAt) lines.push(`📅 Scadent: ${formatDate(task.dueAt, tz)}`);
  if (task.comments.length > 0) {
    lines.push("", "💬 <b>Ultimele comentarii</b>");
    for (const c of task.comments.slice().reverse()) {
      lines.push(`• ${escapeHtml(c.user?.name ?? "—")}: ${escapeHtml(c.body)}`);
    }
  }
  await sendMessage(chatId, lines.filter(Boolean).join("\n"), taskDetailButtons(task.id));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function renderDay(chatId: string | number, user: LinkedUser, dateKey: string, tz: string) {
  const appts = await listByDateKey(user.userId, dateKey);
  const header = `📅 <b>${humanDay(dateKey, tz)}</b> — ${appts.length} programări`;
  await sendMessage(chatId, header, appts.length ? undefined : menuFor(user));
  for (const a of appts.slice(0, 12)) {
    const line =
      `🕐 <b>${formatTime(a.startAt, tz)}</b> · ${a.clientNameSnapshot}` +
      (a.categoryNameSnapshot ? ` · ${a.categoryNameSnapshot}` : "") +
      ` · ${STATUS_RO[a.status]}`;
    await sendMessage(chatId, line, apptButtons(a.id));
  }
}

async function renderWeek(chatId: string | number, user: LinkedUser, tz: string) {
  const keys = weekKeys(todayKey(tz), tz);
  const appts = await listByDateKeys(user.userId, keys);
  if (appts.length === 0) {
    await sendMessage(chatId, "🗓 Nicio programare săptămâna aceasta.", menuFor(user));
    return;
  }
  const lines: string[] = ["🗓 <b>Săptămâna aceasta</b>", ""];
  let lastDay = "";
  for (const a of appts) {
    if (a.dateKey !== lastDay) {
      lines.push(`\n<b>${humanDay(a.dateKey, tz)}</b>`);
      lastDay = a.dateKey;
    }
    lines.push(
      `${formatTime(a.startAt, tz)} · ${a.clientNameSnapshot}` +
        (a.categoryNameSnapshot ? ` · ${a.categoryNameSnapshot}` : ""),
    );
  }
  await sendMessage(chatId, lines.join("\n"), menuFor(user));
}

/** Task-uri scadente pe o zi specifică — pentru lucrători (în loc de programări). */
async function renderWorkerDay(chatId: string | number, user: LinkedUser, dateKey: string, tz: string) {
  const label = humanDay(dateKey, tz);
  const { start, end } = dayBoundsUtc(dateKey, tz);
  const tasks = await prisma.task.findMany({
    where: {
      ...workerTaskWhere(user),
      status: { notIn: ["DONE", "CANCELLED"] },
      dueAt: { gte: start, lt: end },
    },
    select: { id: true, title: true, status: true, priority: true, progress: true },
    orderBy: [{ status: "asc" }],
    take: 15,
  });
  if (tasks.length === 0) {
    await sendMessage(chatId, `📅 <b>${label}</b>\nNu ai task-uri scadente în această zi.`, workerMenu());
    return;
  }
  await sendMessage(chatId, `📅 <b>${label}</b> — ${tasks.length} task-uri`, undefined);
  for (const t of tasks) {
    const line =
      `<b>${escapeHtml(t.title)}</b>\n` +
      `${TASK_STATUS_RO[t.status]} · ${TASK_PRIORITY_RO[t.priority]}${t.progress > 0 ? ` · ${t.progress}%` : ""}`;
    await sendMessage(chatId, line, [
      [{ text: "ℹ️ Detalii", callback_data: `TDET:${t.id}` }],
      [{ text: "◀️ Înapoi", callback_data: "MY_TASKS" }],
    ]);
  }
}

/** Task-uri scadente în săptămâna curentă — pentru lucrători. */
async function renderWorkerWeek(chatId: string | number, user: LinkedUser, tz: string) {
  const keys = weekKeys(todayKey(tz), tz);
  const weekStart = dayBoundsUtc(keys[0], tz).start;
  const weekEnd = dayBoundsUtc(keys[keys.length - 1], tz).end;
  const tasks = await prisma.task.findMany({
    where: {
      ...workerTaskWhere(user),
      status: { notIn: ["DONE", "CANCELLED"] },
      dueAt: { gte: weekStart, lt: weekEnd },
    },
    select: { id: true, title: true, status: true, priority: true, progress: true, dueAt: true },
    orderBy: [{ dueAt: "asc" }],
    take: 20,
  });
  if (tasks.length === 0) {
    await sendMessage(chatId, "🗓 Niciun task scadent săptămâna aceasta.", workerMenu());
    return;
  }
  const lines: string[] = ["🗓 <b>Task-uri săptămâna aceasta</b>", ""];
  let lastDay = "";
  for (const t of tasks) {
    const dayKey = t.dueAt ? dateKeyOf(t.dueAt, tz) : "";
    if (dayKey !== lastDay) {
      if (dayKey) lines.push(`\n<b>${humanDay(dayKey, tz)}</b>`);
      lastDay = dayKey;
    }
    lines.push(`• ${escapeHtml(t.title)} — ${TASK_STATUS_RO[t.status]}`);
  }
  await sendMessage(chatId, lines.join("\n"), workerMenu());
}

// ---------- Update entrypoint ----------

export async function handleUpdate(update: Record<string, unknown>): Promise<void> {
  if (update.callback_query) {
    await handleCallback(update.callback_query as Cb);
  } else if (update.message) {
    await handleMessage(update.message as Msg);
  }
}

type Msg = {
  chat: { id: number };
  from: { id: number; username?: string; first_name?: string; last_name?: string };
  text?: string;
  voice?: { file_id: string };
};

type Cb = {
  id: string;
  data?: string;
  from: { id: number };
  message?: { chat: { id: number } };
};

async function handleMessage(msg: Msg) {
  const chatId = msg.chat.id;
  const text = (msg.text ?? "").trim();

  // /start [token] — linkare cont admin (din aplicație) SAU înregistrare contact pending (lucrător)
  if (text.startsWith("/start")) {
    const token = text.split(/\s+/)[1];
    if (token) {
      // 1) Token admin semnat (userId.HMAC)
      const userId = verifyLinkToken(token);
      if (userId) {
        await prisma.telegramAccount.upsert({
          where: { telegramUserId: String(msg.from.id) },
          create: {
            userId,
            telegramUserId: String(msg.from.id),
            chatId: String(chatId),
            username: msg.from.username ?? null,
            firstName: msg.from.first_name ?? null,
            lastName: msg.from.last_name ?? null,
          },
          update: { chatId: String(chatId), userId },
        }).catch(() => {});
        await sendMessage(chatId, "✅ Cont conectat! Alege o opțiune:", mainMenu());
        return;
      }

      // 2) Token de invitație publică (inv_...)
      if (token.startsWith("inv_")) {
        const settings = await prisma.companySettings.findFirst({
          where: { singleton: "main" },
          select: { telegramInviteToken: true },
        });
        if (settings?.telegramInviteToken && settings.telegramInviteToken === token) {
          // Token valid → înregistrăm ca pending (același flux ca /start fără token)
          await prisma.telegramAccount
            .upsert({
              where: { telegramUserId: String(msg.from.id) },
              create: {
                telegramUserId: String(msg.from.id),
                chatId: String(chatId),
                username: msg.from.username ?? null,
                firstName: msg.from.first_name ?? null,
                lastName: msg.from.last_name ?? null,
              },
              update: {
                chatId: String(chatId),
                username: msg.from.username ?? null,
                firstName: msg.from.first_name ?? null,
                lastName: msg.from.last_name ?? null,
              },
            })
            .catch((e) => console.error("[telegram-bot] /start invite: upsert eșuat", e));
          const existing = await prisma.telegramAccount.findUnique({
            where: { telegramUserId: String(msg.from.id) },
            select: { userId: true },
          });
          if (existing?.userId) {
            const linkedUser = await resolveUser(msg.from.id);
            await sendMessage(chatId, "✅ Cont conectat! Alege o opțiune:", linkedUser ? menuFor(linkedUser) : workerMenu());
          } else {
            await sendMessage(
              chatId,
              "👋 Salut! Cererea ta a fost înregistrată.\nUn administrator trebuie să-ți activeze contul — vei primi un mesaj aici imediat ce ești activat.",
            );
          }
          return;
        }
        await sendMessage(chatId, "❌ Link-ul de invitație este invalid sau a fost revocat.");
        return;
      }

      await sendMessage(chatId, "❌ Cod de conectare invalid sau expirat.");
      return;
    }

    // Fără token: lucrător fără cont CRM. Înregistrăm contactul ca "pending" —
    // chat ID-ul apare în CRM (Telegram → Utilizatori neatribuiți) pentru ca un
    // admin să completeze profilul. Dacă era deja aprobat, nu schimbăm nimic.
    const existing = await prisma.telegramAccount.findUnique({
      where: { telegramUserId: String(msg.from.id) },
      select: { userId: true },
    });
    await prisma.telegramAccount
      .upsert({
        where: { telegramUserId: String(msg.from.id) },
        create: {
          telegramUserId: String(msg.from.id),
          chatId: String(chatId),
          username: msg.from.username ?? null,
          firstName: msg.from.first_name ?? null,
          lastName: msg.from.last_name ?? null,
        },
        update: {
          chatId: String(chatId),
          username: msg.from.username ?? null,
          firstName: msg.from.first_name ?? null,
          lastName: msg.from.last_name ?? null,
        },
      })
      .catch((e) => console.error("[telegram-bot] /start: upsert pending contact eșuat", e));

    if (existing?.userId) {
      // Re-fetch cu rol ca să afișăm meniul corect
      const linkedUser = await resolveUser(msg.from.id);
      await sendMessage(chatId, "✅ Cont conectat! Alege o opțiune:", linkedUser ? menuFor(linkedUser) : workerMenu());
    } else {
      await sendMessage(
        chatId,
        "👋 Salut! Cererea ta a fost înregistrată.\nUn administrator trebuie să-ți activeze contul din aplicație — vei primi un mesaj aici imediat ce ești activat.",
      );
    }
    return;
  }

  // Ore de somn — blocăm toate comenzile (excepție: /start tratat mai sus)
  const qhConfig = await getQuietHoursSettings();
  if (isQuietTime(new Date(), qhConfig)) {
    await sendMessage(
      chatId,
      `😴 Botul este în modul somn (${qhConfig.quietHoursStart} – ${qhConfig.quietHoursEnd}). Revin la ora ${qhConfig.quietHoursEnd}.`,
    );
    return;
  }

  const user = await resolveUser(msg.from.id);

  // Mesaj vocal → programare (doar admin)
  if (msg.voice) {
    if (!user) return void sendMessage(chatId, await notLinkedMessage(msg.from.id));
    if (!user.isAdmin) {
      await sendMessage(chatId, "🎤 Funcția voce nu este disponibilă pentru contul tău.", workerMenu());
      return;
    }
    await handleVoice(chatId, user.userId, msg.voice.file_id);
    return;
  }

  if (!user) {
    await sendMessage(chatId, await notLinkedMessage(msg.from.id));
    return;
  }

  // Comentariu în curs de scriere (declanșat de butonul "💬 Adaugă comentariu")
  const account = await prisma.telegramAccount.findUnique({
    where: { telegramUserId: String(msg.from.id) },
    select: { lastMenuState: true },
  });
  if (account?.lastMenuState?.startsWith("awaiting_comment:") && text) {
    const taskId = account.lastMenuState.slice("awaiting_comment:".length);
    await prisma.telegramAccount
      .update({ where: { telegramUserId: String(msg.from.id) }, data: { lastMenuState: null } })
      .catch(() => {});
    const res = await addTaskComment(taskId, user.userId, text, "TELEGRAM");
    await sendMessage(chatId, res.ok ? "✅ Comentariu adăugat." : `❌ ${res.error}`, menuFor(user));
    return;
  }

  if (text === "/menu" || text === "/start") {
    await sendMessage(chatId, "Meniu:", menuFor(user));
    return;
  }

  if (text === "/tasks") {
    await renderMyTasks(chatId, user);
    return;
  }

  // Lucrătorii nu au acces la căutare client — afișăm meniul lor
  if (!user.isAdmin) {
    await sendMessage(chatId, "📋 Apasa butonul [Task-urile mele] pentru a-ti vedea task-urile.", workerMenu());
    return;
  }

  // Orice alt text = căutare client (doar admin)
  const matches = await searchClients(user.userId, text, 8);
  if (matches.length === 0) {
    await sendMessage(chatId, `Niciun client pentru "${text}".`, mainMenu());
    return;
  }
  const lines = ["🔍 <b>Clienți găsiți</b>", ""];
  for (const m of matches) lines.push(`• ${m.name}${m.phone ? ` · ${m.phone}` : ""}`);
  await sendMessage(chatId, lines.join("\n"), mainMenu());
}

async function handleCallback(cb: Cb) {
  // Răspunde instant (botul nu pare lent)
  await answerCallback(cb.id);
  const chatId = cb.message?.chat.id;
  const data = cb.data ?? "";
  if (!chatId) return;

  // Ore de somn — blocăm callback-urile (cu excepția task-urilor cu bypassQuietHours)
  const qhConfigCb = await getQuietHoursSettings();
  if (isQuietTime(new Date(), qhConfigCb)) {
    // Verificăm dacă este callback de schimbare status task cu bypass activ
    const tstBypassMatch = data.match(/^TST:\w+:(.+)$/);
    let bypassAllowed = false;
    if (tstBypassMatch) {
      const taskForBypass = await prisma.task.findUnique({
        where: { id: tstBypassMatch[1] },
        select: { bypassQuietHours: true },
      });
      bypassAllowed = taskForBypass?.bypassQuietHours === true;
    }
    if (!bypassAllowed) {
      await sendMessage(
        chatId,
        `😴 Botul este în modul somn (${qhConfigCb.quietHoursStart} – ${qhConfigCb.quietHoursEnd}). Revin la ora ${qhConfigCb.quietHoursEnd}.`,
      );
      return;
    }
  }

  const user = await resolveUser(cb.from.id);
  if (!user) {
    await sendMessage(chatId, await notLinkedMessage(cb.from.id));
    return;
  }
  const tz = await getUserTimezone(user.userId);

  if (data === "MY_TASKS") return void renderMyTasks(chatId, user);
  if (data === "TODAY") {
    return user.isAdmin
      ? void renderDay(chatId, user, todayKey(tz), tz)
      : void renderWorkerDay(chatId, user, todayKey(tz), tz);
  }
  if (data === "TOMORROW") {
    return user.isAdmin
      ? void renderDay(chatId, user, tomorrowKey(tz), tz)
      : void renderWorkerDay(chatId, user, tomorrowKey(tz), tz);
  }
  if (data === "WEEK") {
    return user.isAdmin
      ? void renderWeek(chatId, user, tz)
      : void renderWorkerWeek(chatId, user, tz);
  }
  if (data === "ADD")
    return void sendMessage(chatId, "➕ Trimite un <b>mesaj vocal</b> cu programarea, ex: 'Ion maine la 3 la tuns'.");
  if (data === "VOICE")
    return void sendMessage(chatId, "🎤 Trimite un mesaj vocal cu programarea dorită.");
  if (data === "SEARCH")
    return void sendMessage(chatId, "🔍 Scrie numele clientului pentru căutare.");
  if (data === "SETTINGS")
    return void sendMessage(chatId, "⚙️ Setările se gestionează din aplicație.", menuFor(user));

  // Detalii task (din lista "Task-urile mele")
  const detMatch = data.match(/^TDET:(.+)$/);
  if (detMatch) return void renderTaskDetail(chatId, user, detMatch[1]);

  // Pornește fluxul de comentariu: următorul mesaj text trimis devine comentariul
  const commMatch = data.match(/^TCOMM:(.+)$/);
  if (commMatch) {
    await prisma.telegramAccount
      .update({
        where: { telegramUserId: String(cb.from.id) },
        data: { lastMenuState: `awaiting_comment:${commMatch[1]}` },
      })
      .catch((e) => console.error("[telegram-bot] TCOMM: setare lastMenuState eșuată", e));
    await sendMessage(chatId, "💬 Scrie comentariul și trimite-l ca mesaj text.");
    return;
  }

  // Schimbare status TASK (din butoanele de notificare)
  const taskMatch = data.match(/^TST:(\w+):(.+)$/);
  if (taskMatch) {
    const newStatus = taskMatch[1] as TaskStatus;
    const res = await changeTaskStatus(
      taskMatch[2],
      user.userId,
      newStatus,
      { fromTelegram: true },
    );
    if (!res.ok) {
      await sendMessage(chatId, `❌ ${res.error}`);
    } else if (res.changed) {
      // Dacă mesajul original nu a fost editat (task fără notificare Telegram), trimite confirmare
      const hadTgMessage = res.hadTelegramMessage;
      if (!hadTgMessage) {
        await sendMessage(chatId, `✅ Status actualizat: <b>${TASK_STATUS_RO[newStatus] ?? newStatus}</b>`, menuFor(user));
      }
    }
    return;
  }

  // Progres TASK din butoane
  const prMatch = data.match(/^TPR:(\d+):(.+)$/);
  if (prMatch) {
    const res = await changeTaskProgress(prMatch[2], user.userId, Number(prMatch[1]));
    await sendMessage(chatId, res.ok ? `📊 Progres: ${prMatch[1]}%` : `❌ ${res.error}`);
    return;
  }

  // Schimbare status programare (doar admin)
  const stMatch = data.match(/^ST_(CONFIRM|DONE|CANCEL|NOSHOW):(.+)$/);
  if (stMatch) {
    if (!user.isAdmin) {
      await sendMessage(chatId, "❌ Nu ai acces la programări.", workerMenu());
      return;
    }
    const map: Record<string, AppointmentStatus> = {
      CONFIRM: "CONFIRMED",
      DONE: "DONE",
      CANCEL: "CANCELLED",
      NOSHOW: "NO_SHOW",
    };
    const status = map[stMatch[1]];
    const res = await changeStatus(user.userId, stMatch[2], status);
    await sendMessage(chatId, res.ok ? `✅ Status: ${STATUS_RO[status]}` : `❌ ${res.error}`);
    return;
  }

  // Confirmare programare din voce (doar admin)
  const vMatch = data.match(/^V(CREATE|CANCEL):(.+)$/);
  if (vMatch) {
    if (!user.isAdmin) {
      await sendMessage(chatId, "❌ Nu ai acces la comenzi vocale.", workerMenu());
      return;
    }
    if (vMatch[1] === "CANCEL") {
      await prisma.voiceCommandLog.updateMany({
        where: { id: vMatch[2], userId: user.userId },
        data: { status: "DISCARDED" },
      });
      await sendMessage(chatId, "Am renunțat la programare.", mainMenu());
      return;
    }
    await confirmVoiceAppointment(chatId, user.userId, vMatch[2], tz);
    return;
  }
}

async function handleVoice(chatId: number, userId: string, fileId: string) {
  await sendMessage(chatId, "🎧 Procesez mesajul vocal…");
  const buf = await getFileBuffer(fileId);
  if (!buf) return void sendMessage(chatId, "Nu am putut descărca audio-ul.");

  try {
    const transcript = (await transcribeAudio(buf, "voice.ogg", "audio/ogg")).trim();
    if (!transcript) return void sendMessage(chatId, "Nu am înțeles mesajul vocal.");

    await prisma.voiceCommandLog
      .create({ data: { userId, source: "TELEGRAM", transcript, status: "CONFIRMED" } })
      .catch(() => {});

    const title = transcript.length > 140 ? `${transcript.slice(0, 140)}…` : transcript;
    const res = await createTask(
      userId,
      { title, description: transcript !== title ? transcript : undefined },
      "VOICE",
    );

    if (res.ok) {
      await notifyNewTask(res.id);
      await sendMessage(chatId, `✅ <b>Task creat din voce</b>\n«${res.title}»`);
    } else {
      await sendMessage(chatId, `❌ ${res.error}`);
    }
  } catch (e) {
    await sendMessage(chatId, `❌ ${e instanceof Error ? e.message : "Eroare procesare voce."}`);
  }
}

async function confirmVoiceAppointment(
  chatId: number,
  userId: string,
  logId: string,
  tz: string,
) {
  const log = await prisma.voiceCommandLog.findFirst({
    where: { id: logId, userId },
    select: { parsedJson: true },
  });
  if (!log?.parsedJson) return void sendMessage(chatId, "Comandă inexistentă.");
  const p = log.parsedJson as Record<string, unknown>;

  // Mapează categoria (nume) la id
  let categoryId: string | undefined;
  if (typeof p.category === "string" && p.category) {
    const cats = await listCategories();
    categoryId = cats.find((c) => c.name.toLowerCase() === String(p.category).toLowerCase())?.id;
  }

  const res = await createAppointment(
    userId,
    {
      clientName: p.clientName as string,
      clientPhone: typeof p.phone === "string" ? p.phone : undefined,
      clientEmail: typeof p.email === "string" ? p.email : undefined,
      categoryId,
      dateKey: p.dateKey as string,
      time: p.time as string,
      durationMinutes: typeof p.durationMinutes === "number" ? p.durationMinutes : undefined,
      message: typeof p.message === "string" ? p.message : undefined,
      reminderEmail: p.reminderEmail === true,
      reminderTelegram: p.reminderTelegram !== false,
      status: "CONFIRMED",
    },
    "VOICE",
  );

  if (res.ok) {
    await prisma.voiceCommandLog.update({
      where: { id: logId },
      data: { status: "CONFIRMED", appointmentId: res.id },
    });
    await sendMessage(chatId, `✅ Programare creată: ${res.clientName} la ${formatTime(res.startAt, tz)}.`, mainMenu());
  } else {
    await sendMessage(chatId, `❌ ${res.error}`, mainMenu());
  }
}
