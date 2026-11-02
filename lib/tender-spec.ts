/**
 * Caietul de sarcini (BD Contract 3 WSS Cahul Rural, secțiunea VII, 9.7.2.2 – 9.7.2.3 / 3.6): toate punctele, în engleză (ca în contract) și în română, cu locul din CRM unde se găsește fiecare.
 * Bifarea (făcut / nefăcut) se salvează în baza de date, comună pentru toată echipa (model TenderCheck). Id-urile sunt stabile: NU se reordonează / șterg puncte (ar muta bifările) — se adaugă la coadă.
 *
 * `status` = cât acoperă CRM-ul punctul (informativ, scris de noi; bifa e decizia echipei):
 *  done = implementat · partial = parțial · external = se face în 1C / în afara CRM · na = nu se aplică · todo = neimplementat.
 */

export type SpecStatus = "done" | "partial" | "external" | "na" | "todo";
export type SpecLink = { label: string; href: string };
export type SpecItem = {
  id: string;
  en: string;
  ro: string;
  status: SpecStatus;
  /** Unde se găsește / cum e implementat în sistem (română). */
  where: string;
  links?: SpecLink[];
};
/** Partea paginii: contractul propriu-zis, punctele „adiționale” din contract (licențe, funcționalități suplimentare) sau ce am adăugat noi peste contract. */
export type SpecPart = "contract" | "additional" | "ours";
export type SpecGroup = { id: string; part: SpecPart; code: string; titleEn: string; titleRo: string; introEn?: string; introRo?: string; items: Omit<SpecItem, "id">[] };

const L = {
  tickets: { label: "Cereri", href: "/tickets" },
  payers: { label: "Plătitori", href: "/platitori" },
  payersTable: { label: "Tabel 1C", href: "/platitori/tabel" },
  notify: { label: "Notificări către plătitori", href: "/notificari-platitori" },
  meters: { label: "Contoare", href: "/contoare" },
  field: { label: "Citiri teren", href: "/contoare/citiri" },
  issues: { label: "Nereguli contoare", href: "/contoare/nereguli" },
  lorawan: { label: "LoRaWAN", href: "/contoare/lorawan" },
  routes: { label: "Rute de citire", href: "/admin/rute-citiri" },
  pbx: { label: "PBX", href: "/pbx" },
  invoices: { label: "Facturi", href: "/invoices" },
  clients: { label: "Clienți", href: "/clients" },
  tasks: { label: "Sarcini", href: "/tasks" },
  settings: { label: "Setări", href: "/settings" },
  portalAccounts: { label: "Conturi portal", href: "/settings/portal-accounts" },
  simulate: { label: "Simulare portal", href: "/simulare" },
  deliveryLog: { label: "Jurnal notificări", href: "/admin/jurnal-notificari" },
  map: { label: "Hartă", href: "/harta" },
  dashboard: { label: "Dashboard", href: "/dashboard" },
  kanban: { label: "Kanban", href: "/kanban" },
  calendar: { label: "Calendar", href: "/calendar" },
  projects: { label: "Proiecte", href: "/projects" },
  team: { label: "Echipe", href: "/team" },
  appointments: { label: "Programări", href: "/appointments" },
  telegram: { label: "Telegram", href: "/telegram" },
  users: { label: "Utilizatori", href: "/users" },
  audit: { label: "Audit Logs", href: "/admin/audit-logs" },
  layout: { label: "Șablon factură", href: "/settings/apa-canal-layout" },
} satisfies Record<string, SpecLink>;

export const SPEC_GROUPS: SpecGroup[] = [
  {
    id: "lic",
    part: "additional",
    code: "9.7.2.2",
    titleEn: "Additional Software Licences",
    titleRo: "Licențe software suplimentare",
    introEn: "The Beneficiary (ACC) is directly responsible for the procurement of updated enterprise software licences; the Bidder offers them separately.",
    introRo: "Beneficiarul (ACC) răspunde direct de achiziția licențelor software actualizate; ofertantul le oferă separat.",
    items: [
      { en: "2.1. Windows Server CAL Lic (20 users) or comparable", ro: "2.1. Licență Windows Server CAL (20 utilizatori) sau echivalent", status: "external", where: "Licență de infrastructură, nu funcție a CRM-ului. CRM-ul rulează în browser (Next.js + MongoDB) și nu cere CAL Windows." },
      { en: "2.2. SQL Server Licence (20 users) or comparable", ro: "2.2. Licență SQL Server (20 utilizatori) sau echivalent", status: "external", where: "Licență a bazei de date 1C / facturare, în afara CRM-ului. CRM-ul folosește MongoDB (fără licență SQL Server)." },
      { en: "2.3. Anti-Virus Software for Server, PCs and Mobile Devices, e.g. Bitdefender GravityZone Business Security – GOV or comparable", ro: "2.3. Software antivirus pentru server, PC-uri și dispozitive mobile, de ex. Bitdefender GravityZone Business Security – GOV sau echivalent", status: "external", where: "Licență de securitate a stațiilor, în afara CRM-ului. Securitatea aplicației (parole scrypt, TOTP, CSP, alertă la dispozitiv nou) e în CRM — vezi Setări → Securitate.", links: [L.settings] },
    ],
  },
  {
    id: "crm-core",
    part: "contract",
    code: "3.1 / 3.2",
    titleEn: "Customer Relationship Management (CRM) Module · Customer SMS and E-Mail Notifications — main components",
    titleRo: "Modulul CRM · Notificări SMS și e-mail pentru clienți — componente principale",
    introEn: "CRM component to be used by ACC to register customer requests (cerere) and complaints (petiti). Users shall have rights to view necessary information about the customer including contract, account status, key customer data and history.",
    introRo: "Componentă CRM folosită de ACC pentru înregistrarea cererilor (cerere) și a reclamațiilor (petiții) clienților. Utilizatorii au drept să vadă informațiile necesare despre client: contract, starea contului, date-cheie și istoric.",
    items: [
      { en: "A \"ticket system\" for registration of the customer requests and complaints", ro: "Un „sistem de tichete” pentru înregistrarea cererilor și a reclamațiilor clienților", status: "done", where: "Pagina Cereri: tichete create de personal, din portalul clientului (7 tipuri standard de cereri + petiție) sau din emailuri primite. Fiecare are număr, tip, adresă, consumator, responsabil și termen.", links: [L.tickets] },
      { en: "A \"ticket tracing\" system for easy follow up of the tickets", ro: "Un sistem de „urmărire a tichetelor” pentru monitorizare ușoară", status: "done", where: "Stări (Nou → Asignat → În lucru → Finalizat / Anulat), filtre și căutare în listă, jurnal de activitate, comentarii și conversație cu clientul în fiecare tichet.", links: [L.tickets] },
      { en: "Work Order creation with time stamp for the respective Department in charge of dealing with the request or complaint (e.g. in case of requesting a connection or complaints about technical faults, pipe breaks, water meter replacement, etc.)", ro: "Crearea unui ordin de lucru cu marcă de timp pentru secția responsabilă de rezolvarea cererii sau reclamației (de ex. cerere de branșare, defecțiuni tehnice, rupturi de conductă, schimbarea contorului etc.)", status: "done", where: "Tichetul se asignează unei echipe (secție) și / sau unui utilizator; există și tipul „Ordin de lucru”. Data și ora creării și ale fiecărei schimbări de stare se păstrează în jurnalul de activitate.", links: [L.tickets, L.tasks] },
      { en: "When Work Order is finished / closed (with time stamp), feedback to the CRM system to show status of request / complaint and reminder to answer customer", ro: "Când ordinul de lucru e finalizat / închis (cu marcă de timp), starea revine în CRM și se arată la cerere / reclamație, cu reamintire de a răspunde clientului", status: "done", where: "La închidere se completează „Măsuri luate”, timpul de rezolvare și data închiderii. Clientul e anunțat și poate lăsa o notă 1–5 în portal; reamintirile sarcinii merg prin aplicație, push și Telegram.", links: [L.tickets] },
      { en: "In addition, the CRM should include an application for sending notifications directly to the customer’s phone via SMS or messenger app, or through e-mail, e.g. regarding issuing the invoice (e-bill), invoice maturity, notice", ro: "În plus, CRM-ul trebuie să includă o aplicație pentru trimiterea de notificări direct pe telefonul clientului prin SMS sau aplicație de mesagerie ori prin e-mail, de ex. despre emiterea facturii (e-factură), scadența facturii, înștiințări", status: "done", where: "Notificări către plătitori (în masă sau individual) pe email / SMS, cu șabloane editabile și filtre; notificări automate (canale email / SMS) pentru contracte, verificări metrologice și nereguli; jurnal de livrare pentru fiecare mesaj.", links: [L.notify, L.deliveryLog] },
    ],
  },
  {
    id: "crm-info",
    part: "contract",
    code: "3.1",
    titleEn: "Customer Information Management",
    titleRo: "Gestionarea informațiilor despre clienți",
    items: [
      { en: "Ability to create, update and search customer data.", ro: "Posibilitatea de a crea, actualiza și căuta datele clienților.", status: "done", where: "Plătitorii (~19.000) se importă din 1C și se pot căuta și filtra instant (nume, cont, contract, adresă, telefon, email, sector, localitate). Clienții CRM se creează și se editează manual.", links: [L.payers, L.clients] },
      { en: "Ability to create, update and search account information related with customer. Account is considered a level on which invoicing takes place (i.e. there is one bill monthly per account, one customer can have several accounts billed independently).", ro: "Posibilitatea de a crea, actualiza și căuta informațiile contului clientului. Contul este nivelul la care se facturează (o factură lunară pe cont; un client poate avea mai multe conturi facturate independent).", status: "partial", where: "Un plătitor în CRM = un cont din 1C (cont personal / contract), cu facturile lui lunare. Conturile multiple ale aceluiași client apar ca plătitori separați; nu sunt grupate sub un singur „client” părinte.", links: [L.payers] },
      { en: "Ability to create, update and search contact information related with customer. Contact information can be specified on different levels (Customer, account).", ro: "Posibilitatea de a crea, actualiza și căuta informațiile de contact ale clientului, care pot fi specificate la niveluri diferite (client, cont).", status: "partial", where: "Telefon și email pe plătitor (din 1C sau completate de personal), cu filtre „Fără email / fără telefon”. Contactele separate pe client și pe cont nu există.", links: [L.payers] },
      { en: "Ability to define, update and search customer address information (on different levels – customer, account).", ro: "Posibilitatea de a defini, actualiza și căuta informațiile de adresă ale clientului (la niveluri diferite — client, cont).", status: "partial", where: "Adresa locului de consum din 1C pe plătitor și pe contor, cu căutare după stradă / localitate / sector; adresa unui contor fără adresă în 1C se poate completa din teren.", links: [L.payers, L.meters] },
      { en: "Ability to create, update and easy presentation of data classified by customer organizational hierarchy.", ro: "Posibilitatea de a crea, actualiza și prezenta ușor datele clasificate după ierarhia organizațională a clientului.", status: "partial", where: "Clasificare după sector (Участок din 1C), localitate, stradă, tip (persoană fizică / firmă) și sector privat / comunal, ca filtre în Plătitori și Contoare. Nu există un arbore de organizație al clientului.", links: [L.payers, L.meters] },
      { en: "Ability to search and present current and past customer’s contracts with the Company.", ro: "Posibilitatea de a căuta și prezenta contractele curente și anterioare ale clientului cu Compania.", status: "partial", where: "Numărul contractului și data expirării pe plătitor, cu notificări automate la 30 și 10 zile înainte de expirare. Istoricul contractelor anterioare nu se păstrează (doar cel curent din 1C).", links: [L.payers] },
      { en: "The ability to create information about the consumer's violation of the contractual provisions (to be displayed on the navigation surface).", ro: "Posibilitatea de a crea informații despre încălcarea prevederilor contractuale de către consumator (afișate în interfața de navigare).", status: "done", where: "Registrul „Nereguli contoare”: neregula (defect, sigiliu rupt, flux invers, fraudă etc.), responsabilul, secția și termenul de remediere. Neregulile deschise se văd și în fișa plătitorului.", links: [L.issues] },
      { en: "Possibility to create the ticket with indication of detected shortcomings and resolution deadlines for consumers who violate the contractual provisions.", ro: "Posibilitatea de a crea tichetul cu indicarea deficiențelor constatate și a termenelor de remediere pentru consumatorii care încalcă prevederile contractuale.", status: "done", where: "Fiecare neregulă are termen de remediere; cu 3 zile înainte și la depășire pleacă mesaje automate (email / SMS), cu text editabil. Se poate crea și o sarcină din fișa plătitorului.", links: [L.issues] },
      { en: "Ability to present information on resolved/unresolved violations.", ro: "Posibilitatea de a prezenta informații despre încălcările remediate / neremediate.", status: "done", where: "Registrul neregulilor arată deschise și rezolvate (cu filtre pe responsabil, secție, termen) și se poate exporta.", links: [L.issues] },
      { en: "Ability to search and easy presentation of current and past orders of the customer. Integration with Utility billing system.", ro: "Posibilitatea de a căuta și prezenta ușor comenzile curente și anterioare ale clientului. Integrare cu sistemul de facturare.", status: "partial", where: "Cererile clientului (tichete) și facturile din 1C se văd în fișa plătitorului. Facturile vin din 1C la fiecare sincronizare; „comenzile” ca obiect separat nu există.", links: [L.payers, L.tickets] },
      { en: "Ability to search and present the current and past trouble tickets of the customer.", ro: "Posibilitatea de a căuta și prezenta tichetele curente și anterioare ale clientului.", status: "done", where: "Cererile unui plătitor se văd din fișa lui și se filtrează în Cereri după client; clientul le vede în portal, la „Cererile mele”.", links: [L.tickets, L.payers] },
      { en: "Ability to search and present existing products/services related with customer.", ro: "Posibilitatea de a căuta și prezenta produsele / serviciile existente ale clientului.", status: "partial", where: "Serviciile (alimentare cu apă, canalizare) apar pe liniile facturii, iar contoarele clientului în Contoare / fișa plătitorului, cu volume și sume pe serviciu.", links: [L.meters, L.payers] },
      { en: "Ability to search and present an integrated view of customer billing information.", ro: "Posibilitatea de a căuta și prezenta o imagine integrată a informațiilor de facturare ale clientului.", status: "done", where: "Fișa plătitorului: ultima factură, sold, scadență, istoric facturi, decontare (PDF), contoare și citiri într-un singur loc.", links: [L.payers] },
      { en: "Ability to present billing information at the account level (i.e. level for which invoicing takes place): billing cycle, billing address, frequency, payment methods.", ro: "Posibilitatea de a prezenta informații de facturare la nivel de cont: ciclu de facturare, adresă de facturare, frecvență, metode de plată.", status: "partial", where: "Perioada de calcul, adresa și facturile lunare (frecvență lunară) se văd pe cont. Metodele de plată nu vin din 1C și nu sunt în CRM.", links: [L.payers, L.invoices] },
      { en: "Ability to present post-paid account information: preview consumption/account balance (current billing cycle, past billing cycles), bills.", ro: "Posibilitatea de a prezenta informații despre contul post-plată: consum / sold (ciclul curent și cele anterioare), facturi.", status: "done", where: "Factura Apă-Canal are graficul consumului pe luni și suma de plată; decontarea arată facturile, consumurile și soldul pe perioade (și în portal).", links: [L.payers, L.invoices] },
      { en: "Ability to present prepaid account information: view account balance.", ro: "Posibilitatea de a prezenta informații despre contul preplătit: vizualizarea soldului.", status: "na", where: "Consumatorii sunt facturați post-plată; conturile preplătite nu există în activitatea ACC." },
      { en: "Ability to present payment information: lookup accounts, what was the deadline for payment, payment history, suspension of payments.", ro: "Posibilitatea de a prezenta informații despre plăți: căutare conturi, termenul de plată, istoricul plăților, suspendarea plăților.", status: "partial", where: "Scadența facturii, statusul (plătită / restantă) și soldul se văd. Plățile individuale nu sunt transmise de 1C, deci nu există istoric de plăți în CRM.", links: [L.payers] },
      { en: "Ability to provide information about marketing offers targeted to the customer", ro: "Posibilitatea de a furniza informații despre ofertele de marketing adresate clientului", status: "todo", where: "Neimplementat ca modul. Se pot trimite anunțuri țintite prin Notificări către plătitori (filtre pe sector, localitate etc.), iar factura are caseta „Anunț”.", links: [L.notify] },
      { en: "Ability to log information on incoming and outgoing contacts with customers", ro: "Posibilitatea de a înregistra informații despre contactele primite și efectuate cu clienții", status: "done", where: "Apelurile (PBX) intră automat, notificările trimise se înregistrează în jurnalul de livrare și în „ultima notificare” a plătitorului, iar fișa plătitorului are notițe.", links: [L.pbx, L.deliveryLog] },
      { en: "Link-up with the telephone call storage system in place at the Dispatcher", ro: "Legătura cu sistemul de stocare a apelurilor telefonice de la dispecerat", status: "done", where: "Integrarea PBX: lista apelurilor (primite / efectuate / pierdute), înregistrările audio, durata, legătura cu plătitorul după număr de telefon și notificare la apel.", links: [L.pbx] },
    ],
  },
  {
    id: "crm-svc",
    part: "contract",
    code: "3.1",
    titleEn: "Service and Account Problem resolution",
    titleRo: "Rezolvarea problemelor de serviciu și de cont",
    items: [
      { en: "Ability to identify customer by checking authentication information.", ro: "Posibilitatea de a identifica clientul prin verificarea informațiilor de autentificare.", status: "done", where: "Clientul se autentifică în portal cu cont și parolă (activat cu emailul din fișă sau dovada ultimei facturi), cu cod de verificare; personalul identifică clientul după nume, cont, contract sau telefon.", links: [L.portalAccounts] },
      { en: "Separate between Request (Cerere) and Complaint (Petiti)", ro: "Separarea între cerere (Cerere) și reclamație (Petiție)", status: "done", where: "Portalul oferă 7 tipuri standard de cereri și petiția, ca șabloane separate, cu secția responsabilă; în listă se deosebesc după tip / categorie.", links: [L.tickets] },
      { en: "Ability to receive and acknowledge the problem report. Accurately timestamp the problem.", ro: "Posibilitatea de a primi și confirma sesizarea. Marcarea precisă în timp a problemei.", status: "done", where: "Fiecare cerere are data și ora depunerii (automată), iar clientul primește confirmarea; data executării se completează de echipă.", links: [L.tickets] },
      { en: "Raise appropriate Trouble Ticket and record problem.", ro: "Crearea tichetului potrivit și înregistrarea problemei.", status: "done", where: "Tichet din portal, din Cereri (personal) sau din email; descriere, atașamente, adresă, consumator.", links: [L.tickets] },
      { en: "Ability to verify the customer for support.", ro: "Posibilitatea de a verifica clientul pentru asistență.", status: "done", where: "Cererile din portal vin de la un cont verificat; la cererile primite prin email / telefon, personalul caută plătitorul în fișă (nume, cont, telefon).", links: [L.payers, L.pbx] },
      { en: "Ability to categorize the problems reported by customers (enable type of complaints). Easy way to map customer information on problem into concrete services affected.", ro: "Posibilitatea de a categorisi problemele raportate de clienți (tipuri de reclamații). Mod simplu de a lega informațiile clientului de serviciile concrete afectate.", status: "done", where: "Categorii și șabloane pe tip de cerere; tichetul păstrează adresa, consumatorul și clientul, iar de la tichet se ajunge la plătitor și la contoarele lui.", links: [L.tickets] },
      { en: "Ability to assign Trouble Ticket to the different resolution groups according to a pre-determined logic.", ro: "Posibilitatea de a asigna tichetul către grupuri de rezolvare diferite după o logică prestabilită.", status: "partial", where: "Tichetul se asignează unei echipe / utilizator, iar șabloanele de cereri vin cu secția responsabilă. Regulile automate complexe (după zonă, tip etc.) nu există; asignarea e după șablon sau manuală.", links: [L.tickets] },
      { en: "In the situation where several departments are involved in a single problem, ability to link those departments.", ro: "Când mai multe departamente sunt implicate într-o problemă, posibilitatea de a le lega.", status: "done", where: "Un tichet poate avea mai multe echipe și mai mulți responsabili, fiecare cu setările lui de notificare.", links: [L.tickets] },
      { en: "On resolution of the problem, the customers’ complaints are closed automatically and appropriate action related to closing is taken (i.e. informing the customer on the resolution).", ro: "La rezolvarea problemei, reclamațiile clienților se închid automat și se ia acțiunea potrivită (de ex. informarea clientului despre rezolvare).", status: "done", where: "Închidere automată configurabilă (cu avertisment înainte), iar clientul e informat și poate evalua rezolvarea în portal.", links: [L.tickets, L.settings] },
      { en: "Ability to track and manage resolution, automated notification and escalation procedures.", ro: "Posibilitatea de a urmări și gestiona rezolvarea, notificări automate și proceduri de escaladare.", status: "done", where: "Notificări automate de întârziere, reamintiri programate, avertizări la contracte (30 și 10 zile), la verificări metrologice (60 / 30 / 10 zile) și la termenele neregulilor (cu 3 zile înainte și la depășire), pe email / SMS / aplicație.", links: [L.tickets, L.issues] },
      { en: "Ability to close a trouble ticket manually if a problem has been resolved. Information such as the measures taken, solution delivery time, and status needs to be documented.", ro: "Posibilitatea de a închide manual un tichet dacă problema a fost rezolvată; se documentează măsurile luate, timpul de rezolvare și starea.", status: "done", where: "Fereastra de închidere cere „Măsuri luate”, timpul de rezolvare (minute) și data executării; rămân în tichet și în export.", links: [L.tickets] },
      { en: "Ability to store customer trouble ticket history.", ro: "Posibilitatea de a păstra istoricul tichetelor clientului.", status: "done", where: "Toate tichetele rămân (deschise și închise), cu jurnal de activitate, comentarii și toată conversația cu clientul.", links: [L.tickets] },
      { en: "Ability to produce reports on Requests and Complaints, including by type, location, sector, contain average response time, and reflect as a minimum the reporting obligations as per relevant ANRE regulations", ro: "Posibilitatea de a genera rapoarte despre cereri și reclamații, inclusiv pe tip, localizare, sector, cu timpul mediu de răspuns, reflectând cel puțin obligațiile de raportare conform reglementărilor ANRE", status: "partial", where: "Exportul Excel / CSV al cererilor cu filtre detaliate (tip, perioadă, stare, responsabil, adresă) include timpul de rezolvare. Un raport în formatul cerut de ANRE nu e definit separat.", links: [L.tickets] },
    ],
  },
  {
    id: "portal",
    part: "contract",
    code: "3.3",
    titleEn: "Customer Web Portal",
    titleRo: "Portalul web al clientului",
    introEn: "Customer portal on ACC’s internet web site to communicate interactively with their customers, through a secure data exchange table:",
    introRo: "Portal al clientului pe site-ul ACC, pentru comunicare interactivă cu clienții, printr-un tabel securizat de schimb de date:",
    items: [
      { en: "Providing PDF copies of the following: Customer Account Statement form with bills, payments, balance and other relevant information,", ro: "Furnizarea de copii PDF ale: formularului Extras de cont al clientului cu facturi, plăți, sold și alte informații relevante,", status: "partial", where: "Portal → Decontare: tabel cu facturile, consumurile, soldul și penalitățile, descărcabil PDF (și tipărire). Plățile individuale nu sunt incluse (nu vin din 1C).", links: [L.simulate] },
      { en: "Previous bills,", ro: "Facturile anterioare,", status: "done", where: "Portalul listează toate facturile clientului, cu pagina publică a facturii și PDF.", links: [L.simulate] },
      { en: "Based on the customer request provide automated e-bills in PDF form to be sent to the customers e-mail addresses,", ro: "La cererea clientului, e-facturi automate în format PDF trimise pe adresele de email ale clienților,", status: "done", where: "E-factura se trimite pe email ca link (șablonul „Factura dumneavoastră {factura} este disponibilă”, din Notificări, către plătitorii aleși), iar de pe pagina facturii clientul o descarcă în PDF. Facturile create în CRM cu status „Trimisă” pleacă automat pe emailul clientului.", links: [L.notify, L.invoices] },
      { en: "Baseline for future on-line bill payment with debit or credit card system.", ro: "Bază pentru viitoarea plată online a facturilor cu card de debit / credit.", status: "todo", where: "Neimplementat: portalul arată facturile și soldul, dar fără plată cu cardul. Structura (facturi, sold, scadență, cont verificat) e pregătită pentru o integrare cu un procesor de plăți." },
      { en: "Customer or Client creation of complaints and requests", ro: "Crearea de reclamații și cereri de către client", status: "done", where: "Portal → Cereri: clientul alege tipul (7 cereri standard sau petiție), completează adresa, consumatorul și data, atașează fișiere și poartă conversația cu operatorii.", links: [L.simulate] },
      { en: "Possibility for customer to send water meter data reading, and track readings history. Note: a verification mechanism should be in place – e.g. if a reading is entered via the web, an e-mail should automatically be sent to the nominated e-mail account of the owner, requesting verification of the entered reading.", ro: "Posibilitatea clientului de a trimite indexul contorului de apă și de a urmări istoricul citirilor. Notă: un mecanism de verificare — dacă un index e introdus pe web, se trimite automat un email către adresa titularului, cerând verificarea indexului introdus.", status: "done", where: "Portal → Contoare: indexul (cu poză și starea contorului) și istoricul ultimelor 6 luni. La fiecare citire nouă sau modificată pleacă email către titular, cu link de confirmare / contestare (personalul e anunțat la contestare).", links: [L.simulate, L.field] },
      { en: "Application will issue the electronic invoice and send it to the client's email if he / she opts for the electronic invoice, will allow index typing, access on the WEB to consult the current invoice, historic invoices, payments, index and consumption", ro: "Aplicația emite factura electronică și o trimite pe emailul clientului dacă optează pentru ea, permite introducerea indexului și consultarea pe web a facturii curente, a facturilor istorice, a plăților, a indexului și a consumului", status: "done", where: "Clientul optează pentru e-factură intrând în contul din portal: acolo deschide și descarcă în PDF factura curentă sau orice factură anterioară, introduce indexul și vede indexul și consumul (grafic pe luni). Factura îi poate fi trimisă și pe email, ca link. Plățile individuale nu sunt transmise de 1C; se văd soldul, scadența și statusul facturii.", links: [L.simulate, L.notify] },
      { en: "Web Application published online and easy accessed through links from official ACC web Page.", ro: "Aplicația web publicată online și ușor accesibilă prin linkuri de pe pagina oficială ACC.", status: "external", where: "Portalul e publicat la adresa CRM-ului (/portal) și funcționează ca aplicație instalabilă pe telefon. Linkul de pe site-ul oficial ACC îl pune administratorul site-ului." },
      { en: "The Customer must send a request for enabling the User and Password to enter to the portal.", ro: "Clientul trebuie să trimită o cerere pentru activarea utilizatorului și a parolei de acces în portal.", status: "done", where: "Clientul își activează contul din portal, dovedind identitatea (emailul din fișă sau ultima factură); administratorul vede toate conturile, le poate reseta și le poate verifica prin simulare.", links: [L.portalAccounts, L.simulate] },
    ],
  },
  {
    id: "mobile",
    part: "contract",
    code: "3.4",
    titleEn: "Mobile Billing/Reading Application for Meter Readers (Smartphone/Tablet)",
    titleRo: "Aplicația mobilă de facturare / citire pentru cititorii de contoare (smartphone / tabletă)",
    introEn: "A mobile version of the billing system for installation on the Meter Reader end devices, smartphone or Tablet, Android-compatible. Involves automating the process of meter reading, using mobile devices for primary data entry, and automated data transfer from the mobile device to the billing system:",
    introRo: "O versiune mobilă a sistemului de facturare, instalabilă pe dispozitivele cititorilor, smartphone sau tabletă, compatibilă Android. Automatizează citirea contoarelor, folosind dispozitive mobile pentru introducerea primară a datelor și transferul automat către sistemul de facturare:",
    items: [
      { en: "use existing types of meters and read them manually,", ro: "folosirea tipurilor de contoare existente și citirea lor manuală,", status: "done", where: "Citiri teren: aplicația (PWA, instalabilă pe Android) arată contoarele din 1C, de citit manual.", links: [L.field] },
      { en: "manually enter meter readings onto a portable device,", ro: "introducerea manuală a indexurilor pe un dispozitiv portabil,", status: "done", where: "Indexul se scrie pe telefon, cu poză, locație GPS și starea contorului.", links: [L.field] },
      { en: "pre-load the portable device with the meters reading cycle (by day, by week, or by period)", ro: "preîncărcarea dispozitivului cu ciclul de citire al contoarelor (pe zi, pe săptămână sau pe perioadă)", status: "done", where: "Lista contoarelor se descarcă pe telefon și funcționează și fără internet (cu coadă offline); rutele au fereastra de citire pe zile din lună, iar „Rutele mele” arată ce e al cititorului.", links: [L.field, L.routes] },
      { en: "down load device automatically to billing system at end of reading cycle.", ro: "descărcarea automată a dispozitivului în sistemul de facturare la sfârșitul ciclului de citire.", status: "partial", where: "Citirile se trimit automat în CRM când revine internetul. Transferul spre facturarea 1C nu e automat; citirile se exportă (Excel / CSV) pentru 1C.", links: [L.field] },
      { en: "Calculate and produce bills in the current way.", ro: "Calcularea și emiterea facturilor în modul actual.", status: "external", where: "Facturarea rămâne în 1C; CRM-ul primește facturile din 1C și le afișează (pagină publică, PDF, portal)." },
      { en: "Meter readings should meet the following criteria: Must be programmable in the system and take place, as best possible, at the same time each month.", ro: "Citirile trebuie să fie programabile în sistem și să aibă loc, pe cât posibil, la aceeași dată în fiecare lună.", status: "done", where: "Rutele de citire au fereastra de zile din lună (de ex. 1–10), cititorul și regulile (sector / localitate / stradă); luna nouă începe automat.", links: [L.routes] },
      { en: "The operator or the system should define the daily meter reading programme", ro: "Operatorul sau sistemul trebuie să definească programul zilnic de citire.", status: "done", where: "Rutele împart contoarele pe cititori și zile; raportul arată câte ar fi trebuit citite până azi (ritm uniform) față de câte s-au citit.", links: [L.routes] },
      { en: "All meter readings must be justifiable, consistent, and understandable by the customer.", ro: "Toate citirile trebuie să fie justificabile, coerente și ușor de înțeles de client.", status: "done", where: "Fiecare citire are poză, locație, cititor, oră, indexul anterior și consumul; clientul vede aceleași date în portal și verifică citirea prin email.", links: [L.field] },
      { en: "Readings, when taken, must be supported by day, date, and time data. (when using automated reading systems this should be provided automatically)", ro: "Citirile trebuie însoțite de zi, dată și oră (la sistemele automate acestea se furnizează automat).", status: "done", where: "Citirile manuale au data și ora; cele LoRaWAN primesc automat data și ora transmisiei de la contor (sursa „LoRaWAN”).", links: [L.field, L.lorawan] },
      { en: "The reading record must also include information on Irregularities, condition of meter (fault, failure, tamper, reverse flow etc.).", ro: "Înregistrarea citirii trebuie să includă și informații despre nereguli și starea contorului (defect, avarie, fraudă, flux invers etc.).", status: "done", where: "La citire se alege starea contorului (defect, sigiliu, flux invers etc.) cu observații; neregula intră în registrul „Nereguli contoare”.", links: [L.issues, L.field] },
      { en: "When the reading is entered, a background verification-control check should principally be enabled (e.g. comparison with average consumption, % variance, etc.)", ro: "La introducerea citirii trebuie activată în fundal o verificare de control (de ex. comparația cu consumul mediu, variația în %).", status: "done", where: "Indexul mai mic decât cel anterior, consumul neobișnuit de mare sau de mic față de media lunară a contorului și locația departe de cea anterioară cer confirmare / se semnalează în liste.", links: [L.field] },
      { en: "Allow for comparison Actual number of readings against planned, in total and by meter reader.", ro: "Posibilitatea de a compara numărul real de citiri cu cel planificat, în total și pe cititor.", status: "done", where: "Rute de citire → Planificat vs citit: pe rută și pe cititor (citite de el, de alții, rămase, în urma planului), cu export CSV.", links: [L.routes] },
      { en: "Allow for showing data on List of Estimated Bills with length of time", ro: "Posibilitatea de a afișa datele despre lista facturilor estimate și durata estimării.", status: "done", where: "Filtrul „Estimare” (citire calculată / estimată) în Plătitori, Notificări și Contoare, combinat cu filtrul „Luna facturii” pentru orice perioadă, cu export Excel. Durata estimării se vede în istoricul fiecărui contor: lună de lună, cu sursa citirii „Calculat (estimat)”.", links: [L.payers, L.meters] },
    ],
  },
  {
    id: "billing-data",
    part: "contract",
    code: "3.5",
    titleEn: "Enhancement of existing Functionalities Billing and Accounting — Data Evidence (1C Billing Module)",
    titleRo: "Îmbunătățirea funcționalităților existente de facturare și contabilitate — Evidența datelor (modulul 1C Facturare)",
    introEn: "Within the 1C Billing Module, the following functionalities shall be enabled:",
    introRo: "În modulul 1C Facturare trebuie activate următoarele funcționalități:",
    items: [
      { en: "Dividing the meter readers of non casnic consumer per sectors", ro: "Împărțirea cititorilor consumatorilor non-casnici pe sectoare", status: "partial", where: "În CRM cititorii se împart pe rute după sector (Участок din 1C), localitate și stradă. Împărțirea din interiorul 1C se face în 1C.", links: [L.routes] },
      { en: "Updating the consumer meter record model according to the new requirements (creation of new fields - installation position, installation location, etc.)", ro: "Actualizarea modelului fișei contorului consumatorului conform cerințelor noi (câmpuri noi — poziția de instalare, locul instalării etc.)", status: "partial", where: "CRM-ul arată din 1C data instalării, sigiliul și sursa citirii și adaugă locația GPS și adresa contorului completate din teren. Câmpurile noi din fișa din 1C se creează în 1C.", links: [L.meters] },
      { en: "Management of non-domestic consumers by consumption addresses (creation of other points of reference for payment so that payment is placed where necessary)", ro: "Gestionarea consumatorilor non-casnici pe adrese de consum (puncte de referință pentru plată, astfel încât plata să fie plasată unde este necesar)", status: "external", where: "Se face în 1C. CRM-ul arată contoarele fiecărui abonat pe adresa de consum, inclusiv contoarele de la aceeași adresă.", links: [L.meters] },
      { en: "Possibility of automatic calculation of the average volume for determined consumers", ro: "Posibilitatea calculului automat al volumului mediu pentru consumatorii stabiliți", status: "partial", where: "Calculul facturării rămâne în 1C. CRM-ul calculează consumul mediu lunar al fiecărui contor (ultimele luni cu consum real) pentru verificarea citirilor și arată citirile estimate.", links: [L.field, L.payers] },
      { en: "Possibility of changing the list of consumers, to which it is necessary to apply the calculation of the individual average volume to each or in groups depending on the criteria of assignment to the sector/street/locality.", ro: "Posibilitatea de a modifica lista consumatorilor cărora li se aplică calculul volumului mediu individual, fiecăruia sau în grupuri, după sector / stradă / localitate.", status: "partial", where: "Listele după sector / stradă / localitate și filtrul de estimare există în CRM (pentru selecție și export). Aplicarea calculului pe listă se face în 1C.", links: [L.payers, L.payersTable] },
    ],
  },
  {
    id: "billing-rep",
    part: "contract",
    code: "3.5",
    titleEn: "Billing — Reporting",
    titleRo: "Facturare — Rapoarte",
    items: [
      { en: "Display of the debt report depending on the term (current / unexpired, expired - <3 months, 3 months - 1 year, 1 year <, 3 years <", ro: "Afișarea raportului de datorii în funcție de termen (curente / neexpirate, expirate — sub 3 luni, 3 luni — 1 an, peste 1 an, peste 3 ani)", status: "partial", where: "Plătitorii se filtrează după datorie (sumă, factură restantă, scadență), cu export Excel. Raportul pe intervalele de vechime cerute (sub 3 luni, 3 luni–1 an, peste 1 an, peste 3 ani) nu e un raport separat.", links: [L.payers, L.payersTable] },
      { en: "Number of invoices issued separately per service- water / water + sewerage / sewerage (domestic / non-domestic)", ro: "Numărul de facturi emise separat pe serviciu — apă / apă + canalizare / canalizare (casnic / non-casnic)", status: "done", where: "Facturile se filtrează pe lună, status și tip persoană fizică / firmă, iar liniile arată serviciul (apă, canal). Raportul se face prin exportul Excel foarte detaliat, cu filtrele aplicate (perioadă, serviciu, casnic / non-casnic, sector, localitate).", links: [L.invoices, L.payersTable] },
      { en: "Information about open / closed contracts, new consumers, new consumption places created", ro: "Informații despre contractele deschise / închise, consumatorii noi, locurile de consum noi create", status: "done", where: "Plătitori: filtrele „Consumator nou” (adăugat în CRM de la o dată) și „Loc de consum nou” (începutul consumului din 1C de la o dată), plus „Instalat”, contractele cu data expirării / expirate și notificările la 30 / 10 zile. Lista filtrată se exportă în Excel.", links: [L.payers] },
      { en: "Information about customers, (number of consumers, active consumers, no. of consumption places, no. of active consumption places) per tariff groups, sector, locality, street, on water / sewerage / water + sewerage service)", ro: "Informații despre clienți (număr de consumatori, consumatori activi, locuri de consum, locuri de consum active) pe grupe tarifare, sector, localitate, stradă, pe serviciul apă / canalizare / apă + canalizare", status: "done", where: "Grupele tarifare sunt sectorul privat și cel comunal; numărătorile pe sector (privat / comunal și sectorul 1C), localitate, stradă și tip se văd în filtrele din Plătitori / Contoare (cu număr lângă fiecare valoare), iar serviciul (apă / canal) din liniile facturii. Se exportă în Excel.", links: [L.payers, L.meters] },
      { en: "Information about the meter data registered in the program depending on the source of origin (consumer / meter reader / dispatcher / act) per sector / area / street / block", ro: "Informații despre datele contoarelor înregistrate în program, în funcție de sursa de proveniență (consumator / cititor / dispecer / act), pe sector / zonă / stradă / bloc", status: "done", where: "Filtrul „Sursa citirii” (Abonat, Controlor, Dispecer, Act, LoRaWAN) în Contoare, combinat cu sector, localitate și stradă; în Citiri teren și sursa „din portal / cititor / LoRaWAN”. Export Excel pe filtre.", links: [L.meters, L.field] },
    ],
  },
  {
    id: "billing-docs",
    part: "contract",
    code: "3.5",
    titleEn: "Billing — Documents to be printable",
    titleRo: "Facturare — Documente tipăribile",
    items: [
      { en: "Notification for checking / changing the meter model directly from the program to consumers with meters with expired or defective meters.", ro: "Înștiințare pentru verificarea / schimbarea contorului, direct din program, către consumatorii cu contoare cu verificarea expirată sau defecte.", status: "done", where: "Verificarea metrologică (5 ani) cu notificări automate la 60 / 30 / 10 zile, text editabil, pe email / SMS, și neregula „contor defect” cu mesaje.", links: [L.issues, L.notify] },
      { en: "Notification of disconnection directly from the program (accumulation of debt, non-removal of technical non-compliances, etc. at your choice).", ro: "Înștiințare de deconectare direct din program (acumulare de datorii, neeliminarea neconformităților tehnice etc., la alegere).", status: "done", where: "Mesaje automate de remediere a neregulilor (3 zile înainte și la depășire) și Notificări către plătitori cu șabloane proprii (de ex. pentru deconectare, la 30 / 10 zile): se alege motivul (datorie, neconformități tehnice etc.) și se trimite clientului.", links: [L.notify, L.issues] },
    ],
  },
  {
    id: "billing-add",
    part: "additional",
    code: "3.5",
    titleEn: "Billing — Additional functionalities",
    titleRo: "Facturare — Funcționalități suplimentare",
    items: [
      { en: "Non-casnic consumers without an open bank account, finding the possibility to pay online by debit / credit card (implemented)", ro: "Consumatorii non-casnici fără cont bancar deschis: posibilitatea de a plăti online cu card de debit / credit (implementat)", status: "external", where: "Marcat în contract ca „implementat” (în afara CRM-ului)." },
      { en: "Automated Data Exchange with bank(s) regarding lists of invoices, amounts due, customer information for identification of payments", ro: "Schimb automat de date cu banca / băncile: liste de facturi, sume datorate, informații despre clienți pentru identificarea plăților", status: "todo", where: "Neimplementat: depinde de API-urile / formatele băncilor. CRM-ul poate exporta liste de facturi și sume datorate (Tabel 1C, export pe filtre), dar nu are conectori bancari.", links: [L.payersTable] },
      { en: "Bill, consumer information by e-mail", ro: "Facturi și informații despre consumator prin email", status: "done", where: "Notificări către plătitori prin email (cu link și PDF al facturii, sold, scadență), cu șabloane și jurnal de livrare.", links: [L.notify, L.deliveryLog] },
    ],
  },
  {
    id: "lorawan",
    part: "contract",
    code: "3.6",
    titleEn: "Data Transfer from Advanced Metering LoRaWAN to Billing Database",
    titleRo: "Transferul datelor de la contorizarea avansată LoRaWAN către baza de date de facturare",
    introEn: "ACC is planning the installation of a large number of smart customer water meters in apartment blocks of the City that can be read remotely through a LoRaWAN system. The Bidder needs to ensure that the software / configuration at ACC provides such integration functionality for the LoRaWAN database.",
    introRo: "ACC planifică instalarea unui număr mare de contoare inteligente de apă în blocurile din oraș, care pot fi citite de la distanță printr-un sistem LoRaWAN. Ofertantul trebuie să asigure că software-ul / configurația de la ACC oferă funcționalitatea de integrare pentru baza de date LoRaWAN.",
    items: [
      { en: "The implementer of the LoRaWAN system is obliged to render a database structure / configuration containing the meter readings and related ACC customers that should be compatible for direct integration into the billing / customer database of ACC.", ro: "Implementatorul sistemului LoRaWAN trebuie să furnizeze o structură / configurație de bază de date cu citirile contoarelor și clienții ACC asociați, compatibilă cu integrarea directă în baza de date de facturare / clienți a ACC.", status: "done", where: "Serverul de noduri LoRaWAN furnizează lista (număr contor, volum, data și ora); CRM-ul o citește zilnic la 23:30 și o leagă de plătitori după numărul contorului (inclusiv variantele cu zerouri în față sau -wc / -bc).", links: [L.lorawan] },
      { en: "The Bidder needs to ensure that the software / configuration at ACC provides such integration functionality for the LoRaWAN database. It is strongly recommended to liaise with the LoRaWAN implementer and to offer a jointly agreed and workable solution.", ro: "Ofertantul trebuie să asigure funcționalitatea de integrare pentru baza de date LoRaWAN; se recomandă insistent colaborarea cu implementatorul LoRaWAN și o soluție agreată împreună.", status: "done", where: "Integrarea e activă: butonul „Activează” pornește prima extragere, apoi rulează automat zilnic. Pagina arată citirile salvate, contoarele ignorate (altă lună), negăsite în CRM și etapele rulării. Contoarele LoRaWAN apar cu sursa „LoRaWAN” și nu se pot modifica manual.", links: [L.lorawan, L.field] },
      { en: "3.6. Data Transfer to from Advanced Metering LoRaWAN to Billing Database; here: only provision of integration functionality on the side of the Billing Database", ro: "3.6. Transferul datelor către / de la contorizarea avansată LoRaWAN la baza de date de facturare; aici: doar furnizarea funcționalității de integrare pe partea bazei de date de facturare", status: "partial", where: "Citirile ajung în CRM și se văd plătitorului (portal), cititorilor și personalului. Către facturarea 1C nu există transfer automat; citirile se pot exporta. Contoarele LoRaWAN care nu sunt înregistrate în 1C (nu există în CRM) trebuie adăugate acolo.", links: [L.lorawan, L.meters] },
    ],
  },

  // ── Adăugat de noi, peste contract ──────────────────────────────────────────────────────────────────────
  {
    id: "ours-work",
    part: "ours",
    code: "+",
    titleEn: "Task management (ClickUp-style)",
    titleRo: "Managementul sarcinilor (în stilul ClickUp)",
    items: [
      { en: "The same work in several views: table, Kanban board and Calendar, plus Projects", ro: "Aceeași muncă în mai multe vizualizări: tabel, tablă Kanban și Calendar, plus Proiecte", status: "done", where: "Sarcini (tabel), Kanban (coloane pe stare, sarcinile se mută între stări), Calendar (termene și programări) și Proiecte (sarcinile și fișierele unui proiect, cu hartă).", links: [L.tasks, L.kanban, L.calendar, L.projects] },
      { en: "Custom statuses with colours, order and per-status notification rules (notify on entering, or mute while in the status)", ro: "Stări personalizate cu culori, ordine și reguli de notificare pe stare (notifică la intrare sau oprește notificările cât timp tichetul e în acea stare)", status: "done", where: "Setări → Stările tichetelor / sarcinilor (editor cu culoare, ordine, „notifică la intrare”, „oprește toate notificările”).", links: [L.settings] },
      { en: "Task and ticket templates with variables ({counter}, {date}, {operator}, payer / caller data) — one click creates a pre-filled task", ro: "Șabloane de sarcini și tichete cu variabile ({contor}, {data}, {operator}, datele plătitorului / apelantului) — un click creează o sarcină precompletată", status: "done", where: "Sarcini → Șabloane: lista și editorul; „Folosește” deschide creația cu titlul și descrierea completate (numărul șablonului crește la fiecare folosire).", links: [L.tasks] },
      { en: "Several assignees and teams on one task, each with its own notification rule (until a chosen status)", ro: "Mai mulți responsabili și echipe pe aceeași sarcină, fiecare cu propria regulă de notificare (până la o stare aleasă)", status: "done", where: "Selectorul de asignare multiplă din formularul sarcinii; fiecare responsabil primește notificări după regula lui.", links: [L.tasks] },
      { en: "Row colours and table colour themes chosen by each user", ro: "Culori pe rânduri și teme de culori ale tabelelor, alese de fiecare utilizator", status: "done", where: "Cercul din rând pentru culoarea sarcinii (cu paletă completă) și „Culori tabel” pentru antet, text, rânduri alternate și linii; se salvează pe dispozitiv.", links: [L.tasks] },
      { en: "Comments, activity timeline, file attachments and project folders / files panel", ro: "Comentarii, istoric de activitate, atașamente de fișiere și panou de foldere / fișiere pe proiect", status: "done", where: "În fișa sarcinii: comentarii, jurnal de activitate, fișiere; în fișa proiectului: fișierele proiectului pe foldere.", links: [L.tasks, L.projects] },
      { en: "Priorities, progress %, deadlines, overdue alerts and scheduled / recurring reminders", ro: "Priorități, progres %, termene, alerte de întârziere și reamintiri programate / repetate", status: "done", where: "Reamintire o singură dată / zilnic / săptămânal / lunar / la interval, cu notificare în aplicație, push și Telegram.", links: [L.tasks] },
      { en: "Proof required to finish for users without the “close” right; assignment locked without the “assign” right", ro: "Dovadă la finalizare pentru utilizatorii fără dreptul de închidere; asignarea blocată fără dreptul de asignare", status: "done", where: "Fereastra „Dovadă” la finalizare; fără permisiunea „Asignare” responsabilii se văd, dar nu se pot schimba.", links: [L.tasks] },
      { en: "Global quick-add (+) menu to create tasks, tickets and appointments from any page, and categories for them", ro: "Meniu global „+” pentru crearea rapidă de sarcini, tichete și programări din orice pagină, și categorii pentru ele", status: "done", where: "Butonul „+” din aplicație (și butonul plutitor pe telefon); categoriile se administrează în Setări.", links: [L.settings] },
      { en: "Appointments with client reminders (email / Telegram) and a reminder schedule per appointment", ro: "Programări cu reamintiri către clienți (email / Telegram) și program de reamintiri pe fiecare programare", status: "done", where: "Pagina Programări: durată, locație, categorie, status, canalele clientului și praguri de reamintire alese pe programare (cu x minute / ore / zile înainte, adăugate dintr-un buton).", links: [L.appointments] },
      { en: "Dashboard with the user's tasks, appointments and key numbers; map of meters and tasks", ro: "Dashboard cu sarcinile, programările și cifrele-cheie ale utilizatorului; hartă cu contoarele și sarcinile", status: "done", where: "Prima pagină după autentificare; Harta arată contoarele (citit / necitit / neregulă) cu filtre pe sector, rută și sursa citirii.", links: [L.dashboard, L.map] },
    ],
  },
  {
    id: "ours-roles",
    part: "ours",
    code: "+",
    titleEn: "Users, roles and permissions",
    titleRo: "Utilizatori, roluri și permisiuni",
    items: [
      { en: "Role templates (Reader, Operator, Reading manager, View-only — editable — plus your own, e.g. Dispatcher, Accountant) applied when creating a user", ro: "Șabloane pe roluri (Cititor, Operator, Responsabil citiri, Doar vizualizare — modificabile — plus ale voastre, de ex. Dispecer, Contabil) aplicate la crearea utilizatorului", status: "done", where: "Utilizatori → Șabloane de roluri: nume, descriere, rol, permisiuni și ce sarcini vede; un șablon completează formularul de utilizator.", links: [L.users] },
      { en: "Granular permissions per module and action (view, edit, assign, close, export, manage meters, …) and task visibility (all / own)", ro: "Permisiuni detaliate pe modul și acțiune (vizualizare, editare, asignare, închidere, export, administrare contoare, …) și vizibilitatea sarcinilor (toate / proprii)", status: "done", where: "Utilizatori → permisiunile fiecărui cont, grupate pe module; meniul și paginile se adaptează după ele.", links: [L.users] },
      { en: "Teams for shared assignment and notifications", ro: "Echipe pentru asignare și notificări comune", status: "done", where: "Pagina Echipe; o sarcină se poate asigna unei echipe întregi.", links: [L.team] },
      { en: "Personal profile, notification channels per user and customisable phone quick buttons (bottom bar)", ro: "Profil personal, canale de notificare pe utilizator și butoane rapide personalizabile pe telefon (bara de jos)", status: "done", where: "Setări: profil, Telegram / push / email, „Butoane rapide pe telefon” (maximum 5, salvate pe cont).", links: [L.settings] },
      { en: "Log in as the customer (portal simulation) for support, marked in the audit log", ro: "„Intră ca clientul” (simulare portal) pentru suport, marcată în jurnalul de audit", status: "done", where: "Simulare login: lista conturilor de portal cu filtre; un banner arată clar că ești în simulare.", links: [L.simulate] },
    ],
  },
  {
    id: "ours-comm",
    part: "ours",
    code: "+",
    titleEn: "Communication, PBX and automation",
    titleRo: "Comunicare, PBX și automatizări",
    items: [
      { en: "Incoming-call pop-up with the caller's CRM card (debt, open tickets, last note) and quick actions", ro: "Pop-up „Apel primit” cu fișa apelantului din CRM (datorie, tichete deschise, ultima notiță) și acțiuni rapide", status: "done", where: "Apare automat când sună cineva pe numărul companiei: fișa plătitorului, filtru în Plătitori, tichet / sarcină cu datele apelului.", links: [L.pbx] },
      { en: "Robot-call lists export for the PBX auto-informing (“Автоинформирование”) and robot notification calls through a gateway, plus SMS gateway", ro: "Export de liste pentru autoinformarea PBX („Автоинформирование”) și apeluri robot de notificare printr-un gateway, plus gateway SMS", status: "done", where: "Notificări → Plătitori: filtrezi plătitorii și pregătești fișierele (numere + mesaje) pentru PBX; trimiterea de SMS / apel robot se face prin gateway.", links: [L.notify] },
      { en: "Telegram bot with action buttons and a sleeping-hours (quiet hours) rule", ro: "Bot Telegram cu butoane de acțiune și regula orelor de somn", status: "done", where: "Se leagă din pagina Telegram; mesajele respectă orele de somn, cu excepție pentru sarcinile marcate.", links: [L.telegram] },
      { en: "Installable mobile app (PWA) with push notifications and offline lists", ro: "Aplicație mobilă instalabilă (PWA) cu notificări push și liste disponibile offline", status: "done", where: "Se instalează din browser; listele mari se descarcă o dată și funcționează și fără internet.", links: [L.settings] },
      { en: "Voice assistant: create tasks and appointments by voice", ro: "Asistent vocal: crearea sarcinilor și a programărilor prin voce", status: "done", where: "Butonul cu microfon din antet; comanda vocală se transformă în sarcină sau programare." },
      { en: "Email → ticket with threading, anti-spam filter and automatic closing of unanswered email requests", ro: "Email → tichet cu conversații legate, filtru anti-spam și închiderea automată a cererilor din email rămase fără răspuns", status: "done", where: "Căsuța de email se citește automat (IMAP); mesajele-spam se resping, iar cererile fără răspuns de la client se închid după un număr de ore setat.", links: [L.tickets, L.settings] },
      { en: "Chat between the customer (portal) and operators in each request, with a 1–5 satisfaction rating", ro: "Conversație între client (portal) și operatori în fiecare cerere, cu evaluare de satisfacție 1–5", status: "done", where: "În tichet, mesajele clientului și ale operatorilor; după închidere clientul dă nota și un comentariu.", links: [L.tickets] },
      { en: "Delivery journal for every notification sent (email, SMS, Telegram, push) with status and details", ro: "Jurnal de livrare pentru fiecare notificare trimisă (email, SMS, Telegram, push), cu stare și detalii", status: "done", where: "Jurnal notificări: fiecare mesaj, canalul, destinatarul și rezultatul; exportabil.", links: [L.deliveryLog] },
    ],
  },
  {
    id: "ours-data",
    part: "ours",
    code: "+",
    titleEn: "Data, imports and billing documents",
    titleRo: "Date, importuri și documente de facturare",
    items: [
      { en: "Automatic synchronisation of payers and invoices from 1C (API / file import) with change detection", ro: "Sincronizare automată a plătitorilor și facturilor din 1C (API / import de fișier) cu detectarea modificărilor", status: "done", where: "Plătitori → Sincronizare API (zilnică) și import de fișier; la fiecare rulare se văd clienții și facturile noi / actualizate.", links: [L.payers] },
      { en: "1C table of payers with filters, in-browser sorting and Excel / CSV export on the applied filters", ro: "Tabel 1C al plătitorilor cu filtre, sortare în browser și export Excel / CSV pe filtrele aplicate", status: "done", where: "Plătitori → Tabel 1C; exporturile din Plătitori, Contoare, Cereri și Sarcini respectă filtrele active.", links: [L.payersTable, L.payers] },
      { en: "AI-assisted import of data from files", ro: "Import de date din fișiere asistat de AI", status: "done", where: "Butoanele de import din Plătitori, Clienți, Proiecte și Sarcini." },
      { en: "Invoice template editor (positions, fonts, logo, custom text with variables, extra images) and PDF generated on the server", ro: "Editor de șablon al facturii (poziții, fonturi, siglă, text personalizat cu variabile, imagini suplimentare) și PDF generat pe server", status: "done", where: "Setări → Șablon factură Apă-Canal; PDF-ul facturii publice se desenează direct, fără browser, cu cache.", links: [L.layout, L.invoices] },
      { en: "Manual invoice forms (standard and Apă-Canal) with preview, and a tariff that applies to new Apă-Canal invoices", ro: "Formulare de facturi manuale (standard și Apă-Canal) cu previzualizare și un tarif aplicat facturilor Apă-Canal noi", status: "done", where: "Facturi → Factură nouă; butonul „Aplică tariful” afectează doar facturile create de atunci înainte.", links: [L.invoices] },
      { en: "Payer statement (Decontare) as PDF, also available to the customer in the portal", ro: "Decontarea plătitorului ca PDF, disponibilă și clientului în portal", status: "done", where: "Fișa plătitorului → Decontare și Portal → Decontare, cu tipărire.", links: [L.payers] },
      { en: "Portal accounts list for 19,000+ payers with filters; portal request templates (7 standard requests + petition)", ro: "Lista conturilor de portal pentru peste 19.000 de plătitori, cu filtre; șabloane de cereri pentru portal (7 cereri standard + petiție)", status: "done", where: "Setări → Conturi portal, cu „Șabloane de cereri pentru clienți” (adaugă cele 7 cereri standard dintr-un buton).", links: [L.portalAccounts, L.settings] },
      { en: "Meter data extras: metrology verification tracking (5 years) with reminders, irregularity rules (who fixes, in how many days, which section) and photo upload compressed to WebP", ro: "Extra la contoare: urmărirea verificării metrologice (5 ani) cu reamintiri, reguli ale neregulilor (cine remediază, în câte zile, ce secție) și poze încărcate comprimat în WebP", status: "done", where: "Fișa contorului (verificare metrologică), Setări → regulile neregulilor de contor, Citiri teren (poze).", links: [L.meters, L.settings] },
    ],
  },
  {
    id: "ours-ux",
    part: "ours",
    code: "+",
    titleEn: "Speed, usability and look",
    titleRo: "Viteză, utilizare și aspect",
    items: [
      { en: "Lists with 20,000–50,000 rows load once and are filtered, sorted and paged instantly in the browser (virtualised, kept offline)", ro: "Liste cu 20.000–50.000 de rânduri se descarcă o dată și se filtrează, sortează și paginează instant în browser (virtualizate, păstrate offline)", status: "done", where: "Plătitori, Contoare, Facturi, Apeluri PBX, Conturi portal, Sarcini: listă locală + actualizări doar cu diferențele.", links: [L.payers, L.meters] },
      { en: "Saved filters, per-page choice, column chooser and a phone “cards” mode for tables", ro: "Filtre salvate, alegerea numărului pe pagină, alegerea coloanelor și un mod „carduri” pe telefon pentru tabele", status: "done", where: "Filtrele rămân pe dispozitiv; butoanele „Coloane”, „Afișează” și „Mod telefon” din bara fiecărui tabel.", links: [L.payers] },
      { en: "Open any address in Google Maps, Apple Maps or Waze; link previews with the company logo", ro: "Deschiderea oricărei adrese în Google Maps, Apple Maps sau Waze; previzualizări de link cu sigla companiei", status: "done", where: "Butoanele „Deschide în …” la adrese / locații; linkurile publice (factură, confirmare citire) au imagine cu sigla în mesagerii." },
      { en: "Interface in Romanian, English and Russian; light and dark theme", ro: "Interfață în română, engleză și rusă; temă luminoasă și întunecată", status: "done", where: "Selectorul de limbă din antet; tema în Setări.", links: [L.settings] },
    ],
  },
  {
    id: "ours-sec",
    part: "ours",
    code: "+",
    titleEn: "Security and audit",
    titleRo: "Securitate și audit",
    items: [
      { en: "Strong passwords (scrypt), login throttling, two-factor authentication (TOTP) with recovery codes, full Content-Security-Policy and a new-device alert", ro: "Parole puternice (scrypt), limitarea încercărilor de autentificare, autentificare în doi pași (TOTP) cu coduri de recuperare, Content-Security-Policy complet și alertă la dispozitiv nou", status: "done", where: "Setări → Securitate (QR TOTP, sesiuni active); alerta de dispozitiv nou vine în aplicație, push și email.", links: [L.settings] },
      { en: "Audit Logs of every change (who, what, when, from where, field-by-field differences)", ro: "Audit Logs pentru fiecare modificare (cine, ce, când, de unde, diferențe pe câmpuri)", status: "done", where: "Audit Logs (vizibile super-administratorului), cu fereastră de detalii pe fiecare acțiune.", links: [L.audit] },
      { en: "Email verification of readings entered on the web, with a public confirm / dispute page", ro: "Verificarea prin email a indexurilor introduse pe web, cu pagină publică de confirmare / contestare", status: "done", where: "La fiecare citire nouă din portal pleacă emailul către titular; contestarea anunță personalul.", links: [L.field] },
      { en: "Automatic LoRaWAN meter extraction with an activation button, locked manual editing and a status page", ro: "Extragere automată a contoarelor LoRaWAN cu buton de activare, editare manuală blocată și pagină de stare", status: "done", where: "Contoare → LoRaWAN: activare, rulare manuală, cifre pe etape, numere negăsite în CRM.", links: [L.lorawan] },
    ],
  },
];

/** Toate punctele, cu id stabil (`<grup>-<număr>`), în ordinea paginii. */
export const SPEC_ITEMS: (SpecItem & { group: string })[] = SPEC_GROUPS.flatMap((g) => g.items.map((it, i) => ({ ...it, id: `${g.id}-${i + 1}`, group: g.id })));

export const SPEC_PARTS: { id: SpecPart; titleEn: string; titleRo: string; noteRo: string }[] = [
  { id: "contract", titleEn: "Contract requirements", titleRo: "Cerințele contractului", noteRo: "Punctele din secțiunea VII (9.7.2.3 — CRM, portal, aplicația mobilă, facturare, LoRaWAN), exact ca în contract." },
  { id: "additional", titleEn: "Additional items in the contract", titleRo: "Puncte adiționale din contract", noteRo: "Licențele software suplimentare (9.7.2.2) și funcționalitățile suplimentare de facturare (3.5), separate de restul." },
  { id: "ours", titleEn: "Added by us", titleRo: "Adăugate de noi", noteRo: "Funcții pe care le-am făcut în plus față de contract." },
];

export const SPEC_IDS: Set<string> = new Set(SPEC_ITEMS.map((i) => i.id));

export const STATUS_LABEL_RO: Record<SpecStatus, string> = {
  done: "Implementat",
  partial: "Parțial",
  external: "În 1C / în afara CRM",
  na: "Nu se aplică",
  todo: "Neimplementat",
};
