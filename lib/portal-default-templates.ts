/**
 * Șabloanele standard de cereri pentru clienții din portal (Apă-Canal): cele 7 tipuri de cereri și petiția. Administratorul le adaugă dintr-un buton în
 * „Șabloane de cereri pentru clienți” (adaugă doar ce lipsește, după nume) și le poate modifica apoi ca pe orice alt șablon.
 *
 * Datele cererii (adresa, numele consumatorului, data depunerii — automată) sunt în formular pentru ORICE cerere, nu în text; `description` e doar punctul de pornire.
 */
export const DEFAULT_PORTAL_TEMPLATES: { name: string; title: string; description: string }[] = [
  {
    name: "Cerere de schimbare a contorului",
    title: "Cerere de schimbare a contorului",
    description: "Solicit schimbarea contorului de apă de la adresa indicată.\nMotivul (defect, expirarea verificării metrologice, alt motiv): ",
  },
  {
    name: "Cerere de recalculare",
    title: "Cerere de recalculare",
    description: "Solicit recalcularea consumului / a facturii.\nPerioada și motivul: ",
  },
  {
    name: "Cerere de resigilare",
    title: "Cerere de resigilare",
    description: "Solicit resigilarea contorului de la adresa indicată.\nMotivul (sigiliu deteriorat sau lipsă, după reparație, alt motiv): ",
  },
  {
    name: "Cerere de reconectare",
    title: "Cerere de reconectare",
    description: "Solicit reconectarea la rețeaua de apă și canalizare la adresa indicată.\nMotivul deconectării anterioare: ",
  },
  {
    name: "Cerere de conectare",
    title: "Cerere de conectare",
    description: "Solicit conectarea la rețeaua de apă și canalizare la adresa indicată.\nDetalii (imobil nou, tipul consumatorului): ",
  },
  {
    name: "Cerere de încheiere / reîncheiere a contractului",
    title: "Cerere de încheiere / reîncheiere a contractului",
    description: "Solicit încheierea (reîncheierea) contractului de furnizare a apei și de canalizare pentru adresa indicată.\nMotivul (consumator nou, schimbarea proprietarului, înnoire): ",
  },
  {
    name: "Cerere de verificare a contorului / locului de consum",
    title: "Cerere de verificare a contorului / locului de consum",
    description: "Solicit verificarea contorului și a locului de consum de la adresa indicată.\nMotivul solicitării: ",
  },
  {
    name: "Petiție",
    title: "Petiție",
    description: "Către conducerea întreprinderii,\n\nVă rog să examinați următoarea petiție:\n\n",
  },
];

/** Secțiile (echipe, inițial fără persoane) care se ocupă de cereri; se creează odată cu șabloanele standard, dacă lipsesc. Persoanele le adaugă administratorul în „Echipe”. */
export const DEFAULT_PORTAL_SECTIONS = ["Secția Energomecanică", "Secția Tehnică", "Secția Apă", "Secția Canal", "Secția Servicii Clienți"];

/** O petiție cere un text (descrierea nu poate rămâne goală); celelalte cereri se pot trimite și doar cu datele din formular. */
export const isPetitionName = (name: string | null | undefined): boolean => /^petiți/i.test((name ?? "").trim());

/** Câte caractere trebuie să aibă, cel puțin, textul unei petiții (peste punctul de pornire din șablon). */
export const PETITION_MIN_CHARS = 20;

export const PORTAL_REQUEST_MAX_ADDRESS = 300;
export const PORTAL_REQUEST_MAX_CONSUMER = 150;
