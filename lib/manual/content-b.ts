import { gated, list, p, shot, steps, tip, warn, type ManualSection } from "./types";

/**
 * Manualul — partea 2: clienți și plătitori, notificările către ei, contoare și citiri, PBX și facturi.
 */

export const SECTION_B: ManualSection[] = [
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "oameni",
    icon: "users",
    title: "Clienți și plătitori",
    intro: "Două liste de oameni. Plătitorii sunt cei care primesc facturi de apă și canal (vin din 1C). Clienții sunt ceilalți oameni din caiet (cei care sună, vin la ghișeu, cer ceva).",
    pages: [
      {
        id: "clienti",
        title: "Clienți",
        perm: "clients.view",
        path: "/clients",
        blocks: [
          p("Aici ții persoanele care nu sunt (încă) plătitori: cineva care a sunat, un solicitant, un vecin. Pentru fiecare ții numele, telefonul, emailul, adresa și notițe."),
          steps(
            [
              "Meniul din stânga → Clienți.",
              "Apasă pe butonul de client nou. Scrie numele (obligatoriu), telefonul, adresa, emailul și, dacă vrei, o notiță.",
              "Apasă „Salvează”. Clientul apare imediat în listă.",
              "Ca să schimbi un detaliu, apasă direct pe celulă (nume, telefon, email, adresă, notițe), scrie și apasă Enter. Nu trebuie să deschizi nicio fereastră.",
              "Cu creionul deschizi fereastra completă; cu coșul de gunoi ștergi clientul (după confirmare).",
            ],
          ),
          shot("clienti-lista", "Meniul din stânga → Clienți. Fă screenshot la tabel, cu coloanele Client, Telefon, Email, Adresă și filtrele de sus.", "Pagina Clienți, cu coloana Adresă."),
          shot("clienti-nou", "În Clienți, apasă butonul de client nou. Fă screenshot la fereastră, cu câmpurile Nume, Telefon, Adresă, Email.", "Fereastra de creare a unui client."),
          list(
            [
              "Filtre: după contact (are telefon / email), absențe, ultima programare, Telegram, adresă.",
              "Căutarea găsește după nume, telefon, email, adresă sau notițe.",
              "Poți importa clienți dintr-un fișier Excel și îi poți exporta.",
              "Un apel venit pe telefon poate crea clientul singur: vezi pagina PBX.",
            ],
          ),
          tip("În Notificări (pagina „Notificări plătitori”) există fila „Clienți”: aceiași oameni din această listă, cărora le poți trimite mesaje."),
        ],
      },
      {
        id: "platitori",
        title: "Plătitori",
        perm: "payers.view",
        path: "/platitori",
        blocks: [
          p("Aici sunt toți cei care primesc facturi de apă și canal (aproximativ 19.000). Datele vin din 1C: nume, cont personal sau contract, adresă, facturi. Tabelul este rapid: filtrezi și cauți instant."),
          steps(
            [
              "Meniul din stânga → Plătitori.",
              "Apasă pe „Filtre” și alege ce te interesează (vezi lista de mai jos).",
              "Apasă pe un rând ca să deschizi fișa plătitorului: datele lui, facturile, contoarele, notițele, notificările primite.",
              "Pentru a descărca lista filtrată, apasă „Export”.",
            ],
          ),
          shot("platitori-lista", "Meniul din stânga → Plătitori. Apasă „Filtre” ca să se vadă. Fă screenshot la pagină, cu filtrele și primele rânduri.", "Pagina Plătitori, cu filtrele și lista."),
          shot("platitori-fisa", "În Plătitori, apasă pe un rând (alege un cont de test). Fă screenshot la fereastra cu datele plătitorului.", "Fișa unui plătitor."),
          list(
            [
              "Luna facturii: vezi factura unei luni anume, nu doar ultima.",
              "Factură în lună: „Fără factură în luna aleasă” arată cine nu a primit factură în luna respectivă. „Fără factură 2, 3, 4, 6 sau 12 luni la rând” arată cine nu a primit factură în fiecare dintre ultimele luni (seria se termină la luna aleasă). Luna curentă apare mereu în listă.",
              "Serviciu: doar apă, doar canalizare sau apă + canalizare (se vede și în fișă, la „Tipul de consumator”).",
              "Sold / Cu datorie / Fără datorie, și „Sold de la… până la…”.",
              "Datorie pe vechime: 1–3 luni, 3 luni–1 an, 1–3 ani, peste 3 ani (de când e prima factură neachitată).",
              "Contact: cine are email, telefon, amândouă sau niciunul.",
              "Notificat: cine a primit sau nu mesaje, pe ce canal și când.",
              "Contract, verificare metrologică, nereguli de contor, contor estimat sau LoRaWAN, consumatori noi și multe altele.",
            ],
            "Filtrele principale, pe înțelesul tuturor:",
          ),
          shot("platitori-filtre-factura", "În Plătitori, apasă „Filtre”. Alege în „Factură în lună” varianta „Fără factură 3 luni la rând”. Fă screenshot la zona de filtre cu opțiunea aleasă și rezultatul de sub ea.", "Filtrul „Fără factură N luni la rând” pe pagina Plătitori."),
          shot("platitori-filtre-datorii", "În Plătitori, apasă „Filtre”. Alege la „Datorie pe vechime” un interval. Fă screenshot la zona de filtre și la lista de sub ea.", "Filtrul „Datorie pe vechime” pe pagina Plătitori."),
          tip("Dacă ai selectat un filtru și vrei să trimiți mesaje celor din listă, treci în pagina Notificări: filtrele sunt aceleași și rămân puse."),
          p("Aceleași date, într-o formă pentru tipărit, se găsesc la „Decontare” din fișa plătitorului: o foaie cu ce s-a facturat și ce a plătit omul în timp."),
          shot("platitori-decontare", "Deschide fișa unui plătitor (Plătitori → click pe rând) și apoi „Decontare”. Fă screenshot la pagina decontării.", "Decontarea unui plătitor (situația plăților)."),
        ],
      },
      {
        id: "notificari-platitori",
        title: "Notificări plătitori: trimite mesaje",
        perm: "payers.view",
        path: "/notificari-platitori",
        who: "Cine are dreptul „Notificări” (trimitere)",
        blocks: [
          p("Aici trimiți mesaje către mulți oameni deodată: o reamintire de plată, un anunț de avarie, un aviz. Mesajul poate pleca prin email, SMS, apel telefonic automat sau ca document tipărit (PDF). În mesaj, aplicația completează singură numele, suma, factura pentru fiecare om."),
          p("Pagina are patru file, sus: Plătitori, Clienți, Programate și Jurnal notificări."),
...gated("payers.notify",
          steps(
            [
              "Meniul din stânga → Notificări (pagina „Notificări plătitori”).",
              "În fila „Plătitori” alege cui trimiți: pune filtre (de exemplu „Cu datorie”, „Datorie pe vechime”, „Fără factură 3 luni la rând”).",
              "Bifează oamenii din dreptul numelor, sau apasă „Selectează toți cei N din filtru”.",
              "Apasă „Trimite notificare”. Se deschide fereastra de mesaj.",
              "Alege canalele: Email, SMS, Apel sau PDF tipărit. Un canal e gri dacă nu ai selectat oameni cu email sau telefon valid, sau dacă serverul nu îl are pornit.",
              "Scrie mesajul sau alege un șablon (butoanele de sus). Cu butoanele cu variabile ({nume}, {suma}, {factura}, {scadenta}, {adresa}, {link}, {datorie_expirata}, {data}) îl faci personal pentru fiecare.",
              "Vezi previzualizarea: așa îl vede primul om din listă.",
              "Apasă „Continuă”, citește rezumatul și confirmă. Aplicația trimite și arată cât a mers: trimise, eșuate, sărite (de exemplu fără email).",
            ],
          ),
          shot("notif-pl-lista", "Meniul din stânga → Notificări. Fă screenshot la pagină, cu filele de sus (Plătitori, Clienți, Programate, Jurnal) și tabelul cu bife.", "Pagina Notificări plătitori."),
          shot("notif-pl-mesaj", "În Notificări, bifează 2–3 oameni de test și apasă „Trimite notificare”. Fă screenshot la fereastra de mesaj (canale, șabloane, mesaj, previzualizare).", "Fereastra de scriere a notificării."),
          warn("Un SMS costă bani și un apel durează. Verifică de două ori înainte de a trimite la mii de oameni. La rezumat vezi exact câte mesaje pleacă."),
          steps(
            [
              "În fereastra de mesaj, bifează „PDF (tipărit)”.",
              "Alege „Document oficial” (antet cu firma, număr și dată, destinatar în dreapta, titlu centrat, text la mijloc, semnătură jos) sau „Notificare simplă”.",
              "Scrie titlul (poate avea două rânduri) și textul documentului, sau alege un șablon salvat care are și foaie PDF.",
              "Completează funcția și numele semnatarului (aplicația le ține minte).",
              "Apasă „Previzualizează foaia primului plătitor” ca să vezi cum arată.",
              "Trimite: primești fișiere PDF, câte o foaie A4 pe plătitor. Le tipărești și le duci.",
            ],
            "Documentul tipărit (de exemplu un aviz de deconectare):",
          ),
          shot("notif-pl-pdf", "În fereastra de mesaj, bifează „PDF (tipărit)” și apasă „Previzualizează foaia primului plătitor”. Fă screenshot la PDF-ul deschis (se vede documentul oficial).", "Documentul oficial generat pentru un plătitor."),
          list(
            [
              "Antetul firmei, adresa, logo-ul, numele și adresa destinatarului, data și semnătura se completează singure.",
              "„Nr.” rămâne liber, ca să-l scrii la tipărire.",
              "În text poți scrie **îngroșat**, __îngroșat și subliniat__ și ~~cursiv~~. Un rând nou înseamnă paragraf nou.",
              "Dacă folosești des același text, apasă „Salvează ca șablon”: se păstrează titlul și textul foii. Data viitoare îl alegi cu un click.",
            ],
            "Ce trebuie să știi despre document:",
          ),
          steps(
            [
              "Fă totul ca pentru trimitere, dar în fereastra de mesaj bifează „Programează trimiterea”.",
              "Dă un nume programării (de exemplu „Reamintire lunară datorii”).",
              "Alege data și ora, sau repetarea: o dată, zilnic, săptămânal, lunar sau la interval.",
              "Apasă „Programează”. Mesajul nu pleacă acum, ci la timpul ales.",
            ],
            "Mesaje programate, care se repetă singure:",
          ),
          shot("notif-pl-programare", "În fereastra de mesaj, bifează „Programează trimiterea”. Fă screenshot la zona cu numele și alegerea datei sau repetării.", "Programarea unei notificări."),
          shot("notif-pl-programate", "În Notificări, apasă fila „Programate”. Fă screenshot la lista programărilor (cu coloanele „Următoarea”, „Ultima rulare”).", "Fila „Programate”."),
          list(
            [
              "Dacă ai ales „toți cei din filtru”, programarea salvează filtrul: la fiecare rulare, oamenii se recalculează. Dacă ai bifat oameni de mână, se trimite la cei bifați atunci.",
              "În fila „Programate” poți opri, porni, rula acum sau șterge o programare.",
              "PDF-ul tipărit nu se poate programa (se tipărește de un om).",
            ],
          ),
          p("Fila „Clienți” funcționează la fel, dar pentru oamenii din pagina Clienți (cei care nu sunt plătitori)."),
          shot("notif-pl-clienti", "În Notificări, apasă fila „Clienți”. Fă screenshot la lista de clienți cu bife.", "Fila „Clienți” din Notificări.")
          ),
                    p("Fila „Jurnal notificări” păstrează pentru totdeauna ce s-a trimis: cine, către cine, ce mesaj, pe ce canal și dacă a ajuns. Apasă pe un rând ca să vezi mesajul întreg. Și mesajele trimise din programări apar aici, cu numele programării."),
          shot("notif-pl-jurnal", "În Notificări, apasă fila „Jurnal notificări”. Fă screenshot la listă.", "Jurnalul notificărilor către plătitori."),
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "contoare",
    icon: "droplet",
    title: "Contoare și citiri",
    intro: "Contoarele de apă arată câți metri cubi s-au consumat. Lunar, cititorii merg la fiecare contor și scriu numărul. Din el se face factura.",
    pages: [
      {
        id: "contoare-lista",
        title: "Contoare",
        perm: "payers.view",
        path: "/contoare",
        who: "Cine vede plătitorii",
        blocks: [
          p("Lista tuturor contoarelor de apă. Contoarele de la aceeași adresă apar toate. Apasă pe un rând ca să vezi pagina contorului: citirile lui din fiecare lună, calculul consumului și cine e abonatul."),
          steps(["Meniul din stânga → Contoare.", "Folosește filtrele (inclusiv „Doar apă”, „Doar canalizare”, „Apă + canalizare”) și căutarea după număr, abonat sau adresă.", "Apasă pe un rând pentru detalii.", "Apasă „Export” ca să descarci lista."]),
          shot("contoare-lista", "Meniul din stânga → Contoare. Fă screenshot la tabel, cu filtrele de sus.", "Pagina Contoare."),
          shot("contoare-detalii", "Apasă pe un contor din listă ca să se deschidă pagina lui. Fă screenshot la pagină, cu citirile și calculul.", "Pagina unui contor."),
...gated("meters.manage",
          p("Pe unele contoare, indexul vine singur, fără cititor: sunt contoarele LoRaWAN (transmit prin radio). Administratorii le gestionează în pagina LoRaWAN (în Contoare, butonul dedicat). După activare, aplicația extrage indexurile singură în fiecare zi, la 23:30."),
          shot("contoare-lorawan", "Meniul din stânga → Contoare, apoi butonul pentru LoRaWAN (apare doar dacă ai dreptul de gestionare a contoarelor). Fă screenshot la pagina LoRaWAN.", "Pagina LoRaWAN.")
          ),
                  ],
      },
      {
        id: "citiri-teren",
        title: "Citiri teren: scrii indexul contorului",
        perm: "meters.read",
        path: "/contoare/citiri",
        who: "Cititorii (și administratorii)",
        blocks: [
          p("Aici lucrează cititorul. Merge la contor, scrie numărul de pe el (în metri cubi), face o poză a contorului și aplicația ia locația singură. Poza este obligatorie."),
          steps(
            [
              "Meniul din stânga → Citiri teren (pe telefon, butonul „Mod telefon” arată contoarele ca niște cartonașe, mai ușor de apăsat).",
              "Caută contorul după număr, adresă sau abonat. Cititorii cu rute atribuite văd doar contoarele rutelor lor.",
              "Apasă pe contor. Se deschide fereastra de citire.",
              "Scrie indexul (un număr întreg, fără virgulă), de exemplu 1234.",
              "Fă poza contorului (butonul de poză) și lasă telefonul să ia locația.",
              "Apasă „Salvează”. Dacă numărul pare greșit (mai mic decât luna trecută sau un consum neobișnuit), aplicația te întreabă dacă ești sigur.",
              "Dacă ai găsit o problemă (contor stricat, sigiliu rupt), alege tipul problemei și scrie o notă: apare în „Nereguli contoare”.",
            ],
          ),
          shot("citiri-lista", "Meniul din stânga → Citiri teren. Fă screenshot la pagină, cu bara de progres (câte contoare citite) și lista.", "Pagina Citiri teren."),
          shot("citiri-fereastra", "În Citiri teren, apasă pe un contor de test. Fă screenshot la fereastra de citire (index, poză, locație).", "Fereastra de citire a unui contor."),
          warn("Fără internet, citirile se salvează pe telefon și pleacă singure când revine internetul. Pagina arată un mesaj „Fără internet” și câte citiri așteaptă. Nu șterge datele browserului până nu au plecat."),
          steps(
            [
              "Sus, în dreptul lunii, sunt săgețile ‹ › și o listă cu ultimele 18 luni.",
              "Alege luna dorită. Pagina trece pe „Citite” și arată citirile lunii alese. Adresa paginii conține luna, deci o poți trimite unui coleg.",
              "Apasă „Înapoi la luna curentă” ca să revii.",
            ],
            "Cum vezi citirile lunii trecute (sau mai vechi):",
          ),
          shot("citiri-luna", "În Citiri teren, alege din lista de sus luna trecută. Fă screenshot la zona de sus (selectorul de lună și bannerul albastru-galben) și la primele rânduri.", "Citirile unei luni anterioare."),
          p("Filtrele se pun din butonul „Filtre”: după sursă (cititor, portal sau LoRaWAN), poză, stradă, localitate, rută, consum, perioadă și „De verificat” (consum neobișnuit, index mai mic decât cel anterior, citit departe de ultima locație)."),
          shot("citiri-filtre", "În Citiri teren, apasă „Filtre”. Fă screenshot la toate filtrele afișate.", "Filtrele din Citiri teren."),
        ],
      },
      {
        id: "citiri-1c",
        title: "Trimite citirile către 1C",
        perm: "meters.export",
        path: "/contoare/citiri",
        who: "Cine are dreptul „Export contoare și citiri teren”",
        blocks: [
          p("1C este programul de contabilitate, de unde se fac facturile. Citirile făcute de cititori, cele trimise de plătitori din portal și cele de la contoarele LoRaWAN trebuie să ajungă în 1C. Butonul „Trimite către 1C” le trimite."),
          steps(
            [
              "În Citiri teren, apasă „Trimite către 1C”. Se deschide o fereastră.",
              "Vezi ce se va trimite: câte documente și câte citiri, pe surse (cititor, portal, LoRaWAN). Sub ele vezi câte citiri nu pot fi trimise (de exemplu lipsește contul abonatului).",
              "Lasă bifat „Extrage mai întâi din 1C”, ca datele să fie la zi.",
              "Bifa „Trimite din nou toate citirile lunii” este pusă de la început: la fiecare apăsare pleacă toate citirile, nu doar cele noi. Debifeaz-o dacă vrei doar citirile noi sau corectate.",
              "Dacă ai pus filtre în pagină (sau ai ales o lună anterioară), apare caseta „Doar contoarele din lista filtrată”. Bifată, pleacă doar contoarele pe care le vezi: un contor filtrat înseamnă un contor trimis, mai multe contoare, mai multe trimise.",
              "Apasă „Trimite acum”. Aplicația trimite în loturi de câte 200 de documente, unul după altul, și arată progresul.",
            ],
          ),
          shot("citiri-1c", "În Citiri teren, apasă „Trimite către 1C”. Fă screenshot la toată fereastra, cu tabelul „De trimis acum”.", "Fereastra „Trimite către 1C”."),
          list(
            [
              "Un document înseamnă un abonat, o sursă și o zi. Un abonat cu mai multe contoare are un singur document, cu mai multe linii.",
              "Fiecare trimitere are un identificator (câmpul „lot”), iar primul document poartă „sterge_buffer”: 1C șterge ce era vechi și păstrează doar lotul nou.",
              "1C întoarce totalul din buffer-ul lui; aplicația verifică dacă totalul a crescut cu cât a trimis.",
              "„Testează conexiunea” trimite o listă goală și arată câte documente are 1C în buffer.",
              "„Jurnal trimiteri” păstrează fiecare rulare: câte documente (și câte citiri) s-au trimis, ce a confirmat 1C, ce a eșuat și de ce.",
            ],
            "Pe scurt, cum funcționează:",
          ),
          shot("citiri-1c-jurnal", "În fereastra „Trimite către 1C”, deschide „Jurnal trimiteri (ultimele)” și extinde un rând. Fă screenshot la jurnal.", "Jurnalul trimiterilor către 1C."),
          warn("Citirile estimate (calculate) nu le trimite aplicația: le calculează 1C. O citire pe care o ștergi aici rămâne în 1C dacă fusese deja trimisă: trebuie corectată și acolo."),
...gated("meters.manage",
          steps(
            [
              "Doar cine are dreptul de gestionare a contoarelor vede butoanele de ștergere.",
              "Pentru o citire: deschide contorul și apasă „Șterge citirea”, apoi confirmă.",
              "Pentru mai multe: pune filtrele (de exemplu „Citite” și sursa „Portal”) și apasă butonul roșu „Șterge citirile afișate (N)”. Confirmă, apoi scrie numărul de citiri, ca să nu ștergi din greșeală.",
            ],
            "Cum ștergi citiri făcute din greșeală sau de test:",
          ),
          shot("citiri-stergere", "În Citiri teren, pune filtrul „Citite”. Fă screenshot la zona de sus, cu butonul roșu „Șterge citirile afișate”.", "Butonul de ștergere a citirilor afișate.")
          ),
                    p("Butonul „Raport estimate” arată contoarele care au fost estimate N luni la rând (adică cititorul nu le-a citit în perioada aleasă)."),
        ],
      },
      {
        id: "nereguli",
        title: "Nereguli contoare",
        perm: ["payers.view", "meters.issues", "meters.manage"],
        path: "/contoare/nereguli",
        blocks: [
          p("O neregulă este o problemă găsită la un contor: contor defect, sigiliu rupt, curgere inversă, suspiciune de fraudă. O neregulă are un responsabil, un termen de rezolvare și o stare (deschisă sau rezolvată)."),
          steps(
            [
              "Meniul din stânga → Nereguli contoare.",
              "Vezi lista neregulilor. Cine face parte dintr-o secție vede neregulile secției lui.",
              "Apasă pe o neregulă: poți schimba responsabilul și termenul, poți scrie mesaje și o poți marca rezolvată.",
            ],
          ),
          shot("nereguli-lista", "Meniul din stânga → Nereguli contoare. Fă screenshot la lista neregulilor.", "Pagina Nereguli contoare."),
          p("Regulile (cine remediază, în câte zile, ce secție răspunde) se stabilesc în Setări → Cereri și notificări, la „Reguli pentru nereguli de contor”. Clienții pot fi anunțați automat când se apropie termenul."),
        ],
      },
      {
        id: "rute",
        title: "Rute de citire",
        perm: "meters.manage",
        path: "/admin/rute-citiri",
        who: "Cine are dreptul de gestionare a contoarelor",
        blocks: [
          p("O rută este lista de străzi și zone pe care le citește un cititor. Pe această pagină spui cine citește unde și vezi cât s-a citit față de plan."),
          steps(
            [
              "Meniul din stânga → Rute de citire.",
              "Creează o rută nouă: dă-i un nume, alege cititorul și zonele (sector din 1C, localitate sau stradă).",
              "Poți schimba ordinea rutelor cu săgețile. Prima rută ale cărei reguli se potrivesc unui contor îi devine ruta.",
              "Vezi, pe fiecare cititor, câte contoare a citit din câte avea de citit.",
            ],
          ),
          shot("rute-1", "Meniul din stânga → Rute de citire. Fă screenshot la pagină.", "Pagina Rute de citire."),
          tip("Un cititor cu rute atribuite vede în Citiri teren doar contoarele lui. Bifa „Toate rutele” îi arată pe toate."),
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "telefon-facturi",
    icon: "phone",
    title: "Telefon și facturi",
    pages: [
      {
        id: "pbx",
        title: "PBX: apelurile telefonice",
        perm: "pbx.view",
        path: "/pbx",
        who: "Cine are dreptul PBX",
        blocks: [
          p("PBX este centrala telefonică a firmei. Pagina arată cine a sunat, când, cât a durat și unde se poate asculta înregistrarea."),
          steps(
            [
              "Meniul din stânga → PBX.",
              "Vezi lista apelurilor. Poți căuta după număr, nume sau adresă (coloana Adresă apare pentru apelurile legate de un client).",
              "Apasă pe un apel ca să-l vezi sau să-l asculți, direct în pagină.",
              "Dacă apelantul nu e în aplicație, apasă „+ Client nou”: numărul și, dacă îl găsește în 1C, numele și adresa se completează singure. Apelul se leagă de client.",
              "Din apel poți crea o sarcină: adresa se completează singură.",
            ],
          ),
          shot("pbx-lista", "Meniul din stânga → PBX. Fă screenshot la lista apelurilor.", "Pagina PBX."),
          shot("pbx-popup", "Când se primește un apel (poți apela tu un număr de pe alt telefon), apare o fereastră mică în colț cu datele apelantului. Fă screenshot la ea.", "Fereastra apelului primit, cu datele clientului."),
          list(
            [
              "Filtrul „Adresă repetată” arată apelurile repetate de la aceeași adresă (util pentru avarii).",
              "„Apeluri de notificare”: când trimiți din Notificări canalul „Apel”, plătitorii ajung într-o coadă în PBX, gata de sunat.",
              "„Autoinformare”: de aici pornești apelurile automate către cei din coadă. Alegi cine sună, apeși „Sună”, iar robotul citește mesajul fiecărui plătitor. Starea apelurilor apare în tabel în câteva secunde.",
            ],
          ),
          warn("Dacă un număr există deja la un client, aplicația te anunță și îți oferă să legi apelul de el. Nu crea un client dublu."),
        ],
      },
      {
        id: "facturi",
        title: "Facturi",
        perm: "invoices.view",
        path: "/invoices",
        who: "Cine are dreptul „Facturi”",
        blocks: [
          p("Aici sunt facturile. Cele de apă și canal vin din 1C. Poți crea și facturi simple, pentru alte servicii."),
          steps(
            [
              "Meniul din stânga → Facturi.",
              "Sus vezi sumarul: câte sunt achitate, neachitate, restante. Apasă pe un număr ca să vezi doar acele facturi.",
              "Folosește filtrele: stare, tip, serviciu, sumă, monedă, lună.",
              "Apasă pe o factură ca să o deschizi. De aici o poți descărca în PDF sau trimite clientului prin link public.",
              "Pentru o factură nouă, apasă butonul de factură nouă, alege clientul, adaugă liniile și salvează.",
            ],
          ),
          shot("facturi-lista", "Meniul din stânga → Facturi. Fă screenshot la pagină, cu sumarul de sus și lista.", "Pagina Facturi."),
          shot("facturi-factura", "Apasă pe o factură din listă. Fă screenshot la factura deschisă.", "O factură deschisă."),
          steps(
            [
              "În Facturi, apasă butonul „Datorii pe vechime”.",
              "Se deschide o fereastră mare. Sus sunt patru casete: 1–3 luni, 3 luni–1 an, 1–3 ani, peste 3 ani. Apasă pe una ca să vezi oamenii din ea.",
              "Poți căuta după nume, cont, adresă sau telefon și poți cere o datorie minimă.",
              "Toți plătitorii cu datorie apar în listă. La unii, luna din coloana „Din luna” are semnul „≈”: înseamnă o estimare (datoria vine din 1C și nu s-a găsit o factură neachitată).",
              "Cu „Export CSV” descarci lista, cu „Vezi în Plătitori →” deschizi aceiași oameni în Plătitori, iar cu „Trimite notificare →” treci direct la trimiterea de mesaje.",
            ],
            "Raportul „Datorii pe vechime”:",
          ),
          shot("facturi-datorii", "În Facturi, apasă „Datorii pe vechime”. Fă screenshot la toată fereastra, cu cele patru casete și lista.", "Raportul „Datorii pe vechime”."),
          p("Șablonul facturii de apă și canal (antet, logo, texte, poziții) se schimbă într-un editor vizual din Setări (vezi mai jos)."),
        ],
      },
    ],
  },
];
