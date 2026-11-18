import { list, p, shot, steps, tip, warn, type ManualSection } from "./types";

/**
 * Manualul — partea 1: primii pași, cum primești notificări și munca de zi cu zi (dashboard, sarcini, cereri, programări, proiecte, Kanban, calendar, hartă, echipă).
 * Texte simple, scrise pentru oricine; fiecare `shot` e un loc pentru screenshot (cheie unică).
 */

export const SECTION_A: ManualSection[] = [
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "start",
    icon: "rocket",
    title: "Primii pași",
    intro: "Citește asta prima dată. Aici înveți ce este aplicația, cum intri în ea și cum arată ecranul. Nu trebuie să știi nimic dinainte.",
    pages: [
      {
        id: "ce-este",
        title: "Ce este această aplicație?",
        blocks: [
          p("Gândește-te la un caiet foarte mare și foarte deștept al firmei de apă și canal. În el scrii tot: cine are o problemă, cine trebuie să o rezolve, cine nu a plătit factura, ce număr arată contorul de apă al fiecărei case."),
          p("Pe acest caiet lucrează mai mulți oameni în același timp. Fiecare vede doar ce are voie să vadă; administratorii hotărăsc cine are voie să facă ce. De aceea acest manual îți arată doar paginile la care ai acces."),
          list(
            [
              "Sarcini și cereri: lucruri de făcut, cu cineva responsabil și un termen.",
              "Plătitori și clienți: oamenii și firmele care folosesc apa, cu facturile și datoriile lor.",
              "Contoare: numerele de pe contoarele de apă, citite lunar de cititori.",
              "Notificări: mesaje trimise automat prin email, SMS, apel sau Telegram.",
              "Facturile și datele vin din 1C (programul de contabilitate), iar aplicația le păstrează la zi.",
            ],
            "Ce găsești înăuntru:",
          ),
          tip("Nu-ți fie teamă să apeși pe butoane ca să vezi ce fac. Aproape orice faci se poate corecta, iar acțiunile importante cer mai întâi să confirmi."),
        ],
      },
      {
        id: "intrare",
        title: "Cum intri în aplicație (login)",
        path: "/login",
        blocks: [
          steps([
            "Deschide adresa aplicației în Chrome sau Edge (adresa ți-o dă colegul care a instalat-o).",
            "Scrie adresa ta de email în primul câmp.",
            "Scrie parola în al doilea câmp. Dacă vrei să vezi ce ai scris, apasă pe pictograma cu ochi.",
            "Apasă butonul de intrare. Dacă totul e bine, vezi pagina de pornire.",
          ]),
          shot("start-login", "Deschide adresa aplicației într-o fereastră nouă, fără să fii intrat în cont (sau după „Ieșire”). Fă screenshot la pagina cu email și parolă.", "Pagina de intrare, cu câmpurile pentru email și parolă."),
          steps(
            [
              "Dacă ai activat autentificarea în doi pași, aplicația îți cere încă un cod din 6 cifre.",
              "Deschide pe telefon aplicația de coduri (de exemplu Google Authenticator).",
              "Scrie codul pe care îl vezi acolo și apasă „Continuă”. Codul se schimbă la fiecare jumătate de minut.",
            ],
            "Dacă îți cere un cod:",
          ),
          warn("Dacă ai greșit parola de mai multe ori la rând, aplicația te oprește pentru scurt timp, ca să nu ghicească altcineva parola. Așteaptă puțin și încearcă din nou. Dacă ai uitat parola, un administrator ți-o poate schimba din pagina Utilizatori."),
          tip("Parola trebuie să aibă cel puțin 6 caractere. Folosește una pe care o ții minte, dar pe care alții nu o ghicesc."),
        ],
      },
      {
        id: "ecran",
        title: "Cum arată ecranul",
        blocks: [
          p("Ecranul are trei părți mari. Dacă le știi pe acestea, nu te mai pierzi."),
          list([
            "Meniul din stânga: lista tuturor paginilor. Apeși pe un nume și se deschide pagina. Vezi doar paginile la care ai voie.",
            "Bara de sus: aici sunt limba (RO / EN / RU), butonul cu microfon (poți spune o sarcină cu vocea), clopoțelul cu notificări și butonul pentru tema luminoasă sau întunecată.",
            "Mijlocul: pagina pe care ai deschis-o. Aici lucrezi.",
          ]),
          shot("start-ecran", "Intră în pagina Dashboard (meniul din stânga → Dashboard). Fă screenshot la TOT ecranul, ca să se vadă meniul din stânga, bara de sus și mijlocul paginii.", "Ecranul aplicației, cu meniul din stânga, bara de sus și mijlocul paginii."),
          p("Pe telefon meniul din stânga se ascunde, iar jos apare o bară cu cinci butoane rapide. Pe ele le alegi tu (vezi pagina Setări, mai jos)."),
          shot("start-telefon", "Deschide aplicația pe telefon. Fă screenshot (butonul de pornire + butonul de volum în jos) la pagina Dashboard, ca să se vadă bara de jos cu butoane.", "Aplicația pe telefon, cu bara de jos cu butoane rapide."),
          tip("Aproape toate tabelele merg la fel: sus sunt filtrele (butonul „Filtre” le arată sau le ascunde), la mijloc lista, iar jos paginile. Când ai învățat un tabel, le știi pe toate."),
        ],
      },
      {
        id: "tabele",
        title: "Cum folosești un tabel (la fel peste tot)",
        blocks: [
          steps([
            "Apasă pe butonul „Filtre” ca să vezi sau să ascunzi filtrele. Dacă ai pus un filtru, lângă buton apare un număr.",
            "Scrie în căsuța de căutare ca să găsești repede un nume, un telefon sau o adresă.",
            "Apasă pe numele unei coloane ca să sortezi lista (a doua apăsare întoarce ordinea).",
            "Apasă pe un rând ca să vezi detaliile lui.",
            "Pentru a goli toate filtrele, apasă „Resetează filtrele”.",
            "Cu butonul „Export” descarci lista (cu filtrele puse) într-un fișier pe care îl deschizi în Excel.",
          ]),
          shot("start-tabel", "Intră în meniul din stânga → Clienți. Apasă „Filtre” ca să se vadă. Fă screenshot la tabel împreună cu filtrele de deasupra.", "Un tabel cu filtre sus, lista la mijloc și paginile jos."),
          tip("Poți ascunde sau arăta coloane și le poți lărgi cu mouse-ul. Aplicația ține minte alegerea ta pe calculatorul tău."),
        ],
      },
      {
        id: "instalare",
        title: "Instalează aplicația pe calculator sau pe telefon",
        path: "/settings",
        blocks: [
          p("Poți avea aplicația ca un program obișnuit, cu pictogramă proprie, fără să deschizi de fiecare dată browserul. Se și actualizează singură."),
          steps([
            "Deschide meniul din stânga → Setări. Rămâi pe fila „Contul meu”.",
            "Caută cardul „Instalează aplicația”.",
            "Apasă „Descarcă / instalează aplicația”. Apare o fereastră mică a browserului: confirmă.",
            "Gata. Pictograma apare în meniul Start și pe desktop.",
          ]),
          shot("start-instalare", "Meniul din stânga → Setări → fila „Contul meu”. Fă screenshot la cardul „Instalează aplicația”.", "Cardul „Instalează aplicația” din Setări."),
          list(
            [
              "Android (Chrome): butonul instalează direct.",
              "iPhone: se face manual. Deschide site-ul în Safari, apasă pătratul cu săgeată (Partajare), apoi „Adaugă pe ecranul principal”.",
              "Firefox pe calculator nu poate instala aplicații. Folosește Chrome sau Edge.",
            ],
            "Pe fiecare dispozitiv:",
          ),
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "notificari",
    icon: "bell",
    title: "Cum primești notificări",
    intro: "Aplicația te anunță când se întâmplă ceva important: ți s-a dat o sarcină, a venit o cerere, se apropie un termen. Poți primi anunțul în mai multe feluri. Le poți folosi pe toate odată.",
    pages: [
      {
        id: "notif-clopot",
        title: "Clopoțelul din aplicație",
        path: "/notificari",
        blocks: [
          p("Clopoțelul este în bara de sus. Când ai notificări necitite, pe el apare un număr roșu. Apasă pe el și vezi lista."),
          steps([
            "Apasă pe clopoțel (sus, în dreapta).",
            "Apasă pe o notificare: se deschide direct sarcina, cererea sau pagina despre care e vorba.",
            "Ca să le marchezi pe toate drept citite, apasă „Toate citite”.",
            "Ca să cureți lista, apasă „Șterge citite”.",
          ]),
          shot("notif-clopot", "Fă screenshot în bara de sus, cu clopoțelul care are un număr roșu (dacă nu ai notificări noi, cere unui coleg să-ți dea o sarcină și revino).", "Clopoțelul cu numărul de notificări necitite."),
          p("Pentru lista completă, deschide pagina Notificări. Acolo poți căuta într-o notificare, poți filtra și poți alege câte să se vadă pe pagină. Lista se actualizează singură, fără să dai refresh."),
          shot("notif-pagina", "Apasă pe clopoțel și alege să vezi toate notificările (adresa /notificari). Fă screenshot la lista cu notificări.", "Pagina Notificări, cu lista și filtrele."),
          tip("Notificările în aplicație se păstrează 14 zile, apoi se șterg singure."),
        ],
      },
      {
        id: "notif-push",
        title: "Notificări pe ecran (push), chiar când aplicația e închisă",
        path: "/settings",
        blocks: [
          p("Acestea sunt mesajele mici care apar în colțul ecranului sau pe telefon, chiar dacă nu ai aplicația deschisă. Le pornești o singură dată, pe fiecare dispozitiv."),
          steps([
            "Deschide Setări (meniul din stânga) și rămâi pe fila „Contul meu”.",
            "Caută cardul „Notificări (PWA)”.",
            "Apasă „Activează notificările”.",
            "Browserul întreabă dacă permiți notificările. Apasă „Permite”.",
            "Apasă „Trimite test”. Trebuie să-ți apară un mesaj mic. Dacă l-ai văzut, e totul bine.",
          ]),
          shot("notif-push", "Meniul din stânga → Setări → fila „Contul meu”. Derulează până la cardul „Notificări (PWA)”. Fă screenshot la card.", "Cardul „Notificări (PWA)”, cu butonul „Activează notificările”."),
          warn("Dacă ai apăsat din greșeală „Blochează”, browserul nu te mai întreabă. Apasă pe lăcățelul din bara de adrese, găsește „Notificări” și schimbă în „Permite”."),
          tip("Dacă aplicația e instalată (vezi „Instalează aplicația”), pe pictograma ei apare și numărul de notificări necitite, ca pe telefon."),
        ],
      },
      {
        id: "notif-telegram",
        title: "Pe Telegram",
        path: "/telegram",
        blocks: [
          p("Telegram este aplicația de mesaje de pe telefon. Aplicația are un „robot” (bot) cu care vorbești ca și cu un prieten: îți trimite notificări și poți să-i dai comenzi."),
          steps([
            "Deschide meniul din stânga → Telegram.",
            "Urmează pașii de pe pagină: apeși pe linkul de conectare, se deschide Telegram, apeși „Start”.",
            "De acum, botul îți trimite notificările tale. Poți scrie și comenzi, de exemplu pentru programările de azi sau de mâine.",
          ]),
          shot("notif-telegram", "Meniul din stânga → Telegram. Fă screenshot la pagina cu pașii de conectare a botului.", "Pagina Telegram, cu pașii de conectare."),
          list(
            [
              "Azi / Mâine / Săptămâna: îți listează programările.",
              "Confirmă / Finalizat / Anulează: butoane direct în mesaj.",
              "Poți trimite și un mesaj vocal pentru o programare, cu confirmare.",
            ],
            "Ce poți face din Telegram:",
          ),
          shot("telegram-1", "Meniul din stânga → Telegram. Fă screenshot la pagină, cu comenzile rapide ale botului.", "Pagina Telegram, cu comenzile botului."),
          tip("Dacă un administrator știe deja numărul tău Telegram, îl poate pune direct la pagina Utilizatori, la contul tău. Atunci nu mai ai nevoie de link."),
        ],
      },
      {
        id: "notif-email",
        title: "Pe email",
        blocks: [
          p("Unele anunțuri vin și pe email, la adresa cu care ai intrat în aplicație. Emailurile pleacă de la adresa firmei. Nu trebuie să faci nimic ca să le primești, dar uită-te și în dosarul „Spam” dacă nu apar."),
          p("Același lucru se întâmplă cu clienții: ei pot primi email sau SMS de la firmă (vezi mai jos paginile Notificări plătitori și Setări → Cereri și notificări)."),
        ],
      },
      {
        id: "notif-ore",
        title: "Ore liniștite: noaptea nu te deranjează nimeni",
        perm: "admin",
        path: "/settings?tab=company",
        who: "Doar administratorii",
        blocks: [
          p("Dacă nu vrei mesaje noaptea, setezi ore liniștite. În acest interval botul nu răspunde, iar reamintirile sunt oprite."),
          steps([
            "Meniul din stânga → Setări → fila „Companie”.",
            "Derulează până la secțiunea „Ore liniștite”.",
            "Bifează opțiunea, alege ora de început (de exemplu 22:00) și ora de sfârșit (de exemplu 07:00) și salvează.",
          ]),
          shot("notif-ore", "Meniul din stânga → Setări → fila „Companie”. Derulează până la secțiunea „Ore liniștite” și fă screenshot la ea.", "Secțiunea „Ore liniștite” din Setări."),
        ],
      },
      {
        id: "notif-ce",
        title: "Ce notificări primește fiecare om",
        perm: "users.manage",
        path: "/users",
        who: "Doar administratorii",
        blocks: [
          p("Nu toată lumea trebuie să știe tot. Tu hotărăști, pentru fiecare om, despre ce evenimente să fie anunțat."),
          steps([
            "Meniul din stânga → Utilizatori.",
            "Apasă pe numele omului (sau pe butonul de editare).",
            "Caută zona de notificări. Un angajat primește mereu notificările care îl privesc direct (sarcinile lui).",
            "La un administrator, alegi ce tipuri de evenimente vrea să primească și de la ce echipe sau persoane.",
            "Salvează.",
          ]),
          shot("notif-ce", "Meniul din stânga → Utilizatori → apasă pe un utilizator ca să se deschidă fereastra de editare. Derulează la zona cu notificările. Fă screenshot.", "Fereastra de editare a unui utilizator, la zona de notificări."),
          warn("Dacă lași „Niciun tip bifat” la un administrator, el primește TOATE tipurile. Dacă alegi „Doar anumite echipe / persoane” și nu alegi pe nimeni, nu primește nimic."),
        ],
      },
      {
        id: "notif-remindere",
        title: "Remindere: aplicația îți amintește singură",
        blocks: [
          p("La o sarcină, o cerere sau o programare poți cere un reminder, ca aplicația să-ți amintească la timp. Alegi când: o singură dată, în fiecare zi, în fiecare săptămână, în fiecare lună sau la un interval ales de tine."),
          steps([
            "Deschide formularul sarcinii (sau cererii, sau programării).",
            "Caută zona „Reminder”.",
            "Alege data și ora, sau felul de repetare.",
            "Salvează. La ora aleasă primești notificarea (în aplicație, pe ecran, pe Telegram sau pe email, după ce ai pornit fiecare).",
          ]),
          shot("notif-remindere", "Meniul din stânga → Sarcini → butonul pentru sarcină nouă. În formular, derulează la zona „Reminder”. Fă screenshot la formular, cu zona vizibilă.", "Formularul unei sarcini, cu zona de reminder."),
          tip("Același sistem de remindere se folosește și la notificările trimise plătitorilor: acolo se numește „Programează trimiterea”."),
        ],
      },
      {
        id: "notif-nu-vin",
        title: "Nu-mi vin notificări. Ce fac?",
        blocks: [
          list(
            [
              "Verifică dacă ai pornit tipul de notificare dorit (clopoțel merge mereu; push, Telegram și email trebuie pornite).",
              "Pe push: Setări → „Contul meu” → „Trimite test”. Dacă nu apare nimic, verifică permisiunea browserului.",
              "Pe Telegram: apasă „Start” în conversația cu botul și revino la pagina Telegram.",
              "Verifică orele liniștite (poate e noapte în setările tale).",
              "Cere unui administrator să verifice la pagina Utilizatori ce evenimente ai primi.",
              "Un administrator poate vedea ce a trimis aplicația la pagina „Jurnal notificări” (vezi mai jos): acolo se vede dacă mesajul a plecat sau a eșuat și de ce.",
            ],
            "Încearcă în ordine:",
          ),
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "zi-de-zi",
    icon: "list",
    title: "Munca de zi cu zi",
    intro: "Paginile pe care le folosești cel mai des: ce ai de făcut, ce a cerut cineva, cine vine la program, ce proiecte sunt în lucru.",
    pages: [
      {
        id: "dashboard",
        title: "Dashboard: privirea de ansamblu",
        perm: "dashboard.view",
        path: "/dashboard",
        blocks: [
          p("Dashboard este prima pagină. Imaginează-ți tabloul de bord al unei mașini: dintr-o privire vezi dacă totul e bine. Aici vezi câte sarcini și cereri sunt deschise, câte sunt ale tale, câte proiecte sunt active."),
          list(
            [
              "Cifrele de sus: sarcini deschise, cereri deschise, ale tale în lucru, în verificare, proiecte active. Apasă pe o cifră ca să vezi lista din spatele ei.",
              "Lista de sub cifre: sarcinile active. Poți alege „Ale mele” sau „Toate”.",
              "Filtrele: prioritate, sortare după termen (cele mai apropiate sau cele mai îndepărtate).",
              "Butonul „+” (jos, în dreapta) creează repede o sarcină.",
            ],
          ),
          shot("dash-1", "Meniul din stânga → Dashboard. Fă screenshot la toată pagina, de sus până jos, cu cifrele și lista.", "Dashboard, cu cifrele de sus și lista de sarcini."),
          tip("Dacă pagina arată goală, probabil nu ai nicio sarcină activă. Apasă „+” ca să creezi una."),
        ],
      },
      {
        id: "sarcini",
        title: "Sarcini: lucruri de făcut",
        perm: "tasks.view",
        path: "/tasks",
        blocks: [
          p("O sarcină este un lucru de făcut: „repară țeava de pe strada X”, „sună clientul Y”. Fiecare sarcină are un titlu, un responsabil (cine o face), un termen (până când) și o prioritate (cât de urgentă e)."),
          list(
            [
              "Nou → Asignat → Citit → În lucru → Verificare → Finalizat. Pe parcurs mai poate fi „În așteptare” sau „Anulat”.",
              "Prioritatea: Scăzută, Medie, Ridicată, Urgent.",
            ],
            "Cum se schimbă starea unei sarcini:",
          ),
          steps(
            [
              "Meniul din stânga → Sarcini.",
              "Apasă pe butonul pentru sarcină nouă (sau pe „+”).",
              "Scrie titlul. Alege cine o face (un om sau o echipă) și termenul.",
              "Alege plătitorul SAU clientul (căsuțele au sugestii: scrii câteva litere și apar numele). Dacă clientul nu există, apasă „+” lângă „Client” și îl creezi pe loc: apare imediat în listă.",
              "Dacă e legată de un proiect, alege proiectul. Dacă proiectul nu există, apasă „+” lângă el și scrii numele.",
              "Poți adăuga o adresă, o descriere, fișiere sau poze și un reminder.",
              "Apasă „Salvează”. Sarcina apare în listă, iar responsabilul primește notificare.",
            ],
            "Cum creezi o sarcină:",
          ),
          shot("sarcini-lista", "Meniul din stânga → Sarcini. Fă screenshot la toată lista, cu filtrele de sus.", "Pagina Sarcini, cu lista și filtrele."),
          shot("sarcini-noua", "În pagina Sarcini, apasă butonul pentru sarcină nouă. Fă screenshot la fereastra de creare, cu câmpurile vizibile.", "Fereastra de creare a unei sarcini."),
          steps(
            [
              "Apasă pe un rând din listă ca să deschizi sarcina.",
              "Vezi detaliile, comentariile și fișierele atașate. Poți scrie un comentariu.",
              "Schimbă starea (de exemplu „În lucru”). La sfârșit alegi „Finalizat”. Unele sarcini cer o poză sau un fișier la finalizare.",
            ],
            "Cum lucrezi la o sarcină:",
          ),
          shot("sarcini-detalii", "Apasă pe o sarcină din listă ca să se deschidă. Fă screenshot la pagina sarcinii, cu detaliile și comentariile.", "Pagina unei sarcini, cu detalii, stare și comentarii."),
          list(
            [
              "Butonul „Filtre”: caută după stare, persoană, echipă, proiect, client, categorie, termen. Există și filtrul „Adresă repetată”, care arată sarcinile ce se repetă la aceeași adresă.",
              "„Ale mele / Create de mine / Toate”: alegi a cui listă o vezi.",
              "Poți schimba direct în tabel responsabilul, starea sau proiectul, apăsând pe celulă.",
              "Poți colora un rând, ca să-l vezi mai ușor.",
              "„Export” și „Import” (dacă ai drept): descarci sau încarci liste în Excel.",
              "Șabloane: sarcini care se repetă se pot face dintr-un model gata, cu titlul și datele completate.",
            ],
            "Alte lucruri utile:",
          ),
          tip("Poți crea o sarcină și cu vocea: apasă butonul cu microfon din bara de sus și spune ce vrei."),
        ],
      },
      {
        id: "cereri",
        title: "Cereri: ce cer clienții",
        perm: "tickets.view",
        path: "/tickets",
        blocks: [
          p("O cerere este o problemă sau o rugăminte a unui client: „nu am apă”, „vreau contor nou”. Cererile arată ca sarcinile, dar au câteva lucruri în plus."),
          list([
            "Cererile pot veni din mai multe locuri: le creezi tu, le trimite clientul din portal sau vin pe email.",
            "Între tine și client există o conversație (chat) în cerere. Mesajele noi de la client sunt marcate, ca să nu le ratezi.",
            "La final se scriu „Măsurile luate” și se vede în cât timp s-a rezolvat cererea.",
            "Clientul poate lăsa o notă la final, ca să spună cât de mulțumit a fost.",
            "O cerere venită pe email, la care ai răspuns și clientul nu mai scrie, se închide singură după un număr de ore (se setează în Setări → Cereri și notificări; implicit 48 de ore).",
          ]),
          steps(
            [
              "Meniul din stânga → Cereri.",
              "Apasă pe butonul de cerere nouă. Scrie titlul și detaliile, alege clientul sau plătitorul și tipul serviciului (apă, canalizare sau ambele).",
              "Alege cine o rezolvă și termenul. Salvează.",
              "Deschide cererea, scrie în chat dacă trebuie să-i răspunzi clientului, schimbă starea pe parcurs.",
              "La final alegi „Finalizat” și scrii ce s-a făcut.",
            ],
            "Cum creezi și rezolvi o cerere:",
          ),
          shot("cereri-lista", "Meniul din stânga → Cereri. Fă screenshot la toată lista.", "Pagina Cereri, cu lista și filtrele."),
          shot("cereri-detalii", "Apasă pe o cerere din listă ca să se deschidă. Fă screenshot la pagina ei, cu chatul și starea.", "O cerere deschisă, cu chat și stare."),
          tip("Statusurile cererilor (numele, culorile, cine e anunțat) se pot schimba din Setări → Cereri și notificări."),
        ],
      },
      {
        id: "programari",
        title: "Programări: cine vine și când",
        perm: "appointments.view",
        path: "/appointments",
        who: "Vizibil după ce a fost activat; eticheta din meniu poate fi schimbată în Setări → Companie",
        blocks: [
          p("O programare este o întâlnire fixată pe oră: un client vine la ghișeu sau cineva merge la un client. Vezi programările pe zile, ca într-un agendă."),
          steps(
            [
              "Meniul din stânga → Programări.",
              "Alege cum vrei să vezi: Azi, Mâine, Săptămâna sau Listă.",
              "Pentru o programare nouă, apasă butonul de creare. Alege clientul, categoria, data, ora și cât durează (în minute).",
              "Poți scrie un mesaj sau detalii. Alege cine participă (o persoană sau o echipă).",
              "Alege remindere (când să fie anunțați), apoi salvează.",
            ],
          ),
          shot("progr-lista", "Meniul din stânga → Programări. Fă screenshot la pagină, cu programările zilei.", "Pagina Programări."),
          p("O programare trece prin stări: Nouă, Confirmată, Nu a venit (dacă omul nu s-a prezentat) și altele. Numărul de „Nu a venit” se ține la fiecare client."),
        ],
      },
      {
        id: "proiecte",
        title: "Proiecte: grupuri de sarcini",
        perm: "projects.view",
        path: "/projects",
        blocks: [
          p("Un proiect este o „mapă” mare care adună mai multe sarcini despre același lucru, de exemplu „Rețeaua nouă pe strada X”. Un proiect are un nume, un responsabil, o stare (activ, terminat…) și, dacă vrei, o locație pe hartă."),
          steps(
            [
              "Meniul din stânga → Proiecte.",
              "Apasă pe butonul de proiect nou. Scrie numele, alege responsabilul și, dacă e nevoie, locul pe hartă.",
              "Salvează. Acum, când creezi o sarcină, o poți lega de acest proiect.",
              "Apasă pe un proiect ca să-i vezi pagina: sarcinile lui, fișierele și harta.",
            ],
          ),
          shot("proiecte-lista", "Meniul din stânga → Proiecte. Fă screenshot la listă.", "Pagina Proiecte."),
          shot("proiecte-detalii", "Apasă pe un proiect ca să-i deschizi pagina. Fă screenshot la tot ce se vede (sarcini, fișiere, hartă).", "Pagina unui proiect."),
          tip("Poți crea un proiect nou direct din formularul unei sarcini, cu butonul „+” de lângă câmpul Proiect. Apare imediat în lista de proiecte."),
        ],
      },
      {
        id: "kanban",
        title: "Kanban: tabla cu coloane",
        perm: "kanban.view",
        path: "/kanban",
        blocks: [
          p("Kanban este o tablă cu coloane, câte una pentru fiecare stare: Nou, În lucru, Verificare, Finalizat. Fiecare sarcină este un cartonaș. Muți cartonașul dintr-o coloană în alta ca să schimbi starea, ca pe un perete cu bilețele."),
          steps(
            [
              "Meniul din stânga → Kanban.",
              "Ține apăsat pe un cartonaș și trage-l în altă coloană. Starea sarcinii se schimbă.",
              "Folosește filtrele de sus: persoană, echipă, proiect, client, termen.",
            ],
          ),
          shot("kanban-1", "Meniul din stânga → Kanban. Fă screenshot la toată tabla, cu coloanele.", "Tabla Kanban, cu coloane și cartonașe."),
          tip("Kanban arată doar primele sarcini. Pentru o căutare lungă, folosește pagina Sarcini."),
        ],
      },
      {
        id: "calendar",
        title: "Calendar",
        perm: "calendar.view",
        path: "/calendar",
        blocks: [
          p("Calendarul pune pe zile tot ce are termen: sarcini, cereri și programări. Vezi dintr-o privire ce ai de făcut luna aceasta."),
          steps(
            [
              "Meniul din stânga → Calendar.",
              "Alege vederea: Lună, Săptămână sau Zi. Butonul „Azi” te întoarce la ziua de azi.",
              "Alege ce vrei să vezi: Toate, Ale mele sau Create de mine, și tipurile (sarcini, cereri, programări).",
              "Apasă pe o zi ca să vezi ce e în ea.",
            ],
          ),
          shot("calendar-1", "Meniul din stânga → Calendar. Fă screenshot la calendarul lunii curente.", "Calendarul, cu sarcini, cereri și programări pe zile."),
        ],
      },
      {
        id: "harta",
        title: "Hartă",
        perm: "map.view",
        path: "/harta",
        blocks: [
          p("Harta arată pe un desen al orașului unde sunt proiectele (și, la anumite conturi, contoarele). Un punct pe hartă înseamnă un loc. Apasă pe punct ca să vezi despre ce e vorba."),
          steps(["Meniul din stânga → Hartă.", "Mută harta ținând apăsat. Mărește sau micșorează cu rotița mouse-ului sau cu cele două degete pe telefon.", "Apasă pe un punct pentru detalii."]),
          shot("harta-1", "Meniul din stânga → Hartă. Fă screenshot la hartă, cu câteva puncte vizibile.", "Harta, cu proiectele ca puncte."),
        ],
      },
      {
        id: "echipa",
        title: "Echipă: grupuri de oameni",
        perm: "teams.view",
        path: "/team",
        blocks: [
          p("O echipă este un grup de colegi, de exemplu „Aducțiune” sau „Evidență”. Când dai o sarcină unei echipe, o văd toți membrii ei."),
          steps(
            [
              "Meniul din stânga → Echipă.",
              "Apasă pe „+ Echipă nouă”, scrie numele și o descriere.",
              "Alege membrii din listă și salvează.",
              "Ca să schimbi o echipă, apasă pe ea, modifică și salvează. Pentru ștergere, apasă pe coșul de gunoi și confirmă.",
            ],
          ),
          shot("echipa-1", "Meniul din stânga → Echipă. Fă screenshot la lista de echipe.", "Pagina Echipă, cu lista echipelor și membrii."),
        ],
      },
    ],
  },
];
