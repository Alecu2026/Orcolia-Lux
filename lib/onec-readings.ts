/**
 * Trimiterea citirilor către 1C — partea comună (server + browser): sursele, forma documentului și răspunsul serviciului.
 *
 * Fiecare document = „Introducerea indicilor contoarelor pentru un abonat” (Ввод показаний приборов учета абонента) din 1C:
 *   antet: data documentului, abonatul, tipul abonatului (persoană fizică / juridică), contul personal (fizică) sau numărul contractului (juridică), sursa;
 *   linii: numărul de uzină al contorului (Заводской номер) și indicele (Текущие данные).
 * Citirile cu surse diferite NU se amestecă niciodată într-un document: fiecare sursă are documentele ei.
 */

/** Sursa citirii, exact ca valorile „Источник” din 1C (vezi și lib/meters.ts, ONEC_ENUM). */
export const ONEC_SOURCE = {
  /** citirea făcută de cititorul din teren */
  CONTROLLER: "Контролер",
  /** indexul trimis de abonat din portal */
  SUBSCRIBER: "Абонент",
  /** contor LoRaWAN, citit automat (valoare nouă, se adaugă în 1C) */
  LORAWAN: "LoRaWAN",
  /** index calculat (estimat) */
  ESTIMATED: "Расчетный",
  /** act */
  ACT: "Акт",
} as const;

export type OneCSource = (typeof ONEC_SOURCE)[keyof typeof ONEC_SOURCE];

/** Sursa 1C pentru o citire salvată în CRM (`MeterReading.source`: „PORTAL”, „LORAWAN” sau lipsă = cititor din teren). */
export function oneCSourceOf(source: string | null | undefined): OneCSource {
  if (source === "PORTAL") return ONEC_SOURCE.SUBSCRIBER;
  if (source === "LORAWAN") return ONEC_SOURCE.LORAWAN;
  return ONEC_SOURCE.CONTROLLER;
}

export const SUBSCRIBER_TYPE = { PERSON: "Persoana fizica", COMPANY: "Persoana juridica" } as const;

/** Documentul trimis către 1C (un element din lista trimisă). Cheile sunt într-un singur loc, aici, ca să se poată potrivi ușor cu serviciul 1C. */
export type OneCDocument = {
  /** cheie stabilă a documentului (aceleași citiri = același id), pentru urmărire și, eventual, evitarea dublurilor în 1C */
  id: string;
  /** data documentului, „YYYY-MM-DD” */
  data: string;
  abonat: string;
  tip_abonat: (typeof SUBSCRIBER_TYPE)[keyof typeof SUBSCRIBER_TYPE];
  /** doar la persoane fizice */
  cont_personal: string | null;
  /** doar la persoane juridice */
  nr_contract: string | null;
  sursa: OneCSource;
  contoare: { nr_uzina: string; indice: number }[];
  /** identificatorul trimiterii (o apăsare pe „Trimite către 1C”), același în TOATE documentele ei: 1C păstrează doar documentele cu cel mai nou `lot` și le șterge pe celelalte (resturile trimiterilor de dinainte) */
  lot?: string;
  /** doar la primul document al primului lot dintr-o trimitere: 1C șterge buffer-ul vechi înainte de a adăuga lotul */
  sterge_buffer?: true;
};

/**
 * Răspunsul serviciului 1C = lungimea listei primite. Acceptă un număr simplu (`12`), text (`"12"`), un obiect cu câmpul `length` / `count` / `received` / `total` / `n`
 * sau o listă (se ia lungimea ei). Altceva → `null` (răspuns neînțeles: nu se socotește confirmat).
 */
export function parseConfirmedCount(body: string): number | null {
  const t = body.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  try {
    const j: unknown = JSON.parse(t);
    if (typeof j === "number" && Number.isInteger(j) && j >= 0) return j;
    if (typeof j === "string" && /^\d+$/.test(j.trim())) return Number(j.trim());
    if (Array.isArray(j)) return j.length;
    if (j && typeof j === "object") {
      for (const k of ["length", "count", "received", "total", "n", "lungime"]) {
        const v = (j as Record<string, unknown>)[k];
        if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
        if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
      }
    }
  } catch {
    /* nu e JSON */
  }
  return null;
}

/**
 * Modul „buffer”: 1C adaugă documentele într-un document-buffer comun și întoarce TOTALUL din buffer (cumulat, cu eventualele resturi), nu lungimea listei primite.
 * Lotul de `n` documente e confirmat dacă totalul a crescut cu cel puțin `n` față de `prev` (totalul de dinainte), sau dacă buffer-ul a fost golit înainte de lot
 * (semnalul `sterge_buffer` / un `lot` nou, ori golit de 1C între timp) și conține cel puțin lotul. `added` = câte documente socotim primite.
 */
export function judgeBufferReply(prev: number, n: number, total: number, reset: boolean): { ok: boolean; added: number } {
  if (total - prev >= n) return { ok: true, added: n };
  if (total >= n && (reset || total < prev)) return { ok: true, added: n };
  return { ok: false, added: Math.max(0, total - prev) };
}

/** Câte citiri / documente pe sursă (pentru previzualizare și rezultat). */
export type SourceCount = { source: OneCSource; readings: number; documents: number };

export type SendPreview = {
  configured: boolean;
  /** lunile căutate (luna curentă și cea de dinainte) */
  periods: string[];
  /** citiri noi, netrimise încă */
  pendingReadings: number;
  /** citiri trimise deja la care indexul s-a corectat după trimitere (se retrimit) */
  correctedReadings: number;
  /** citiri deja trimise și neschimbate (nu se mai trimit) */
  alreadySent: number;
  /** citiri care nu pot fi trimise: contorul / abonatul nu mai e în lista din 1C */
  unmatched: number;
  documents: number;
  /** trimiterea e limitată la lista filtrată din pagină: câte contoare (null = toate) */
  scopeMeters: number | null;
  /** citirile de trimis (inclusiv cele care nu pot fi trimise), pe luna citirii: arată de unde vin și citirile rămase după o ștergere (se verifică două luni) */
  byPeriod: Record<string, number>;
  /** retrimitere completă: se trimit și citirile deja trimise */
  resend: boolean;
  bySource: SourceCount[];
  /** primele documente, ca exemplu exact al ce pleacă (pentru verificare) */
  sample: OneCDocument[];
};

/** Un lot trimis: câte documente, ce a confirmat 1C, starea HTTP, durata și începutul răspunsului (pentru depanare). */
export type SendBatchLog = { batch: number; documents: number; /** totalul din buffer-ul 1C după lot (modul buffer) */ total?: number | null; /** semnalul „șterge buffer-ul” a plecat cu acest lot */ reset?: boolean; confirmed: number | null; ok: boolean; status: number | null; message: string | null; ms: number; body: string | null };

/** Rezultatul testului de conexiune (se trimite o listă goală; 1C ar trebui să răspundă 0). */
export type PingResult = { ok: boolean; status: number | null; ms: number; confirmed: number | null; body: string | null; message: string | null; host: string };

/** O rulare din jurnal (colecția OneCSendLog), pentru afișare. */
export type SendLogEntry = {
  id: string;
  at: string;
  userName: string;
  readings: number;
  documents: number;
  sent: number;
  failed: number;
  confirmed: number;
  details: { runId?: string; ms?: number; batches?: SendBatchLog[]; bySource?: SourceCount[]; failed?: FailedItem[]; unmatched?: number; remaining?: number; aborted?: boolean; markErrors?: number } | null;
};

export type FailedItem = { contor: string; abonat: string; sursa: OneCSource; indice: number; reason: string };

export type SendResult = {
  ok: boolean;
  /** documente trimise și confirmate de 1C în această rulare */
  sent: number;
  /** documente trimise dar neconfirmate / respinse */
  failed: number;
  /** suma lungimilor întoarse de 1C */
  confirmed: number;
  /** citiri marcate ca trimise */
  readingsSent: number;
  /** documente rămase (neîncercate) din cauza timpului — se continuă cu o nouă cerere */
  remaining: number;
  /** rularea s-a oprit din cauza unei erori de conexiune / cod de acces: nu are rost să se repete cererea */
  aborted: boolean;
  /** citiri care nu pot fi trimise deloc (lipsește contul / contractul sau contorul) */
  unmatched: number;
  /** loturi trimise și confirmate, dar la care marcarea „trimis” din baza de date a eșuat (risc de dublură la o nouă trimitere) */
  markErrors: number;
  /** durata rulării, ms */
  ms: number;
  /** identificatorul rulării (apare și în logurile serverului) */
  runId: string;
  batches: SendBatchLog[];
  failedItems: FailedItem[];
  /** ids ale citirilor din loturile eșuate: la cererea următoare se exclud, ca să nu fie reîncercate în buclă */
  failedReadingIds: string[];
  bySource: SourceCount[];
  message: string | null;
  /** identificatorul trimiterii (`lot`): același la toate rundele unei apăsări */
  session: string | null;
  /** retrimitere completă: momentul de la care citirile marcate „trimis” sunt din rularea curentă (rundele următoare nu le mai trimit); altfel null */
  since: string | null;
};
