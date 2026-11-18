import { list, p, shot, steps, tip, warn, type ManualSection } from "./types";

/**
 * Manualul — partea 3: administrare (utilizatori, simulare, rapoarte, jurnale, Telegram, setări), portalul clienților și întrebări frecvente.
 */

export const SECTION_C: ManualSection[] = [
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "administrare",
    icon: "tools",
    title: "Administrare",
    intro: "Paginile pentru cei care conduc aplicația: cine are cont și ce poate face, ce s-a întâmplat în aplicație, rapoarte.",
    pages: [
      {
        id: "utilizatori",
        title: "Utilizatori: cine are cont și ce poate face",
        perm: "users.manage",
        path: "/users",
        who: "Cine are dreptul „Gestionare utilizatori”",
        blocks: [
          p("Fiecare om care lucrează în aplicație are un cont. Aici creezi conturi și alegi ce are voie să facă fiecare. Gândește-te la chei: dai fiecărui om cheile de la camerele de care are nevoie."),
          steps(
            [
              "Meniul din stânga → Utilizatori.",
              "Apasă pe butonul de utilizator nou. Scrie numele, emailul și o parolă (cel puțin 6 caractere).",
              "Alege un tip de utilizator (vezi mai jos) sau bifează drepturile pe rând.",
              "Salvează. Omul poate intra cu emailul și parola date.",
            ],
          ),
          shot("utilizatori-lista", "Meniul din stânga → Utilizatori. Fă screenshot la lista de utilizatori.", "Pagina Utilizatori."),
          shot("utilizatori-fereastra", "În Utilizatori, apasă pe un utilizator ca să se deschidă fereastra de editare. Fă screenshot la fereastră, cu tipurile și drepturile (poți face două poze dacă nu încape totul).", "Fereastra de editare a unui utilizator."),
          list(
            [
              "Cititor: doar pagina Citiri teren (indexuri, poze, locație, nereguli din rutele lui).",
              "Operator: sarcini, cereri, clienți, plătitori, notificări, programări, apeluri, fără administrare.",
              "Responsabil citiri: cititor + rutele de citire, planificat vs citit și neregulile contoarelor.",
              "Doar vizualizare: vede toate paginile, dar nu modifică nimic.",
              "Administrator: are acces la tot. Doar un administrator poate crea alt administrator.",
            ],
            "Tipurile de utilizator:",
          ),
          list(
            [
              "Dezactivat: omul nu mai poate intra, iar sesiunile lui se închid.",
              "Ce sarcini vede: toate, doar ale lui, sau ale unor echipe sau persoane.",
              "Telegram: numărul lui, dacă vrei să-l pui tu.",
              "Notificări (la administratori): ce evenimente primește și de la cine (vezi „Cum primești notificări”).",
              "„Personalizare tabele”: dacă îi dai dreptul, își poate schimba singur lățimile, culorile și mărimea textului în tabele.",
            ],
            "Alte opțiuni din fereastră:",
          ),
          warn("Nu da dreptul de administrator decât cui trebuie. Un administrator vede și poate face aproape orice."),
        ],
      },
      {
        id: "simulare",
        title: "Simulare login: vezi ce vede un coleg sau un client",
        perm: "users.impersonate",
        path: "/simulare",
        who: "Cine are dreptul „Simulare de login”",
        blocks: [
          p("Uneori un coleg spune „nu pot face asta”. Ca să înțelegi de ce, poți intra în contul lui și vedea exact ce vede el, fără să-i știi parola. Același lucru poți face cu portalul unui client."),
          steps(
            [
              "Meniul din stânga → Simulare login.",
              "Alege omul (angajat) sau clientul din lista de portal.",
              "Apasă pe buton. Vezi aplicația ca el. Sus apare o bandă care îți amintește că ești în simulare.",
              "Ca să te întorci în contul tău, apasă butonul de ieșire din simulare din bandă.",
            ],
          ),
          shot("simulare-1", "Meniul din stânga → Simulare login. Fă screenshot la pagină.", "Pagina Simulare login."),
          list(
            [
              "Simularea expiră singură după 6 ore.",
              "Tot ce faci în simulare apare în „Audit Logs” ca „Nume (simulat de tine)”.",
            ],
          ),
        ],
      },
      {
        id: "rapoarte",
        title: "Raport PDF: petiții și reclamații",
        perm: ["tickets.export", "tasks.export"],
        path: "/tasks",
        blocks: [
          p("Raportul arată câte petiții și reclamații privind serviciul s-au primit și cum au fost rezolvate, în forma formularului de raportare. Nu e o pagină separată: îl faci din lista de Sarcini sau din lista de Cereri, cu butonul „Export”."),
          steps(
            [
              "Deschide Sarcini (sau Cereri) din meniul din stânga.",
              "Pune filtrele din tabel: perioada, secția, echipa, responsabilul, statusul, căutarea. Raportul se face doar din rândurile care rămân în listă.",
              "Apasă butonul „Export”, sus, deasupra tabelului.",
              "În meniul care se deschide, jos, apasă „Raport PDF (petiții și reclamații)”.",
              "Raportul se deschide într-o filă nouă. De acolo îl poți descărca sau tipări. Dacă fila este blocată de browser, se descarcă singur.",
            ],
          ),
          shot("rapoarte-1", "Meniul din stânga → Sarcini (sau Cereri). Apasă „Export” și fă screenshot cu meniul deschis, să se vadă jos „Raport PDF (petiții și reclamații)”.", "Butonul „Export”, cu opțiunea „Raport PDF (petiții și reclamații)”."),
          tip("Filtrele alese în tabel apar scrise sus, în raport, ca să se știe pentru ce perioadă și ce rânduri a fost făcut."),
          p("Același meniu „Export” mai oferă lista din tabel ca Excel, CSV sau JSON, tot cu filtrele aplicate. Butonul apare doar celor care au dreptul de export la Sarcini / Cereri."),
        ],
      },
      {
        id: "audit",
        title: "Audit Logs: cine a făcut ce",
        perm: "super",
        path: "/admin/audit-logs",
        who: "Doar super-administratorii",
        blocks: [
          p("Jurnalul de audit este „camera de filmat” a aplicației. Păstrează cine, când și ce a modificat: o sarcină, un utilizator, o citire, un mesaj trimis. Este util când trebuie să afli de ce s-a schimbat ceva."),
          steps(["Meniul din stânga → Audit Logs.", "Caută după persoană, acțiune sau dată.", "Apasă pe un rând ca să vezi detaliile: ce era înainte și ce a devenit."]),
          shot("audit-1", "Meniul din stânga → Audit Logs. Fă screenshot la lista de acțiuni.", "Pagina Audit Logs."),
          tip("Aici apar și ștergerile de citiri, trimiterile către 1C și pozele puse în acest manual."),
        ],
      },
      {
        id: "jurnal-notificari",
        title: "Jurnal notificări: ce a trimis aplicația",
        perm: "super",
        path: "/admin/jurnal-notificari",
        who: "Doar super-administratorii",
        blocks: [
          p("Aici vezi toate mesajele pe care le-a trimis aplicația: emailuri, SMS-uri, mesaje Telegram, notificări în aplicație și push. Este locul în care verifici dacă un mesaj a plecat sau a eșuat, și de ce."),
          steps(["Meniul din stânga → Jurnal notificări.", "Caută după persoană sau tip.", "Apasă pe un rând: vezi mesajul și rezultatul."]),
          shot("jurnal-1", "Meniul din stânga → Jurnal notificări. Fă screenshot la lista de mesaje.", "Pagina Jurnal notificări."),
          list(
            [
              "Mesajele se păstrează 30 de zile (notificările în aplicație și push, 14 zile).",
              "Istoricul notificărilor către plătitori e permanent și se vede și în Notificări → fila „Jurnal notificări”.",
            ],
          ),
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "setari",
    icon: "sliders",
    title: "Setări",
    intro: "Aici faci aplicația „a ta” și o configurezi pentru firmă. Pagina are patru file, sus: Contul meu, Securitate, Companie și Cereri și notificări. Ultimele două sunt doar pentru administratori.",
    pages: [
      {
        id: "setari-cont",
        title: "Contul meu",
        path: "/settings",
        blocks: [
          p("Setările tale personale: cine ești, cum arată aplicația pentru tine, cum ești anunțat."),
          list(
            [
              "Profil: numele, emailul, numărul de Telegram.",
              "Preferințe: fusul orar, tema (luminoasă, întunecată sau a sistemului), limba (RO / EN / RU), începutul și sfârșitul zilei de lucru, remindere standard.",
              "Instalează aplicația: butonul de instalare pe calculator sau telefon.",
              "Notificări (PWA): pornești mesajele pe ecran.",
              "Butoane rapide pe telefon: alegi ce cinci pagini apar în bara de jos a telefonului.",
              "Telegram Bot: conectarea botului.",
            ],
          ),
          shot("setari-cont", "Meniul din stânga → Setări → fila „Contul meu”. Fă screenshot la toată pagina (poți face două poze, sus și jos).", "Setări → Contul meu."),
        ],
      },
      {
        id: "setari-securitate",
        title: "Securitate: parola și autentificarea în doi pași",
        path: "/settings?tab=security",
        blocks: [
          p("Autentificarea în doi pași înseamnă că pentru a intra ai nevoie de parolă ȘI de un cod din telefon. Chiar dacă cineva află parola, fără telefonul tău nu poate intra."),
          steps(
            [
              "Meniul din stânga → Setări → fila „Securitate”.",
              "Apasă „Activează autentificarea în doi pași”.",
              "Pe telefon, deschide o aplicație de coduri (Google Authenticator sau altă similară) și scanează codul QR de pe ecran. Dacă nu poți scana, scrie manual cheia afișată.",
              "Scrie codul din 6 cifre din aplicație și parola ta, apoi apasă „Confirmă și activează”.",
              "Salvează codurile de recuperare într-un loc sigur. Te ajută dacă pierzi telefonul. Fiecare cod se poate folosi o singură dată.",
            ],
          ),
          shot("setari-securitate", "Meniul din stânga → Setări → fila „Securitate”. Fă screenshot la pagină. Pe codul QR și pe codurile de recuperare pune un dreptunghi negru în Paint înainte de a încărca poza.", "Fila Securitate."),
          p("Tot aici vezi sesiunile active (pe ce dispozitive ești intrat) și poți închide toate celelalte sesiuni."),
        ],
      },
      {
        id: "setari-companie",
        title: "Companie",
        perm: "admin",
        path: "/settings?tab=company",
        who: "Doar administratorii",
        blocks: [
          p("Datele firmei, care apar pe facturi, pe emailuri și pe documentele tipărite (de exemplu avizele)."),
          list(
            [
              "Datele firmei: denumire, logo, telefon, email, adresă, cod fiscal, date bancare.",
              "Antetul facturilor de apă și canal: logo, nume, adresă, email, contacte, textele „Atenție” și „Anunț”.",
              "Tarifele implicite (apă și canalizare, lei/m³): se completează singure când creezi o factură nouă.",
              "Categoriile (pentru sarcini și cereri) și eticheta din meniu pentru „Programări”.",
              "Ore liniștite: în acest interval nu se trimit mesaje (le schimbă doar super-administratorul).",
            ],
          ),
          shot("setari-companie", "Meniul din stânga → Setări → fila „Companie”. Fă screenshot la pagină (două poze dacă e lungă).", "Setări → Companie."),
          warn("Când schimbi tarifele, aplicația îți propune să recalculeze și facturile deja emise, dar neachitate. Citește mesajul cu atenție înainte de a confirma."),
          steps(
            [
              "Din Setări, deschide „Șablon factură Apă-Canal”.",
              "Se deschide un editor vizual: tragi elementele de pe factură, le redimensionezi și îți ajustezi textul și liniile.",
              "Salvează. Noile facturi folosesc șablonul.",
            ],
            "Editorul facturii:",
          ),
          shot("setari-sablon-factura", "Setări → „Șablon factură Apă-Canal”. Fă screenshot la editorul vizual.", "Editorul șablonului facturii Apă-Canal."),
        ],
      },
      {
        id: "setari-flux",
        title: "Cereri și notificări",
        perm: "admin",
        path: "/settings?tab=workflow",
        who: "Doar administratorii",
        blocks: [
          p("Aici hotărăști cum se poartă aplicația cu cererile și cu mesajele automate."),
          list(
            [
              "Statusurile cererilor: numele, culorile și cine e anunțat la fiecare stare.",
              "Închiderea automată a cererilor venite pe email: după câte ore fără răspuns de la client se finalizează singure (implicit 48).",
              "Reguli pentru nereguli de contor: pentru fiecare tip, cine remediază, în câte zile și ce secție răspunde.",
              "Notificări automate către clienți: ce mesaje pleacă singure (contract, verificare metrologică, termen neregulă) și pe ce canal. SMS-ul costă bani, emailul nu: le poți porni separat.",
              "Mesajele automate pentru termenele neregulilor: poți schimba textele.",
            ],
          ),
          shot("setari-flux", "Meniul din stânga → Setări → fila „Cereri și notificări”. Fă screenshot la pagină (două poze dacă e lungă).", "Setări → Cereri și notificări."),
          steps(
            [
              "Din Setări, deschide „Conturi portal clienți”.",
              "Vezi cine și-a activat contul în portal și când s-a logat ultima dată.",
              "Poți reseta contul unui client dacă și-a pierdut parola.",
            ],
            "Conturile din portalul clienților:",
          ),
          shot("setari-portal", "Setări → „Conturi portal clienți”. Fă screenshot la listă.", "Conturile portalului clienților."),
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "portal",
    icon: "globe",
    title: "Portalul clienților",
    intro: "Clienții au propriul lor „colț” al aplicației, separat de al tău. Ca administrator trebuie să știi ce văd ei, ca să-i poți ajuta.",
    pages: [
      {
        id: "portal-ce",
        title: "Ce poate face un client în portal",
        perm: ["users.manage", "payers.view"],
        blocks: [
          list(
            [
              "Își creează cont folosind seria contorului (persoană fizică) sau numărul contractului (firmă) și confirmă pe email.",
              "Își vede facturile și situația plăților, descarcă factura în PDF.",
              "Trimite indexul contorului, cu poză. Citirea ajunge la tine ca „Portal”. Clientul primește un email ca să confirme că e corectă.",
              "Trimite cereri (probleme sau rugăminți) și vorbește cu tine în conversația cererii.",
              "Poate lăsa o notă la finalul unei cereri.",
            ],
          ),
          shot("portal-1", "Deschide portalul clienților (adresa de portal a aplicației) după intrare cu un cont de test. Fă screenshot la pagina de pornire a clientului.", "Portalul clientului."),
          tip("Ca să vezi exact ce vede un client, folosește „Simulare login” și alege clientul."),
          steps(
            [
              "Clientul spune că nu poate intra? Mergi în Setări → „Conturi portal clienți”.",
              "Caută clientul. Dacă nu și-a activat contul, spune-i să verifice emailul de confirmare (și dosarul Spam).",
              "Dacă și-a uitat parola, poate cere resetare din pagina de intrare a portalului, sau o poți reseta tu.",
            ],
            "Un client nu poate intra:",
          ),
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "intrebari",
    icon: "help",
    title: "Întrebări frecvente",
    pages: [
      {
        id: "faq",
        title: "Ce fac dacă…",
        blocks: [
          list(
            [
              "…nu văd o pagină? Probabil nu ai dreptul pentru ea. Cere unui administrator să-ți dea dreptul la pagina Utilizatori.",
              "…am făcut ceva greșit? Mulți pași se pot corecta. Dacă ai șters ceva, spune imediat unui administrator: jurnalul de audit arată ce s-a întâmplat.",
              "…o listă nu arată ce a apărut nou? Reîncarcă pagina (F5). Clienții și proiectele create dintr-un formular apar imediat în liste, fără reîncărcare.",
              "…un mesaj nu a ajuns la client? Deschide Notificări → Jurnal notificări (sau pagina Jurnal notificări) și vezi dacă a plecat și ce eroare a avut (de exemplu email invalid).",
              "…citirile nu apar în 1C? Deschide Citiri teren → Trimite către 1C → Jurnal trimiteri și citește ce a răspuns 1C.",
              "…vreau să arăt cuiva doar o parte din listă? Pune filtrele, apoi copiază adresa din browser. Filtrele sunt în adresă.",
              "…lucrez pe telefon și mi se pare mic? Folosește „Mod telefon” în Citiri teren și instalează aplicația.",
            ],
          ),
          tip("Când nu știi ce face un buton, ține mouse-ul deasupra lui câteva secunde: de cele mai multe ori apare o explicație scurtă."),
        ],
      },
    ],
  },
];
