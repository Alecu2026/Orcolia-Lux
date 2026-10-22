"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Rnd } from "react-rnd";
import type { Company } from "@/lib/queries/company";
import { fmtDate } from "./invoice-meta";
import {
  MM_TO_PX,
  round1,
  APA_CANAL_LAYOUT_DEFAULTS,
  APA_CANAL_TEXT_KEYS,
  APA_CANAL_DEFAULT_FONT_MM,
  PAGE_W_MM,
  PAGE_H_MM,
  minSizeMm,
  clampBox,
  sanitizeApaCanalLayout,
  applyApaCanalVariables,
  type BoxMm,
  type ApaCanalLayout,
  type ApaCanalElementKey,
  type ApaCanalElementOverride,
  type ApaCanalCustomImage,
} from "@/lib/apa-canal-layout";

type ConsumPoint = { label: string; value: number };

export type ApaCanalInvoiceData = {
  number: string;
  issueDate: Date;
  dueDate: Date | null;
  currency: string;
  contPersonal: string | null;
  sectorNr: string | null;
  consumAddress: string | null;
  consumerName: string | null;
  meterNumber: string | null;
  meterPrevReading: string | null;
  meterCurrReading: string | null;
  isEstimatedVolume: boolean;
  billingPeriodLabel: string | null;
  recalculari: number;
  penalitati: number;
  datoriiAvans: number;
  subtotal: number;
  grandTotal: number;
  monthlyConsumption: unknown;
  client: { name: string } | null;
  items: { id: string; description: string; quantity: number; unitPrice: number; lineTotal: number }[];
};

// Paleta exactă extrasă din modelul de factură Apă-Canal.
const COLOR_BG = "#FCFDFC";
const COLOR_BOX_BLUE = "#86D3EA";
const COLOR_BAR = "#5B9BD5";
const COLOR_BAR_BORDER = "#2E75B6";
const COLOR_CHART_TEXT = "#404040";
const COLOR_TEXT = "#202C2A";
const COLOR_BORDER = "#AEB0B0";
const COLOR_BORDER_LIGHT = "#D9DDDD";
const COLOR_RED = "#E53935";

const num2 = (n: number) => n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// "ap[aă]" — acceptă "apa" (fără diacritic, cum scriu formularele din aplicație) și "apă"
// (corect gramatical, din exportul 1C importat) — vezi explicația la locul de folosire.
const isApa = (description: string) => /alimentare cu ap[aă]/i.test(description);

/**
 * Volum/tarif pentru o linie de serviciu — "—" în loc de "0,00" exact acolo unde afișarea unui
 * zero ar face suma arăta ca o eroare de calcul (0 × orice = sumă nenulă, contradictoriu vizual).
 * Cazul e real în datele importate: unele linii au sumă calculată reală dar volum și/sau tarif
 * nu s-au înregistrat separat în sursă — nu inventăm o valoare, doar nu mai afișăm un zero fals.
 * Un consum cu adevărat nul (volum 0, sumă 0) tot arată "0,00" — acolo zero e corect și clar.
 */
function factorOrDash(value: number, lineTotal: number): string {
  return value === 0 && lineTotal !== 0 ? "—" : num2(value);
}

/** Valorile live ale unei facturi, pentru variabilele din „Text personalizat” ({cont}, {total}…) — vezi APA_CANAL_VARIABLES. */
export function buildApaCanalVars(invoice: ApaCanalInvoiceData, company: Company): Record<string, string> {
  const apa = invoice.items.filter((it) => isApa(it.description));
  const canal = invoice.items.filter((it) => !isApa(it.description) && /canalizare/i.test(it.description));
  const total = (arr: typeof apa, pick: (it: (typeof apa)[number]) => number) => arr.reduce((s, it) => s + pick(it), 0);
  const first = (arr: typeof apa, pick: (it: (typeof apa)[number]) => string) => (arr[0] ? pick(arr[0]) : "—");
  return {
    numar: invoice.number,
    emitere: fmtDate(invoice.issueDate),
    scadenta: fmtDate(invoice.dueDate),
    perioada: invoice.billingPeriodLabel ? invoice.billingPeriodLabel.toUpperCase() : "—",
    valuta: invoice.currency,
    cont: invoice.contPersonal || "—",
    sector: invoice.sectorNr || "—",
    consumator: invoice.consumerName || invoice.client?.name || "—",
    adresa: invoice.consumAddress || "—",
    contor: invoice.meterNumber || "—",
    indPrec: invoice.meterPrevReading || "—",
    indAct: invoice.meterCurrReading || "—",
    volumEst: invoice.isEstimatedVolume ? "DA" : "",
    apaVolum: apa.length ? num2(total(apa, (it) => it.quantity)) : "—",
    apaTarif: first(apa, (it) => factorOrDash(it.unitPrice, it.lineTotal)),
    apaSuma: apa.length ? num2(total(apa, (it) => it.lineTotal)) : "—",
    canalVolum: canal.length ? num2(total(canal, (it) => it.quantity)) : "—",
    canalTarif: first(canal, (it) => factorOrDash(it.unitPrice, it.lineTotal)),
    canalSuma: canal.length ? num2(total(canal, (it) => it.lineTotal)) : "—",
    recalculari: num2(invoice.recalculari),
    penalitati: num2(invoice.penalitati),
    suma: num2(invoice.subtotal),
    datorii: num2(invoice.datoriiAvans),
    total: num2(invoice.grandTotal),
    firma: company.apaCanalCompanyLine,
    firmaAdresa: company.apaCanalAddress,
    firmaEmail: company.apaCanalEmail,
    firmaCodFiscal: company.apaCanalCodFiscal,
    contactNume: company.apaCanalContactName,
    contacte: company.apaCanalContactsText,
    atentie: company.apaCanalAtentieText,
    anunt: company.apaCanalAnuntText,
  };
}

/** Rotunjește la un "număr frumos" (1/2/5 × 10^n) — ține numărul de linii de grilă mereu rezonabil. */
function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * pow;
}

/**
 * Grafic cu bare + linii orizontale de grilă. Pasul dintre linii se recalculează per factură,
 * din consumul maxim al LUNII respective (nu e fix) — ținta e ~8 trepte, deci facturi cu consum
 * mic ies cu pas 5 (0,5,10,15,20...), iar cele cu consum mare ies cu pas 10/20/50 etc., mereu
 * păstrând un grafic lizibil indiferent de magnitudinea cifrelor.
 */
function ConsumptionChart({ points, fill = false }: { points: ConsumPoint[]; fill?: boolean }) {
  if (points.length === 0) return null;
  const maxVal = Math.max(...points.map((p) => p.value), 5);
  const step = niceStep(maxVal / 8);
  const yMax = Math.ceil(maxVal / step) * step;
  const ySteps: number[] = [];
  for (let v = yMax; v >= 0; v -= step) ySteps.push(Math.round(v * 100) / 100);

  return (
    <div
      className="flex gap-[1.5mm] overflow-hidden p-[1.5mm]"
      style={{ height: fill ? undefined : "44mm", flex: fill ? 1 : undefined, minHeight: 0, background: COLOR_BG, border: `1px solid ${COLOR_BORDER}` }}
    >
      <div className="flex h-full shrink-0 flex-col justify-between text-right leading-none" style={{ color: COLOR_CHART_TEXT, fontSize: "2.6mm" }}>
        {ySteps.map((s) => <span key={s}>{s}</span>)}
      </div>
      <div className="relative flex-1">
        {/* Linii orizontale de grilă */}
        {ySteps.map((s) => (
          <div
            key={s}
            className="absolute left-0 right-0"
            style={{ bottom: `${(s / yMax) * 100}%`, borderTop: `0.5px solid ${COLOR_BORDER_LIGHT}` }}
          />
        ))}
        {/* Bare — lățimea maximă se adaptează la număr (puține puncte, ex. o singură lună
            importată, ar lăsa altfel o bară firavă rătăcită într-un grafic gol). */}
        <div className="relative flex h-full items-end gap-[0.8mm]">
          {points.map((p, i) => (
            <div key={i} className="flex h-full flex-1 flex-col items-center justify-end">
              <div
                className="w-full"
                style={{
                  maxWidth: `${Math.min(20, 84 / points.length)}mm`,
                  // Valori negative apar real (corecții/recalculări din 1C care reduc un consum
                  // raportat greșit anterior) — fără acest caz separat, Math.max(1, ...) le arăta
                  // ca un firicel abia vizibil, identic vizual cu un consum mic dar POZITIV,
                  // ceea ce induce în eroare (bara nu trebuie desenată deloc pentru o corecție).
                  height: p.value < 0 ? 0 : `${Math.max(1, (p.value / yMax) * 100)}%`,
                  background: COLOR_BAR,
                  border: p.value < 0 ? "none" : `0.6px solid ${COLOR_BAR_BORDER}`,
                }}
                title={p.value < 0 ? `${p.label}: corecție ${p.value} m³` : `${p.label}: ${p.value} m³`}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ConsumptionChartLabels({ points }: { points: ConsumPoint[] }) {
  if (points.length === 0) return null;
  return (
    <div className="flex gap-[1.5mm]">
      <div className="shrink-0" style={{ width: "7mm" }} />
      <div className="flex flex-1 gap-[0.8mm]">
        {points.map((p, i) => (
          <span key={i} className="flex-1 text-center" style={{ color: COLOR_CHART_TEXT, fontSize: "2.6mm" }}>{p.label}</span>
        ))}
      </div>
    </div>
  );
}

type FieldState = { overridden: boolean; textStyle: React.CSSProperties };

/** Casetele colorate își păstrează fundalul și rotunjirea și când conținutul lor e înlocuit cu „Text personalizat”. */
const BOX_OVERRIDE_STYLE: Partial<Record<ApaCanalElementKey, React.CSSProperties>> = {
  totalsBox: { background: COLOR_BOX_BLUE, borderRadius: "3mm", padding: "2mm 3mm" },
  atentieBox: { background: COLOR_BOX_BLUE, borderRadius: "3.5mm", padding: "2.5mm 3.5mm" },
  anuntBox: { background: COLOR_BOX_BLUE, borderRadius: "7mm", padding: "2.5mm 3.5mm", textAlign: "center" },
};

/**
 * Fiecare element de pe factură trece prin acest wrapper. Dacă firma nu are deloc un șablon
 * salvat, se randează exact ca înainte (în flux normal, grid/flex) — nicio schimbare de
 * comportament pentru facturile care nu ating niciodată editorul.
 *
 * Odată ce EXISTĂ un șablon salvat (chiar dacă doar CÂTEVA elemente au fost mutate), TOATE cele
 * 17 elemente trec la poziționare absolută (override ?? implicit) — nu doar cele explicit
 * suprascrise. Motiv: un element scos din flux (poziționat absolut) nu mai ocupă loc în
 * grid/flex-ul original, iar grila își recalculează lățimile coloanelor pe baza elementelor
 * RĂMASE în flux — deci, dacă doar meterTable are o suprascriere iar chart rămâne în flux,
 * coloana "auto" (dimensionată după meterTable) se micșorează și coloana "1fr" a graficului se
 * lărgește, făcând graficul să se suprapună peste tabelul contorului poziționat absolut. Editorul
 * nu are niciodată această problemă fiindcă scoate mereu TOATE elementele din flux deodată
 * (simetric) — de-asta arăta corect acolo dar greșit pe factura reală. Trecând toate elementele
 * la absolut simultan, imediat ce oricare are o suprascriere, eliminăm asimetria.
 */
function LayoutField({
  elementKey,
  layout,
  hasCustomLayout,
  editable,
  onChange,
  defaultStyle,
  children,
  scale = 1,
  portalTarget,
  defaults,
  vars,
  selected = false,
  onSelect,
  snapMm = 0,
}: {
  elementKey: ApaCanalElementKey;
  /** Poziții/mărimi de pornire MĂSURATE pe factura reală (editorul) — au prioritate față de cele fixe din cod. */
  defaults?: Partial<Record<ApaCanalElementKey, BoxMm>>;
  /** Valorile variabilelor ({cont}…) pentru textul personalizat. */
  vars?: Record<string, string>;
  selected?: boolean;
  onSelect?: (key: ApaCanalElementKey) => void;
  /** Pas de lipire la grilă, mm (0 = liber). */
  snapMm?: number;
  layout?: ApaCanalLayout | null;
  /** Adevărat dacă firma are ORICE șablon salvat (indiferent dacă acest element anume a fost mutat). */
  hasCustomLayout?: boolean;
  editable?: boolean;
  onChange?: (key: ApaCanalElementKey, override: ApaCanalElementOverride) => void;
  defaultStyle: React.CSSProperties;
  children: (state: FieldState) => React.ReactNode;
  /** Factorul de scalare vizuală a previzualizării în editor (react-rnd trebuie să știe de el ca să convertească corect delta-urile de mouse). */
  scale?: number;
  /** Nodul `.invoice-page` — react-rnd randează prin portal direct în el (vezi explicația de mai jos). */
  portalTarget?: HTMLElement | null;
}) {
  const override = layout?.[elementKey];
  // Notă: NU includem chei cu valoare `undefined` — un spread `{...textStyle}` peste un
  // `fontSize` implicit ar suprascrie acel implicit cu `undefined` chiar dacă cheia există
  // doar cu valoarea `undefined` (spread-ul copiază cheia, nu doar valorile "adevărate").
  const textStyle: React.CSSProperties = {
    ...(override?.fontSizeMm ? { fontSize: `${override.fontSizeMm}mm` } : {}),
    ...(override?.bold ? { fontWeight: 700 } : {}),
  };

  // Text personalizat — înlocuiește complet conținutul normal (vezi ApaCanalElementOverride).
  const renderContent = (state: FieldState) =>
    override?.textOverride ? (
      <div
        style={{
          width: "100%",
          height: "100%",
          overflow: "hidden",
          color: COLOR_TEXT,
          fontSize: `${APA_CANAL_DEFAULT_FONT_MM[elementKey] ?? 3}mm`,
          lineHeight: 1.4,
          ...BOX_OVERRIDE_STYLE[elementKey],
          ...state.textStyle,
        }}
      >
        {applyApaCanalVariables(override.textOverride, vars ?? {}).split("\n").map((line, i) => <p key={i}>{line || " "}</p>)}
      </div>
    ) : (
      children(state)
    );

  if (!editable && !hasCustomLayout) {
    return <div data-el={elementKey} style={defaultStyle}>{renderContent({ overridden: false, textStyle })}</div>;
  }

  const base = defaults?.[elementKey] ?? APA_CANAL_LAYOUT_DEFAULTS[elementKey];
  const ov = {
    xMm: override?.xMm ?? base.xMm,
    yMm: override?.yMm ?? base.yMm,
    widthMm: override?.widthMm ?? base.widthMm,
    heightMm: override?.heightMm ?? base.heightMm,
  };
  const merged: ApaCanalElementOverride = {
    ...ov,
    fontSizeMm: override?.fontSizeMm,
    bold: override?.bold,
    textOverride: override?.textOverride,
  };

  if (!editable) {
    return (
      <div style={{ position: "absolute", left: `${ov.xMm}mm`, top: `${ov.yMm}mm`, width: `${ov.widthMm}mm`, height: `${ov.heightMm}mm` }}>
        {renderContent({ overridden: true, textStyle })}
      </div>
    );
  }

  // Randăm prin portal direct în `.invoice-page`, nu inline la locul din JSX (care e mereu
  // imbricat în alte div-uri grid/flex de layout). Motiv: la montare, react-rnd își corectează
  // singur poziția presupunând că PROPRIUL PĂRINTE DOM e chiar blocul de referință (containing
  // block) pentru poziționarea absolută — dar la noi blocul de referință real e mereu
  // `.invoice-page` (singurul cu `position:relative`), care poate fi cu multe niveluri mai sus.
  // Pentru elementele al căror părinte DOM imediat era departe de originea paginii (ex. coloana
  // din dreapta cu Anunț/Contacte/Scanează, plasată la ~220mm), acea auto-corecție producea
  // poziții complet greșite (dublate) — verificat direct în sursa react-rnd
  // (`updateOffsetFromParent`/`componentDidMount`). Portalul elimină problema: părintele DOM
  // devine chiar `.invoice-page`, exact ce presupune biblioteca.
  if (!portalTarget) return null;
  return createPortal(
    <Rnd
      // Necontrolat (`default`, nu `size`/`position`) — cu props controlate, react-rnd
      // "luptă" cu propriul drag intern dacă părintele nu retrimite poziția pe FIECARE
      // `onDrag` (nu doar la `onDragStop`), ceea ce anula practic tragerea cu mouse-ul.
      // `key` forțează un remount (deci resincronizare la valoarea nouă) când utilizatorul
      // schimbă X/Y/lățime/înălțime din câmpurile numerice, nu prin tragere.
      key={`${ov.xMm}-${ov.yMm}-${ov.widthMm}-${ov.heightMm}`}
      default={{
        x: ov.xMm * MM_TO_PX,
        y: ov.yMm * MM_TO_PX,
        width: ov.widthMm * MM_TO_PX,
        height: ov.heightMm * MM_TO_PX,
      }}
      bounds="parent"
      minWidth={minSizeMm(elementKey).w * MM_TO_PX}
      minHeight={minSizeMm(elementKey).h * MM_TO_PX}
      dragGrid={snapMm > 0 ? [snapMm * MM_TO_PX, snapMm * MM_TO_PX] : undefined}
      resizeGrid={snapMm > 0 ? [snapMm * MM_TO_PX, snapMm * MM_TO_PX] : undefined}
      onMouseDown={() => onSelect?.(elementKey)}
      onDragStart={() => onSelect?.(elementKey)}
      onDragStop={(_e, d) => {
        const b = clampBox({ xMm: d.x / MM_TO_PX, yMm: d.y / MM_TO_PX, widthMm: ov.widthMm, heightMm: ov.heightMm }, minSizeMm(elementKey));
        onChange?.(elementKey, { ...merged, xMm: b.xMm, yMm: b.yMm });
      }}
      onResizeStop={(_e, _dir, ref, _delta, pos) => {
        const newHeightMm = round1(ref.offsetHeight / MM_TO_PX);
        // Textul urmează caseta: la tras de colț (mărire/micșorare), mărimea fontului se
        // scalează proporțional cu înălțimea nouă — altfel caseta se mărește dar textul din
        // ea rămâne mereu la mărimea implicită, dând impresia că "doar rama se mărește".
        const isText = (APA_CANAL_TEXT_KEYS as ApaCanalElementKey[]).includes(elementKey);
        const ratio = ov.heightMm > 0 ? newHeightMm / ov.heightMm : 1;
        const scaledFontSizeMm = isText
          ? Math.min(24, Math.max(1.5, round1((merged.fontSizeMm ?? APA_CANAL_DEFAULT_FONT_MM[elementKey] ?? 3) * ratio)))
          : merged.fontSizeMm;
        const b = clampBox(
          { xMm: pos.x / MM_TO_PX, yMm: pos.y / MM_TO_PX, widthMm: ref.offsetWidth / MM_TO_PX, heightMm: newHeightMm },
          minSizeMm(elementKey),
        );
        onChange?.(elementKey, {
          ...merged,
          ...b,
          ...(isText ? { fontSizeMm: scaledFontSizeMm } : {}),
        });
      }}
      scale={scale}
      style={{
        outline: selected ? "2px solid #0d9488" : `1px dashed ${COLOR_BAR}`,
        background: selected ? "rgba(13,148,136,0.14)" : "rgba(134,211,234,0.10)",
        zIndex: selected ? 45 : undefined,
      }}
    >
      <div style={{ width: "100%", height: "100%" }}>{renderContent({ overridden: true, textStyle })}</div>
    </Rnd>,
    portalTarget,
  );
}

/**
 * Fotografie adăugată liber pe factură (nu unul din cele 17 elemente fixe) — aceeași mecanică
 * de poziționare/portal ca LayoutField, dar mai simplă: doar imagine, fără text/font.
 */
function CustomImageField({
  image,
  editable,
  onChange,
  scale = 1,
  portalTarget,
}: {
  image: ApaCanalCustomImage;
  editable?: boolean;
  onChange?: (id: string, patch: Partial<ApaCanalCustomImage>) => void;
  scale?: number;
  portalTarget?: HTMLElement | null;
}) {
  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={image.dataUrl}
      alt=""
      draggable={false}
      style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: editable ? "none" : undefined }}
    />
  );

  if (!editable) {
    return (
      <div style={{ position: "absolute", left: `${image.xMm}mm`, top: `${image.yMm}mm`, width: `${image.widthMm}mm`, height: `${image.heightMm}mm` }}>
        {img}
      </div>
    );
  }

  if (!portalTarget) return null;
  return createPortal(
    <Rnd
      key={`${image.id}-${image.xMm}-${image.yMm}-${image.widthMm}-${image.heightMm}`}
      default={{
        x: image.xMm * MM_TO_PX,
        y: image.yMm * MM_TO_PX,
        width: image.widthMm * MM_TO_PX,
        height: image.heightMm * MM_TO_PX,
      }}
      onDragStop={(_e, d) => {
        onChange?.(image.id, { xMm: round1(d.x / MM_TO_PX), yMm: round1(d.y / MM_TO_PX) });
      }}
      onResizeStop={(_e, _dir, ref, _delta, pos) => {
        onChange?.(image.id, {
          widthMm: round1(ref.offsetWidth / MM_TO_PX),
          heightMm: round1(ref.offsetHeight / MM_TO_PX),
          xMm: round1(pos.x / MM_TO_PX),
          yMm: round1(pos.y / MM_TO_PX),
        });
      }}
      scale={scale}
      style={{ outline: `1px dashed ${COLOR_BAR}`, background: "rgba(134,211,234,0.10)" }}
    >
      <div style={{ width: "100%", height: "100%" }}>{img}</div>
    </Rnd>,
    portalTarget,
  );
}

export default function ApaCanalInvoicePublic({
  invoice,
  company,
  layout: layoutProp,
  editable,
  onLayoutChange,
  onCustomImageChange,
  previewScale = 1,
  consumptionHistory,
  defaults,
  selectedKey,
  onSelect,
  snapMm = 0,
  showGrid = false,
}: {
  invoice: ApaCanalInvoiceData;
  company: Company;
  layout?: ApaCanalLayout | null;
  /** Poziții de pornire măsurate pe factura reală (doar editorul) — vezi ApaCanalLayoutEditor. */
  defaults?: Partial<Record<ApaCanalElementKey, BoxMm>>;
  selectedKey?: ApaCanalElementKey | null;
  onSelect?: (key: ApaCanalElementKey) => void;
  snapMm?: number;
  /** Grilă de 10mm + marginea de siguranță (doar editorul). */
  showGrid?: boolean;
  editable?: boolean;
  onLayoutChange?: (key: ApaCanalElementKey, override: ApaCanalElementOverride) => void;
  onCustomImageChange?: (id: string, patch: Partial<ApaCanalCustomImage>) => void;
  /** Factorul de scalare CSS aplicat de containerul din editor (vezi ApaCanalLayoutEditor). */
  previewScale?: number;
  /** Trend pe ultimele luni ale clientului (vezi getApaCanalConsumptionHistory) — dacă lipsește
   * (ex. în editorul de șablon, care nu are un client real), cade pe luna facturii curente. */
  consumptionHistory?: ConsumPoint[];
}) {
  // "ap[aă]" — acceptă atât "apa" (fără diacritice, cum scriu formularele din aplicație), cât
  // și "apă" (corect gramatical, cum apare în descrierile importate din exportul 1C) — fără
  // asta, liniile de consum de apă din facturile importate dispar din tabel (regex nu găsea
  // niciodată "apă"), iar suma calculată afișată era greșit doar cea de canalizare.
  //
  // TOATE liniile, nu doar prima cu .find() — ~1.873 facturi (din import) au mai mult de o
  // linie de apă/canal (recalculări/corecții din aceeași perioadă, în sursa 1C); .find() le
  // arăta pe client doar UNA, ascunzând restul sumelor reale facturate din tabelul afișat.
  // Șablonul trece mereu prin curățare: un șablon stricat (valori lipsă/negative/în afara paginii) nu poate rupe factura.
  const layout = useMemo(() => (layoutProp ? sanitizeApaCanalLayout(layoutProp) : null), [layoutProp]);
  const vars = useMemo(() => buildApaCanalVars(invoice, company), [invoice, company]);
  const apaItems = invoice.items.filter((it) => isApa(it.description));
  const canalItems = invoice.items.filter((it) => !isApa(it.description) && /canalizare/i.test(it.description));
  // Din invoice.subtotal (verificat mereu egal cu suma liniilor — vezi backfill-ul de audit),
  // NU resumat din apaItems/canalItems aici — mai robust, nu depinde de regex-ul de mai sus.
  const sumaCalculata = invoice.subtotal;

  // Un șablon salvat (editor) fixează poziția elementelor de sub tabelul de servicii presupunând
  // mereu 2 rânduri (câte o linie de apă + una de canal) — dar ~11% din facturile din import au
  // MAI MULTE linii (recalculări/corecții din aceeași perioadă, în sursa 1C, până la câteva zeci),
  // caz în care tabelul se întinde vizual peste "Recalculări/Penalitate", caseta de total și
  // caseta "Atenție", poziționate absolut la o înălțime fixă (măsurat direct pe o factură reală
  // cu 4 rânduri: tabelul ajungea la ~129mm, cu 9mm peste "recalculariText", fixat la 120mm).
  // Compensăm împingând acele elemente în jos cu exact cât depășește tabelul înălțimea bugetată
  // — 6.2mm/rând, măsurat direct din randare la acest font/padding.
  const TABLE_BASELINE_ROWS = 2;
  const TABLE_ROW_HEIGHT_MM = 6.2;
  const points: ConsumPoint[] =
    consumptionHistory ?? (Array.isArray(invoice.monthlyConsumption) ? (invoice.monthlyConsumption as ConsumPoint[]) : []);

  // Necesar doar în editor (`editable`): ținta portalului prin care randăm fiecare Rnd
  // direct în `.invoice-page` — vezi explicația din LayoutField.
  const [pageEl, setPageEl] = useState<HTMLDivElement | null>(null);

  const hasCustomLayout = !!layout && Object.keys(layout).length > 0;

  // Doar când există un șablon salvat (altfel tabelul e în flux normal — vezi LayoutField — și
  // își împinge singur vecinii mai jos, fără nicio suprapunere posibilă).
  const itemRowCount = apaItems.length + canalItems.length;
  // În editor NU împingem elementele: valorile afișate/salvate trebuie să fie exact cele din șablon.
  const tableOverflowMm = hasCustomLayout && !editable ? Math.max(0, itemRowCount - TABLE_BASELINE_ROWS) * TABLE_ROW_HEIGHT_MM : 0;
  // `.invoice-page` are `overflow: hidden` la 210mm (o singură pagină A4, tăiată strict) — pentru
  // cazurile extreme (rare: până la 38 de linii pe o factură), împingerea nelimitată ar scoate
  // caseta de total complet în afara paginii (invizibilă), ceea ce e mai rău decât suprapunerea
  // originală (măcar parțial vizibilă). Plafonăm împingerea per element, la propria poziție +
  // înălțime, ca niciunul să nu treacă de marginea inferioară sigură a paginii tipărite.
  const SAFE_PAGE_BOTTOM_MM = 200;
  const shiftedYMm = (key: ApaCanalElementKey): ApaCanalElementOverride => {
    const existing = layout?.[key];
    const baseYMm = existing?.yMm ?? APA_CANAL_LAYOUT_DEFAULTS[key].yMm;
    const heightMm = existing?.heightMm ?? APA_CANAL_LAYOUT_DEFAULTS[key].heightMm;
    const maxShiftMm = Math.max(0, SAFE_PAGE_BOTTOM_MM - heightMm - baseYMm);
    return { ...existing, yMm: baseYMm + Math.min(tableOverflowMm, maxShiftMm) };
  };
  const effectiveLayout: ApaCanalLayout | null | undefined =
    tableOverflowMm > 0
      ? {
          ...layout,
          recalculariText: shiftedYMm("recalculariText"),
          totalsConnectorLine: shiftedYMm("totalsConnectorLine"),
          totalsBox: shiftedYMm("totalsBox"),
          atentieBox: shiftedYMm("atentieBox"),
        }
      : layout;

  // Factura publică (nu editor) e A4 landscape la mărime reală (~1122px lățime) — pe telefon
  // depășește mereu ecranul, deci fără scalare utilizatorul vedea doar o bucată "zoomată",
  // trebuind să facă pinch-zoom/scroll ca s-o citească. Se scalează doar pe ECRAN (vezi CSS:
  // `@media print` resetează la mărime reală cu !important, indiferent de această valoare) —
  // PDF-ul (Playwright emulează print media) și tipărirea rămân neafectate.
  const scaleWrapRef = useRef<HTMLDivElement>(null);
  const [autoScale, setAutoScale] = useState(1);
  useEffect(() => {
    if (editable) return; // editorul are propriul mecanism de scalare (ApaCanalLayoutEditor)
    const el = scaleWrapRef.current;
    if (!el) return;
    const pageWidthPx = PAGE_W_MM * MM_TO_PX;
    const update = () => {
      const availW = el.clientWidth;
      setAutoScale(availW > 0 ? Math.min(1, availW / pageWidthPx) : 1);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [editable]);

  const field = (
    elementKey: ApaCanalElementKey,
    defaultStyle: React.CSSProperties,
    children: (state: FieldState) => React.ReactNode,
  ) => (
    <LayoutField
      elementKey={elementKey}
      layout={effectiveLayout}
      hasCustomLayout={hasCustomLayout}
      editable={editable}
      onChange={onLayoutChange}
      defaultStyle={defaultStyle}
      scale={previewScale}
      portalTarget={pageEl}
      defaults={defaults}
      vars={vars}
      selected={selectedKey === elementKey}
      onSelect={onSelect}
      snapMm={snapMm}
    >
      {children}
    </LayoutField>
  );

  const pageContent = (
      <div className="invoice-page" ref={editable ? setPageEl : undefined}>
        {/* ── Titlu, pe toată lățimea ── */}
        <div style={{ gridColumn: "1 / -1", gridRow: 1 }}>
          {field("title", {}, ({ textStyle }) => (
            <h1 style={{ fontSize: "4mm", fontWeight: 600, margin: "0 0 1.5mm", ...textStyle }}>
              Factura pentru serviciul de alimentare cu apă și de canalizare
            </h1>
          ))}
          {field("titleLine", {}, ({ overridden }) =>
            overridden ? (
              // Zonă de tras/redimensionat mai generoasă (implicit 3mm) — linia rămâne mai
              // subțire decât zona de prindere (1.1mm), centrată pe verticală în interior.
              <div className="flex h-full w-full items-center">
                <div style={{ width: "100%", height: "1.1mm", background: COLOR_BOX_BLUE }} />
              </div>
            ) : (
              <div style={{ height: "1.1mm", width: "calc(100% - 65mm)", background: COLOR_BOX_BLUE }} />
            )
          )}
        </div>

        {/* ── Rânduri 2-3, pe toată lățimea: UN SINGUR grid (chart | cont-personal/tabel | logo/text)
             — evită să depindem de repartizarea automată (imprevizibilă) a înălțimii între rândurile
             grid-ului exterior atunci când elementele se întind pe mai multe rânduri; aici tabelul
             contorului și textul companiei sunt literalmente pe același rând de grid, deci sunt
             mereu perfect aliniate, indiferent de ce se schimbă în jur. Fiecare bloc e totuși
             suprascriibil individual prin `field(...)`, care iese din grid dacă e mutat. ── */}
        <div style={{ gridColumn: "1 / -1", gridRow: "2 / 4", display: "grid", gridTemplateColumns: "1fr auto 27%", columnGap: "5mm" }}>
          {field(
            "datesBlock",
            { gridColumn: 1, gridRow: 1, marginTop: "2.5mm", alignSelf: "start" },
            ({ textStyle }) => (
              <div className="shrink-0 whitespace-nowrap" style={{ fontSize: "3mm", lineHeight: 1.7, ...textStyle }}>
                <p>Data emiterii: <b>{fmtDate(invoice.issueDate)}</b></p>
                <p>Data limită de achitare: <b>{fmtDate(invoice.dueDate)}</b></p>
              </div>
            ),
          )}

          {field(
            "contPersonalBlock",
            { gridColumn: 2, gridRow: 1, marginTop: "2.5mm", alignSelf: "start" },
            ({ textStyle }) => (
              <div className="whitespace-nowrap font-bold" style={{ fontSize: "3.6mm", lineHeight: 1.7, color: "#000000", ...textStyle }}>
                <p>
                  Cont personal: {invoice.contPersonal || "—"}
                  {invoice.sectorNr && (
                    <span className="ml-2 font-normal">
                      {/* Coduri scurte de sector (ex. "5sp", introduse manual de staff, fără spațiu)
                          au eticheta "sector nr."; categoriile descriptive din exportul importat —
                          "Sector privat"/"Sector comunal", dar și "Agenti economici 1"/"2" pentru
                          clienți persoane juridice — se afișează simplu, fără etichetă (verificat
                          direct în date: toate cele 4 categorii descriptive au un spațiu, cele 2
                          coduri scurte n-au — mai robust decât un test explicit după cuvântul
                          "sector", care rata categoriile fără acel cuvânt, ex. "Agenti economici"). */}
                      {/\s/.test(invoice.sectorNr.trim()) ? (
                        invoice.sectorNr
                      ) : (
                        <>
                          <span className="rounded" style={{ border: `1.5px solid #000000`, padding: "0 1mm", fontSize: "3.1mm" }}>sector nr.</span>{" "}
                          {invoice.sectorNr}
                        </>
                      )}
                    </span>
                  )}
                </p>
                <p>Adresa locului de consum:</p>
                <p>{invoice.consumAddress || "—"}</p>
                <p className="uppercase">{invoice.consumerName || invoice.client?.name || ""}</p>
              </div>
            ),
          )}

          {field(
            "logo",
            { gridColumn: 3, gridRow: 1, display: "flex", justifyContent: "center", alignSelf: "start" },
            ({ overridden }) =>
              company.apaCanalLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={company.apaCanalLogo}
                  alt={company.apaCanalCompanyLine}
                  className="object-contain"
                  draggable={false}
                  style={overridden ? { width: "100%", height: "100%", pointerEvents: editable ? "none" : undefined } : { width: "100%", height: "auto" }}
                />
              ) : editable ? (
                <div className="flex h-full w-full items-center justify-center text-xs" style={{ color: COLOR_BORDER, border: `1px dashed ${COLOR_BORDER}` }}>Logo</div>
              ) : null,
          )}

          {field(
            "chart",
            { gridColumn: 1, gridRow: 2, marginTop: "3mm", alignSelf: "center" },
            ({ overridden }) => (
              <div style={overridden ? { width: "100%", height: "100%", display: "flex", flexDirection: "column" } : { width: "100%" }}>
                <ConsumptionChart points={points} fill={overridden} />
                <ConsumptionChartLabels points={points} />
              </div>
            ),
          )}

          {field(
            "meterTable",
            { gridColumn: 2, gridRow: 2, marginTop: "3mm", alignSelf: "start" },
            ({ textStyle }) => (
              <table className="text-center" style={{ fontSize: "3.6mm", ...textStyle }}>
                <thead>
                  <tr style={{ color: COLOR_BORDER }}>
                    <th className="whitespace-nowrap font-medium" style={{ padding: "0 2mm 1mm" }}>Numărul<br />contorului</th>
                    <th className="whitespace-nowrap font-medium" style={{ padding: "0 2mm 1mm" }}>Indicii<br />precedenți</th>
                    <th className="whitespace-nowrap font-medium" style={{ padding: "0 2mm 1mm" }}>Indicii<br />actuali</th>
                    <th className="whitespace-nowrap font-medium" style={{ padding: "0 2mm 1mm" }}>Volum<br />estimativ</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="font-semibold">
                    <td className="whitespace-nowrap" style={{ padding: "0 2mm" }}>{invoice.meterNumber || "—"}</td>
                    <td className="whitespace-nowrap" style={{ padding: "0 2mm" }}>{invoice.meterPrevReading || "—"}</td>
                    <td className="whitespace-nowrap" style={{ padding: "0 2mm" }}>{invoice.meterCurrReading || "—"}</td>
                    <td className="whitespace-nowrap" style={{ padding: "0 2mm" }}>{invoice.isEstimatedVolume ? "DA" : ""}</td>
                  </tr>
                </tbody>
              </table>
            ),
          )}

          {field(
            "companyInfoText",
            { gridColumn: 3, gridRow: 2, marginTop: "3mm", alignSelf: "start" },
            ({ textStyle }) => (
              <div className="text-center" style={{ color: COLOR_TEXT, fontSize: "4mm", lineHeight: 1.15, ...textStyle }}>
                <p>{company.apaCanalAddress}</p>
                <p>{company.apaCanalEmail}</p>
                <p className="font-semibold">{company.apaCanalCompanyLine}</p>
                <p>{company.apaCanalCodFiscal}</p>
              </div>
            ),
          )}
        </div>

        {/* ── Rând 4: rest coloană principală | Anunț + contacte, grupate împreună ── */}
        <div className="flex flex-col" style={{ gridColumn: 1, gridRow: 4, marginTop: "3mm", gap: "2.5mm" }}>
          {invoice.billingPeriodLabel &&
            field("billingPeriodText", {}, ({ textStyle }) => (
              <p className="font-semibold" style={{ fontSize: "3mm", ...textStyle }}>Perioada de calcul: {invoice.billingPeriodLabel!.toUpperCase()}</p>
            ))}

          {/* Servicii */}
          {field("servicesTable", {}, ({ textStyle }) => (
            <table style={{ fontSize: "2.9mm", width: "100%", ...textStyle }}>
              <thead>
                <tr className="text-left" style={{ borderBottom: `1px solid ${COLOR_BOX_BLUE}`, color: COLOR_BORDER }}>
                  <th className="whitespace-nowrap font-medium" style={{ padding: "0.6mm 0" }}>Denumirea serviciului</th>
                  <th className="whitespace-nowrap text-right font-medium" style={{ padding: "0.6mm 0 0.6mm 14mm" }}>Volumul,m3</th>
                  <th className="whitespace-nowrap text-right font-medium" style={{ padding: "0.6mm 0 0.6mm 14mm" }}>Tariful lei/m3</th>
                  <th className="whitespace-nowrap text-right font-medium" style={{ padding: "0.6mm 0 0.6mm 14mm" }}>Suma calculata</th>
                </tr>
              </thead>
              <tbody>
                {/* TOATE liniile care se potrivesc, nu doar prima — unele facturi (recalculări/
                    corecții acumulate în aceeași perioadă din exportul 1C) au mai mult de o
                    linie de apă și/sau de canalizare (până la câteva zeci, în cazuri rare).
                    Afișarea doar a primei linii ar ascunde restul sumelor reale facturate. */}
                {[...apaItems, ...canalItems].map((item, i, arr) => (
                  <tr key={item.id} style={i < arr.length - 1 ? { borderBottom: `1px solid ${COLOR_BORDER_LIGHT}` } : undefined}>
                    <td className="whitespace-nowrap" style={{ padding: "0.8mm 0" }}>
                      {isApa(item.description) ? "Serviciul de alimentare cu apa" : "Serviciul de canalizare"}
                    </td>
                    <td className="text-right tabular-nums" style={{ padding: "0.8mm 0" }}>{factorOrDash(item.quantity, item.lineTotal)}</td>
                    <td className="text-right tabular-nums" style={{ padding: "0.8mm 0" }}>{factorOrDash(item.unitPrice, item.lineTotal)}</td>
                    <td className="text-right tabular-nums" style={{ padding: "0.8mm 0" }}>{num2(item.lineTotal)}</td>
                  </tr>
                ))}
                {/* Fără nicio linie de serviciu — indicii contorului nu s-au schimbat față de
                    perioada precedentă (consum 0), deci nu s-a calculat nimic de facturat acum;
                    un tabel complet gol arată ca o eroare de afișare, nu ca "n-ai consumat". */}
                {apaItems.length === 0 && canalItems.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center" style={{ padding: "1.5mm 0", color: COLOR_CHART_TEXT }}>
                      Fără consum înregistrat în această perioadă — nimic de facturat.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ))}

          {/* Recalculări/Penalitate (text) + linie albastră până la casetă + totaluri (casetă, mai în dreapta) */}
          <div className="flex items-start" style={{ fontSize: "2.9mm", marginTop: "3mm" }}>
            <div className="flex flex-1 items-stretch">
              {field(
                "recalculariText",
                { flex: "0 0 auto" },
                ({ overridden, textStyle }) => (
                  <div
                    style={{
                      lineHeight: 1.3,
                      paddingTop: "2mm",
                      paddingBottom: "0.6mm",
                      borderBottom: overridden ? undefined : `2.8px solid ${COLOR_BOX_BLUE}`,
                      height: overridden ? "100%" : undefined,
                      ...textStyle,
                    }}
                  >
                    <p>Recalculări:{invoice.recalculari ? ` ${num2(invoice.recalculari)}` : ""}</p>
                    <p>Penalitate:{invoice.penalitati ? ` ${num2(invoice.penalitati)}` : ""}</p>
                  </div>
                ),
              )}
              {field(
                "totalsConnectorLine",
                { flex: 1, marginRight: "3mm" },
                ({ overridden }) =>
                  overridden ? (
                    <div className="flex h-full w-full items-center">
                      <div style={{ width: "100%", height: "2.8px", background: COLOR_BOX_BLUE }} />
                    </div>
                  ) : (
                    <div style={{ height: "100%", borderBottom: `2.8px solid ${COLOR_BOX_BLUE}` }} />
                  ),
              )}
            </div>
            {field(
              "totalsBox",
              { flexShrink: 0, width: "58mm" },
              ({ textStyle }) => (
                <div style={{ background: COLOR_BOX_BLUE, borderRadius: "3mm", padding: "2mm 3mm", width: "100%", height: "100%", ...textStyle }}>
                  <div className="flex justify-between whitespace-nowrap">
                    <span>Suma calculată</span>
                    <span className="tabular-nums">{num2(sumaCalculata)}</span>
                  </div>
                  <div className="flex justify-between whitespace-nowrap">
                    <span>Datorii(+)/avans(-)</span>
                    <span className="tabular-nums">{num2(invoice.datoriiAvans)}</span>
                  </div>
                  <div className="flex justify-between whitespace-nowrap font-bold" style={{ borderTop: `1px solid ${COLOR_TEXT}`, marginTop: "1mm", paddingTop: "1mm", fontSize: "3.6mm" }}>
                    <span>Suma spre plată :</span>
                    <span className="tabular-nums">{num2(invoice.grandTotal)}</span>
                  </div>
                </div>
              ),
            )}
          </div>

          {/* ATENȚIE — se mulează pe conținut, nu se întinde până jos */}
          {field("atentieBox", {}, ({ overridden, textStyle }) => (
            <div style={{ background: COLOR_BOX_BLUE, borderRadius: "3.5mm", padding: "2.5mm 3.5mm", width: "100%", height: overridden ? "100%" : undefined }}>
              <p className="font-bold" style={{ color: COLOR_RED, fontSize: "4mm", margin: "0 0 1mm" }}>ATENȚIE !</p>
              <p style={{ color: COLOR_TEXT, fontSize: "2.8mm", lineHeight: 1.5, ...textStyle }}>{company.apaCanalAtentieText}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col self-start" style={{ gridColumn: 2, gridRow: 4, marginTop: "3mm", gap: "3mm" }}>
          {field("anuntBox", {}, ({ overridden, textStyle }) => (
            <div className="text-center" style={{ background: COLOR_BOX_BLUE, borderRadius: "7mm", padding: "2.5mm 3.5mm", width: "100%", height: overridden ? "100%" : undefined }}>
              <p className="font-bold" style={{ color: COLOR_RED, fontSize: "4mm", margin: "0 0 1mm" }}>Anunț !</p>
              <p style={{ color: COLOR_TEXT, fontSize: "2.7mm", lineHeight: 1.4, ...textStyle }}>{company.apaCanalAnuntText}</p>
            </div>
          ))}

          {field("contacteBlock", {}, ({ textStyle }) => (
            <div style={{ fontSize: "2.7mm", width: "100%", ...textStyle }}>
              <p className="font-semibold" style={{ marginBottom: "1mm" }}>Contacte: <span className="font-normal text-brand">{company.apaCanalContactName}</span></p>
              <div className="whitespace-pre-line" style={{ lineHeight: 1.8 }}>{company.apaCanalContactsText}</div>
            </div>
          ))}
        </div>

        {(layout?.customImages ?? []).map((img) => (
          <CustomImageField
            key={img.id}
            image={img}
            editable={editable}
            onChange={onCustomImageChange}
            scale={previewScale}
            portalTarget={pageEl}
          />
        ))}

        {editable && showGrid && (
          <>
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                zIndex: 60,
                backgroundImage:
                  "linear-gradient(to right, rgba(0,0,0,0.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.16) 1px, transparent 1px), linear-gradient(to right, rgba(0,0,0,0.07) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.07) 1px, transparent 1px)",
                backgroundSize: "50mm 50mm, 50mm 50mm, 10mm 10mm, 10mm 10mm",
              }}
            />
            <div aria-hidden style={{ position: "absolute", inset: "5mm", pointerEvents: "none", zIndex: 60, border: "1px dashed rgba(229,57,53,0.55)" }} />
          </>
        )}
      </div>
  );

  return (
    <>
      {editable ? (
        pageContent
      ) : (
        // `scaleWrapRef` trebuie să rămână neconstrâns (lățime 100%) — e folosit doar ca să
        // MĂSOARE lățimea disponibilă a părintelui (ResizeObserver). Cutia efectiv randată e
        // `invoice-scale-outer`, dimensionată explicit la mărimea VIZUALĂ (deja scalată) a
        // facturii și centrată cu `margin:auto` — altfel, cu `transform-origin: top left` pe un
        // element încă lat de 297mm în DOM, factura scalată apărea "lipită" în stânga, cu tot
        // spațiul gol rămas mereu în dreapta.
        <div ref={scaleWrapRef} className="invoice-scale-measure">
          <div
            className="invoice-scale-outer"
            style={{ width: `${PAGE_W_MM * MM_TO_PX * autoScale}px`, height: `${PAGE_H_MM * MM_TO_PX * autoScale}px` }}
          >
            <div className="invoice-scale-inner" style={{ "--invoice-scale": autoScale } as React.CSSProperties}>
              {pageContent}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @page { size: A4 landscape; margin: 0; }

        .invoice-page {
          position: relative;
          width: 297mm;
          height: 210mm;
          padding: 5mm 5mm 4mm 5mm;
          box-sizing: border-box;
          background: #ffffff;
          color: ${COLOR_TEXT};
          font-family: Arial, Helvetica, sans-serif;
          display: grid;
          grid-template-columns: 73% 27%;
          grid-template-rows: auto auto auto 1fr;
          column-gap: 5mm;
          overflow: hidden;
        }
        .invoice-page * { box-sizing: border-box; }

        @media screen {
          .invoice-page {
            margin: 0 auto;
            box-shadow: 0 1px 3px rgba(0,0,0,0.15);
          }
        }

        .invoice-scale-measure {
          width: 100%;
        }
        .invoice-scale-outer {
          margin: 0 auto;
          overflow: hidden;
        }
        .invoice-scale-inner {
          width: 297mm;
          transform: scale(var(--invoice-scale, 1));
          transform-origin: top left;
        }
        /* !important câștigă peste transform-ul inline la tipărire/PDF (Playwright emulează
           print media by default) — factura se tipărește mereu la mărime reală, indiferent
           de scala calculată pentru ecran. */
        @media print {
          .invoice-scale-outer { width: auto !important; height: auto !important; margin: 0 !important; }
          .invoice-scale-inner { transform: none !important; }
        }

        @media print {
          html, body { margin: 0; padding: 0; background: white; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .invoice-page { box-shadow: none; }
          .no-print { display: none !important; }
        }

        /* Editor: fiecare element poziționabil (react-rnd) folosește CSS transform, care îi
           creează propriul context de stivuire — fără asta, elementele randate mai târziu în
           JSX acoperă mereu (vizual și la click) elementele randate mai devreme care se
           suprapun, blocând mânerele de redimensionare ale acestora din urmă. La hover, elementul
           de sub cursor trece în față, ca să fie mereu prindabil/redimensionabil. */
        .invoice-page .react-draggable:hover {
          z-index: 50;
        }
      `}</style>
    </>
  );
}
