# Rularea pe un server propriu (fără Vercel)

Aplicația e un server Next.js 16 obișnuit (`next start`) + MongoDB. Pe Vercel, câteva lucruri se fac automat (build, joburi programate,
HTTPS, scalare); pe un server propriu le faci tu. Mai jos: ce trebuie, în ordine.

## 1. Cerințe

- **Node.js 20.9+** (recomandat 22 LTS) și `git`.
- **MongoDB** accesibil din server (`DATABASE_URL`).
- **HTTPS** în fața aplicației (nginx/Caddy). Fără HTTPS, autentificarea nu merge (cookie-ul de sesiune e `secure` în producție), iar aplicația
  PWA și notificările push nu funcționează.
- Rulează **o singură instanță** (nu `pm2 -i max`): limitarea cererilor se ține în memoria procesului.

## 2. Instalare / actualizare (după fiecare `git pull`)

```bash
git pull origin main
npm ci
npx prisma generate
npm run db:push        # aplică modelele/câmpurile noi în MongoDB (citește mesajul înainte să confirmi)
npm run build          # variabilele NEXT_PUBLIC_* se „coc" la build: setează-le ÎNAINTE
# repornește procesul (pm2 restart crm / systemctl restart crm)
```

Prima oră după o actualizare: utilizatorii să închidă complet aplicația PWA sau să dea `Ctrl+Shift+R`, altfel rămâne cod vechi în cache.

Pornire: `npm run start` (implicit portul 3000; `PORT=3010 npm run start` pentru alt port). Exemplu pm2: `pm2 start npm --name crm -- run start`.

## 3. Variabile de mediu

Fișier `.env` în rădăcina proiectului (model: `.env.example`). Cele esențiale:

| Variabilă | Rol |
|---|---|
| `DATABASE_URL` | MongoDB |
| `SESSION_SECRET` | semnarea sesiunilor (șir lung, aleator) |
| `NEXT_PUBLIC_APP_URL` | adresa publică, ex. `https://crm.dns.accahul.md` (se coace la build) |
| `CRON_SECRET` | protejează joburile programate (secțiunea 4) |
| `SMS_HTTP_URL`, `sms_token` | gateway SMS (`https://node.dns.accahul.md/sms`) |
| `CALL_HTTP_URL` | gateway apeluri (`https://node.dns.accahul.md/call`); tokenul de apeluri e `CALL_HTTP_TOKEN` sau, dacă lipsește, `sms_token` |
| `CRM_TOKEN` | tokenul webhook-ului PBX Moldcell (`/api/pbx`) |
| `PBX_API_KEY`, `PBX_API_URL` | doar pentru butonul „Sună” cu operator și ascultarea înregistrărilor |
| `SMTP_*`, `IMAP_*`, `EMAIL_FROM` | email trimis / citit |
| `INTERNAL_APP_URL` | **nou:** adresa la care serverul se apelează pe el însuși (ex. `http://127.0.0.1:3000`), pentru PDF-ul facturii |
| `CHROME_PATH` | **nou:** opțional, calea spre Chrome/Chromium pentru PDF (vezi secțiunea 6) |
| `UPLOAD_DIR` | folderul în care se salvează pozele și atașamentele (secțiunea 7); implicit `./storage` lângă aplicație |

Numele acceptă litere mari sau mici pentru `sms_token`, `crm_token`, `pbx_api_key` etc.

## 4. Joburi programate (cron)

Pe Vercel le pornește `vercel.json`; pe server propriu le pui în `crontab -e`. Toate cer `CRON_SECRET`, trimis ca
`Authorization: Bearer …` (sau `?secret=…`). **Fără `CRON_SECRET` setat, joburile răspund 401** (nimeni nu le poate porni din afară).

Orele din `vercel.json` sunt în **UTC**; în crontab pune `CRON_TZ=UTC` (cronie) sau convertește în ora serverului (Moldova: UTC+2 iarna, +3 vara).

```cron
CRON_TZ=UTC
S=https://crm.dns.accahul.md
K="Authorization: Bearer <CRON_SECRET>"

0 6 * * *      curl -fsS -m 120 -H "$K" $S/api/cron              # notificări task-uri, remindere zilnice
*/10 * * * *   curl -fsS -m 60  -H "$K" $S/api/cron/reminders    # remindere programări
*/10 * * * *   curl -fsS -m 60  -H "$K" $S/api/cron/imap         # citire căsuță email (tichete din email, la 10 minute)
0 1 * * *      curl -fsS -m 310 -H "$K" $S/api/cron/apa-canal-sync   # sincronizare Apă-Canal (poate dura minute)
```

Pe Vercel plan **Hobby** cron-urile pot rula cel mult o dată pe zi (de aceea `vercel.json` are câte o intrare pe oră pentru citirea emailului); la 10 minute merge doar pe server propriu (crontab), pe planul Pro sau cu un planificator extern care apelează `/api/cron/imap` cu `CRON_SECRET`.

Cron-ul de apeluri automate **nu mai există**: apelurile pleacă direct din aplicație, la „Trimite”.

## 4b. Lista de plătitori (/platitori) — cache zilnic

Lista (~19.000 de plătitori) nu se mai citește din baza de date la fiecare deschidere. Un singur rând din colecția `PayerCacheEntry`
(comprimat gzip, ~1 MB) ține toți plătitorii, partajat între toate instanțele serverului; fiecare proces îl ține și în memorie.

- **Se reface:** o dată pe zi (cron-ul zilnic și sincronizarea 1C din cron/butonul din Plătitori), la orice modificare a datelor
  (editare plătitor, factură, activare cont, import) și când lipsește. Modificările minore („ultima notificare") se reîmprospătează
  în fundal, fără ca cititorii să aștepte. Versiunea mai veche de 24 h se servește imediat și se reface în fundal.
- **Nu cere migrare:** colecția se creează la prima scriere; după `git pull` rulează doar `npm ci` (face `prisma generate`), build și restart.
  Dacă `prisma generate` n-a rulat, pagina folosește automat interogările vechi.
- **Browserul:** primește lista comprimată, cu ETag (a doua deschidere = 304, fără descărcare) și o ține în IndexedDB.
- **Resetare manuală:** ștergi rândul `PayerCacheEntry` din MongoDB sau apeși ↻ lângă „⚡ local" în Plătitori.

## 4c. Lista de facturi (/invoices) — același cache

Aceeași schemă ca la plătitori (rândul `inv:snapshot` din `PayerCacheEntry`): toate facturile ca tupluri compacte, comprimat gzip, cu ETag; browserul le ține în
IndexedDB și filtrează/paginează local (instant). O factură creată / editată / schimbată / ștearsă se pune direct în memoria serverului, iar varianta comprimată
se reface în fundal (~8 s); importurile și sincronizarea 1C o reconstruiesc complet.

- **Peste 150.000 de facturi** (`INVOICE_SNAPSHOT_MAX`, implicit 150000) lista NU se mai trimite în browser: modul „server" — paginare/filtrare în baza de date
  (cu cache scurt pe rezultate), iar „Toate" aduce cel mult 1000 de rânduri odată. Se vede în log la reconstruire (`[invoice-cache] reconstruit …: server`).
- **Index nou** `Invoice(status, createdAt)`: se creează la `npm run db:push`; ajută doar modul „server".

## 4d. Task-uri și tichete (/tasks, /tickets) — liste mari

- **Până la 1.500 de rânduri** în lista curentă („Ale mele" / „Toate" / „Create de mine") pagina trimite totul în HTML, ca înainte; filtrarea, sortarea și
  paginarea rulează oricum în browser.
- **Peste 1.500** (`TASK_SNAPSHOT_MIN`, implicit 1500) HTML-ul conține doar cele mai noi 100 de rânduri + totalul (se vede imediat), iar restul vine din
  `/api/tasks/dataset`: toată lista compactă (tupluri + dicționar de nume), gzip, cu ETag; browserul o ține în IndexedDB și confirmă cu serverul la fiecare
  deschidere (304 = nimic de descărcat). 20.000 de task-uri ≈ 1 MB pe fir.
- **Proaspătă mereu:** la fiecare cerere serverul verifică o amprentă ieftină (număr + ultima modificare), deci o modificare apare imediat, pe orice instanță.
  Memoria serverului ține cel mult 16 liste (câte una per tip / scop / vizibilitate) și le reface după 2 minute chiar și fără modificări (nume redenumite).
- Editările din tabel (status, prioritate, proiect…) se văd instant (optimist); serverul răspunde cu un singur rând, nu cu toată lista.
- Fără modificări de schemă și fără alte configurări.

## 5. nginx (exemplu)

```nginx
server {
  listen 443 ssl http2;
  server_name crm.dns.accahul.md;
  # ... certificatul SSL ...
  client_max_body_size 25m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 310s;   # sincronizarea Apă-Canal și importurile pot dura minute
  }
}
```

## 6. PDF pentru facturi

Se generează cu un Chromium fără interfață. Pe Vercel e inclus; pe server propriu alegi una:

1. `npx playwright-core install --with-deps chromium` — rulat **cu același utilizator cu care pornește aplicația** (Chromium se pune în `~/.cache/ms-playwright` al acelui utilizator; descarcă și bibliotecile de sistem), **sau**
2. folosești un Chrome/Chromium deja instalat: `CHROME_PATH=/usr/bin/chromium`.

Și setezi `INTERNAL_APP_URL=http://127.0.0.1:3000`, ca serverul să-și poată deschide singur pagina facturii (adresa publică nu e
mereu accesibilă din interior).

## 7. Poze și atașamente (stocare pe disc)

Toate fișierele încărcate — pozele contoarelor (teren, portal, offline), atașamentele task-urilor / tichetelor, dovezile de finalizare — se salvează **pe discul serverului**,
fără niciun serviciu extern. Nu mai există `BLOB_READ_WRITE_TOKEN` și nici limita de 1 GB a cloudului.

**Unde:** în `UPLOAD_DIR` (implicit `./storage` lângă aplicație). Pune-l pe un disc/partiție cu loc și **cu backup**, de ex. `UPLOAD_DIR=/var/crm/uploads` (proprietar: utilizatorul cu care pornește aplicația).

```
UPLOAD_DIR/
├── public/                                    → servite la https://<domeniu>/files/…
│   ├── sarcini/
│   │   ├── 012-sediu-nou/<cod>-<nume>         atașamentele sarcinilor din proiectul #012 (un folder pe PROIECT, nu pe task)
│   │   └── fara-proiect/…                     sarcini fără proiect
│   ├── cereri/
│   │   ├── 012-sediu-nou/…                    atașamentele cererilor (tichete), aceeași structură
│   │   └── fara-proiect/…
│   └── contoare/
│       └── 2026-10/<cod>-<contor>.webp        pozele citirilor, un folder pe lună
├── private/importuri/                         exporturile 1C în curs de import — NU se servesc niciodată
└── cache/<160|320|640>/…                      miniaturi generate la cerere; se pot șterge oricând, se refac singure
```

Folderele de bază (`sarcini`, `cereri`, `contoare`, `importuri`) se creează la pornirea aplicației; folderul unui proiect (sau al unei luni) se creează la **prima poză** din el, nu înainte.
Codul proiectului e numărul lui (`012`): dacă îl redenumești, pozele noi continuă în același folder.

- **Miniaturi:** listele de poze cer `…?w=160|320|640`; serverul face o singură dată o variantă WebP mică (de ~0,3–30 KB în loc de MB), o ține în `cache/` și o servește cu cache de 1 an. Listele se încarcă mult mai repede și consumă mult mai puțină bandă.
- **Resurse:** cel mult `IMAGE_JOBS` (implicit 2) conversii de imagini rulează simultan, restul așteaptă la coadă; exportul 1C (~50 MB) se scrie pe disc în flux, fără să ocupe memorie.
- **Poze → WebP:** orice JPEG / PNG mai mare de 100 KB se redimensionează (max 1920 px) și se salvează ca WebP — de obicei de 5–10 ori mai mic.
  Se face și în browser (înainte de trimitere), și pe server (plasă de siguranță). PDF-urile și celelalte fișiere rămân neschimbate.
- **Adresa nu poate fi ghicită** (cod aleator de 96 de biți), deci linkurile din Telegram / email merg fără autentificare, ca înainte. Dacă vrei fișiere doar pentru utilizatori
  autentificați, spune — se adaugă o verificare de sesiune pe `/files`, dar atunci Telegram nu va mai putea prelua pozele prin link.
- **Backup:** copiază `UPLOAD_DIR` odată cu baza de date (ex. `rsync -a --delete /var/crm/uploads/ /backup/uploads/` zilnic în crontab). Baza de date păstrează doar adresa fișierului;
  fără folder, pozele dispar chiar dacă baza e intactă.
- **Cu mai multe instanțe** ale aplicației (load-balancer), toate trebuie să vadă același `UPLOAD_DIR` (disc partajat / NFS).
- **Mai rapid cu nginx (opțional):** nginx poate ține fișierele deja servite în cache propriu, ca Node să nu mai fie atins la a doua cerere (în `http { }`, apoi în `server { }`):

  ```nginx
  proxy_cache_path /var/cache/nginx/crm levels=1:2 keys_zone=crm_files:10m max_size=2g inactive=30d;

  location ^~ /files/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_cache crm_files;
    proxy_cache_valid 200 30d;
    proxy_cache_key $uri$is_args$args;   # miniaturile (?w=…) se țin separat
  }
  ```

  (Nu folosi `alias` direct spre `public/`: ar ignora `?w=` și ar servi pozele mari în loc de miniaturi.)

- **Import Apă-Canal (~50 MB):** exportul se încarcă în `private/imports` și se șterge după import. În nginx, ruta lui are nevoie de o limită mai mare decât restul:

  ```nginx
  location = /api/upload/apa-canal-import {
    client_max_body_size 160m;
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_request_buffering off;
  }
  ```

  (Atașamentele și pozele au limita de `client_max_body_size 25m` din secțiunea 5.)

### Curățenie (fișiere rămase fără rând în baza de date)

La ștergerea unui task sau atașament, fișierul și miniaturile lui se șterg singure. Pentru ce ar rămâne totuși (încărcări întrerupte, ștergeri directe din baza de date):

```bash
node --env-file=.env scripts/cleanup-orphan-files.mjs            # raport
node --env-file=.env scripts/cleanup-orphan-files.mjs --apply    # șterge (nu atinge fișierele mai noi de 24 h)
```

Poți pune varianta `--apply` în crontab, o dată pe săptămână.

### Mutarea fișierelor vechi din Vercel Blob

Pozele și atașamentele încărcate înainte de această schimbare au încă adrese `https://…blob.vercel-storage.com/…` în baza de date și continuă să se deschidă cât timp store-ul Blob există.
Ca să le muți pe disc (și să le convertești în WebP), din folderul aplicației, cu aceleași variabile ca aplicația (`DATABASE_URL`, `UPLOAD_DIR`):

```bash
node --env-file=.env scripts/migrate-files-to-local.mjs            # raport: câte fișiere, câți MB (nu modifică nimic)
node --env-file=.env scripts/migrate-files-to-local.mjs --apply    # descarcă, convertește, salvează local, actualizează baza de date
```

Se poate re-rula oricând (ce e deja local se sare, ce a eșuat se reia). **Nu șterge nimic din cloud** — după ce verifici că pozele se deschid, golești manual store-ul din Vercel.
Fă întâi un backup al bazei de date.

## 8. Integrări care trebuie să ajungă la server

- **PBX Moldcell** → `https://<domeniu>/api/pbx` (webhook, cu `crm_token`).
- **Telegram** → `https://<domeniu>/api/telegram/webhook` (dacă folosești botul).
- **Gateway SMS / apeluri** (`node.dns.accahul.md`) — se apelează din server; verifică dacă acceptă conexiuni de la IP-ul serverului.

## 9. Ce nu mai apare față de Vercel

- Statisticile Vercel (Analytics / Speed Insights) au fost scoase din aplicație.
- Limita de timp pe funcție (`maxDuration`) nu se aplică; contează `proxy_read_timeout` din nginx.

## 10. Dacă merge încet

Aplicația citește mult din MongoDB (lista de plătitori, apelurile PBX), deci **distanța până la baza de date contează cel mai mult**.

1. **Unde e MongoDB?** Pe aceeași mașină sau în aceeași rețea locală e ideal. Dacă e în cloud (ex. Atlas), fiecare interogare costă zeci de ms
   și citirea listei de plătitori poate dura zeci de secunde.
2. **Vezi cât durează citirea:** în logurile aplicației apare la fiecare reîmprospătare o linie
   `[platitori-snapshot] 19000 plătitori, 4.1 MB, 24310 ms`. Dacă numărul de milisecunde e mare, problema e baza de date (distanța sau lipsa
   resurselor), nu browserul.
3. **Conexiuni:** în `DATABASE_URL` poți seta dimensiunea grupului de conexiuni, ex. `...&maxPoolSize=20`. Prea puține conexiuni
   fac cererile să stea la coadă (navigarea între pagini pare înghețată cât timp se încarcă lista).
4. **Cache:** lista de plătitori se ține în memoria procesului 30 s (cererile simultane așteaptă același calcul),
   iar lista apelurilor din popup se calculează o dată la 2 s pentru toți utilizatorii.
5. Pe prima cerere după repornire, lista se citește de la zero — e normal să fie mai lentă o dată.
6. **Diagnostic:** conectat ca super-admin, deschide `/api/diag` (de mai multe ori, mai ales cât se încarcă o pagină lentă). Arată
   `eventLoopLagMs` (cât e blocat procesul Node: valori de sute de ms sau secunde = ceva consumă tot procesorul și TOATE cererile
   așteaptă), latența bazei de date, memoria și procesorul. Dacă latența bazei e mică (zeci de ms) dar apar blocaje, cauza e în Node, nu în rețea.
7. **Memorie pentru Node:** dacă `heapUsed` se apropie de `heapTotal` și apar pauze, pornește aplicația cu mai multă memorie, ex.
   `NODE_OPTIONS=--max-old-space-size=4096 npm run start`.
8. **Indexul nou pe facturi** (`clientId + issueDate`) se creează la `npm run db:push`; fără el lista de plătitori tot merge, dar mai lent.

## 11. „Salvez și nu se salvează" (acțiuni de formular blocate)

Salvările din formulare (Setări, tabele etc.) sunt „Server Actions" Next.js, care verifică ca antetul `Origin` să corespundă cu `Host`
(sau `X-Forwarded-Host`). Dacă proxy-ul (nginx) nu trimite `Host`, salvarea eșuează fără să se vadă nimic în pagină. Verifică în configurația nginx
(secțiunea 5) că există `proxy_set_header Host $host;` și `proxy_set_header X-Forwarded-Host $host;`. Eroarea apare în logul aplicației ca
„Invalid Server Actions request" / „x-forwarded-host does not match origin". Dacă adresa publică diferă de ce vede aplicația, adaugă domeniul în
`next.config.mjs` → `experimental.serverActions.allowedOrigins`.

**Semn că lipsește Chromium:** descărcarea PDF-ului unei facturi dă 500, iar `/api/invoice/public/<cod>/pdf` întoarce „Executable doesn't exist at …/ms-playwright/…”. Se rezolvă cu comanda de mai sus (apoi repornire).
