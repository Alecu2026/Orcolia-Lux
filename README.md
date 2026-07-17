# Programări — aplicație fullstack de programări/task-uri pentru clienți

Rapidă și simplă: o programare se creează în sub 10 secunde (buton mare „+", formular rapid sau comandă vocală).

## Stack
- **Next.js 16** (App Router, Server Actions, Proxy) + **TypeScript**
- **TailwindCSS v4** (temă proprie, dark/light)
- **MongoDB** + **Prisma 6** (`select` peste tot, indexuri, snapshot-uri denormalizate)
- **Nodemailer** (reminder email) · **Telegram Bot API** (control din chat)
- **PWA** cu notificări push (web-push) · **AI voice-to-task** (Whisper + extragere structurată)

## Setup rapid

```bash
npm install                 # instalează + prisma generate (postinstall)
cp .env.example .env        # completează valorile
npm run db:push             # creează colecțiile + indexurile în MongoDB
npm run dev                 # http://localhost:3000
```

> **MongoDB** trebuie rulat ca **replica set** (local: `mongod --replSet rs0` apoi `rs.initiate()`, sau MongoDB Atlas). Prisma cere asta pentru scrieri.

La prima accesare a `/login`, dacă baza e goală, aplicația cere crearea **contului de administrator** (bootstrap) — fără pași manuali în DB.

## Variabile de mediu (vezi `.env.example`)
| Cheie | Rol |
|------|-----|
| `DATABASE_URL` | conexiune MongoDB (replica set) |
| `SESSION_SECRET`, `SESSION_TTL_DAYS` | sesiune (implicit 180 zile) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | bot Telegram |
| `CRON_SECRET` | protejează jobul de remindere |
| `SMTP_*`, `EMAIL_FROM` | trimitere email |
| `OPENAI_API_KEY`, `AI_*_MODEL` | voice-to-task |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | push PWA |

## Structura proiectului
```
prisma/schema.prisma          # 12 modele + enums + indexuri
proxy.ts                      # protejare rute (fostul middleware)
lib/
  env.ts prisma.ts            # config + client singleton
  session.ts password.ts dal.ts    # auth: token hash, bcrypt, getCurrentUser cache
  date.ts                     # dateKey + conversii timezone (fără dependențe)
  validation.ts               # scheme Zod
  email.ts telegram.ts push.ts
  queries/                    # citiri optimizate (select, paginare, cache)
  services/                   # appointments, reminders, voice, telegram-bot
app/
  (auth)/login                # login / bootstrap cont
  (app)/                      # shell autentificat (dashboard, appointments, calendar,
                              #   kanban, clients, settings, telegram)
  actions/                    # Server Actions (auth, clients, appointments, settings, telegram)
  api/                        # telegram/webhook, cron/reminders, voice, push, clients/search
  components/                 # UI client (QuickAdd, Voice, Kanban, etc.)
  manifest.ts                 # PWA manifest
public/sw.js public/icons/    # service worker + iconuri
```

## Module

### Programare în 10 secunde
Buton „+" (FAB sau din dashboard) → dialog rapid: client (autocomplete sau nume nou),
categorie (chip cu durată automată), Azi/Mâine, oră, remindere, status. Verifică slotul
ocupat, creează clientul dacă nu există și generează reminderele.

### Telegram (`/telegram`)
1. Pune `TELEGRAM_BOT_TOKEN` în `.env`.
2. Apasă **Setează webhook** (înregistrează `NEXT_PUBLIC_APP_URL/api/telegram/webhook`).
3. Apasă **Deschide @bot** → `/start` leagă automat contul.

Butoane în bot: 📅 Azi / 📆 Mâine / 🗓 Săptămâna / ➕ / 🔍 / 🎤. Per programare:
✅ Confirmă · ✔️ Finalizat · ❌ Anulează · 🚫 No-show. Mesaj vocal → programare cu confirmare.
Webhook-ul răspunde 200 instant și procesează în fundal (`after()`).

### Remindere email (`/api/cron/reminders`)
Programează un cron (Vercel Cron sau orice scheduler) la 5–15 min:
```
GET /api/cron/reminders   Header: Authorization: Bearer <CRON_SECRET>
```
Trimite reminderele scadente (24h și 3h înainte, configurabil în Setări).
Retry până la 3 încercări, apoi `FAILED`.

### AI voice-to-task
Microfon în aplicație sau mesaj vocal în Telegram → transcriere (Whisper) →
extragere `{client, dată, oră, categorie...}` → **preview + confirmare** înainte de salvare.

### PWA
Instalabilă (manifest + service worker). Notificări push: Setări → **Activează notificările**
(necesită chei VAPID: `npx web-push generate-vapid-keys`).

## Optimizări de viteză
- `select` explicit în toate query-urile, fără `include` greu
- `dateKey` (YYYY-MM-DD) pentru listări zilnice instant, independent de fus
- snapshot-uri (`clientNameSnapshot`, `categoryNameSnapshot/Color`) → Telegram listează fără join
- indexuri compuse: `userId+dateKey`, `userId+startAt`, `userId+status`, `status+sendAt`, ...
- paginare la clienți, debounce la search, cache per-request pentru categorii/setări
- `getCurrentUser()` memoizat, `lastUsedAt` actualizat throttle-uit (max o dată/zi)
