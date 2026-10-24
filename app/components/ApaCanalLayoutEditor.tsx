"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Company } from "@/lib/queries/company";
import {
  ALL_ELEMENT_KEYS,
  APA_CANAL_DEFAULT_FONT_MM,
  APA_CANAL_ELEMENT_LABELS,
  APA_CANAL_LAYOUT_DEFAULTS,
  APA_CANAL_LINE_KEYS,
  APA_CANAL_TEXT_KEYS,
  APA_CANAL_VARIABLES,
  FONT_MAX_MM,
  FONT_MIN_MM,
  MAX_CUSTOM_IMAGES,
  MM_TO_PX,
  PAGE_H_MM,
  PAGE_W_MM,
  clampBox,
  completeApaCanalLayout,
  minSizeMm,
  round1,
  round2,
  sanitizeApaCanalLayout,
  type ApaCanalCustomImage,
  type ApaCanalElementKey,
  type ApaCanalElementOverride,
  type ApaCanalLayout,
  type BoxMm,
} from "@/lib/apa-canal-layout";
import type { LayoutState } from "@/app/actions/company";
import ApaCanalInvoicePublic, { buildApaCanalVars, type ApaCanalInvoiceData } from "./ApaCanalInvoicePublic";
import { useToast } from "./toast";
import { useT } from "@/lib/i18n/context";

// ── Date de test (fixe, ca randarea de pe server și din browser să fie identică) ───────────────────

const MONTHS = ["2", "3", "4", "5", "6", "7"];
const BASE_SAMPLE: ApaCanalInvoiceData = {
  number: "INV-2026-0000",
  issueDate: new Date("2026-07-31T12:00:00Z"),
  dueDate: new Date("2026-08-30T12:00:00Z"),
  currency: "MDL",
  contPersonal: "900616",
  sectorNr: "5sp",
  consumAddress: "or.Cahul, STROESCU, 31",
  consumerName: "ANTONIU GHEORGHE TEODOR",
  meterNumber: "294170",
  meterPrevReading: "00647",
  meterCurrReading: "00660",
  isEstimatedVolume: false,
  billingPeriodLabel: "IULIE 2026",
  recalculari: 0,
  penalitati: 0,
  datoriiAvans: -190,
  subtotal: 483.6,
  grandTotal: 293.6,
  monthlyConsumption: MONTHS.map((label, i) => ({ label, value: [27, 32, 0, 13, 5, 13][i] })),
  client: { name: "Gheorghe" },
  items: [
    { id: "sample-apa", description: "Serviciul de alimentare cu apa", quantity: 13, unitPrice: 23.45, lineTotal: 304.85 },
    { id: "sample-canal", description: "Serviciul de canalizare", quantity: 13, unitPrice: 13.75, lineTotal: 178.75 },
  ],
};

const SAMPLES: Record<string, { label: string; data: ApaCanalInvoiceData }> = {
  standard: { label: "Standard (2 servicii)", data: BASE_SAMPLE },
  many: {
    label: "Multe linii (6 servicii)",
    data: {
      ...BASE_SAMPLE,
      subtotal: 1450.8,
      grandTotal: 1260.8,
      items: [1, 2, 3].flatMap((n) => [
        { id: `a${n}`, description: "Serviciul de alimentare cu apa", quantity: 13, unitPrice: 23.45, lineTotal: 304.85 },
        { id: `c${n}`, description: "Serviciul de canalizare", quantity: 13, unitPrice: 13.75, lineTotal: 178.75 },
      ]),
    },
  },
  long: {
    label: "Nume și adresă foarte lungi",
    data: {
      ...BASE_SAMPLE,
      consumerName: "SOCIETATEA COMERCIALĂ „AGRO-PRODUCT-EXPORT” CU RĂSPUNDERE LIMITATĂ",
      consumAddress: "r-n.Cahul, s.Roșu, str. Mihai Eminescu, nr. 124, bl. 3, ap. 57",
      sectorNr: "Agenti economici 1",
    },
  },
  zero: {
    label: "Fără consum (nimic de facturat)",
    data: { ...BASE_SAMPLE, items: [], subtotal: 0, grandTotal: 0, datoriiAvans: 0, monthlyConsumption: MONTHS.map((label) => ({ label, value: 0 })) },
  },
};

// ── Istoric (anulare / refacere) ───────────────────────────────────────────────────────────────────

type HState = { layout: ApaCanalLayout; past: ApaCanalLayout[]; future: ApaCanalLayout[]; tag: string; at: number };
type HAction =
  | { type: "edit"; fn: (l: ApaCanalLayout) => ApaCanalLayout; tag: string; at: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "replace"; layout: ApaCanalLayout };

function reducer(s: HState, a: HAction): HState {
  switch (a.type) {
    case "edit": {
      const next = a.fn(s.layout);
      if (Object.is(next, s.layout)) return s;
      // Modificările succesive ale aceluiași câmp (tastare cifră cu cifră) se strâng într-un singur pas de anulare.
      const merge = a.tag !== "" && a.tag === s.tag && a.at - s.at < 900;
      return { layout: next, past: merge ? s.past : [...s.past, s.layout].slice(-100), future: [], tag: a.tag, at: a.at };
    }
    case "undo": {
      if (!s.past.length) return s;
      return { layout: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.layout, ...s.future], tag: "", at: 0 };
    }
    case "redo": {
      if (!s.future.length) return s;
      return { layout: s.future[0], past: [...s.past, s.layout], future: s.future.slice(1), tag: "", at: 0 };
    }
    case "replace":
      return { ...s, layout: a.layout, tag: "", at: 0 };
  }
}

// ── Măsurare: unde pune factura REALĂ fiecare element (fără șablon) ───────────────────────────────

type Flow = Partial<Record<ApaCanalElementKey, BoxMm>>;

function measureFlow(root: HTMLElement): Flow {
  const page = root.querySelector<HTMLElement>(".invoice-page");
  if (!page) return {};
  const pr = page.getBoundingClientRect();
  if (pr.width === 0) return {};
  const k = pr.width / (PAGE_W_MM * MM_TO_PX); // ≈1; corectează o eventuală scalare reziduală
  const mm = (px: number) => round2(px / k / MM_TO_PX);
  const out: Flow = {};
  page.querySelectorAll<HTMLElement>("[data-el]").forEach((el) => {
    const key = el.dataset.el as ApaCanalElementKey;
    if (!ALL_ELEMENT_KEYS.includes(key)) return;
    const r = el.getBoundingClientRect();
    let x = r.left - pr.left;
    let y = r.top - pr.top;
    let w = r.width;
    let h = r.height;
    if (key === "titleLine") {
      // Linia vizibilă e copilul (1.1mm); zona de prindere (3mm) se centrează pe ea.
      const c = el.firstElementChild?.getBoundingClientRect();
      if (c) {
        x = c.left - pr.left;
        w = c.width;
        y = c.top - pr.top + c.height / 2 - 1.5 * MM_TO_PX * k;
        h = 3 * MM_TO_PX * k;
      }
    } else if (key === "totalsConnectorLine") {
      // Linia e borduri de jos (2.8px) a elementului: centrul ei e la 1.4px de marginea de jos.
      y = r.bottom - pr.top - 1.4 * k - 1.5 * MM_TO_PX * k;
      h = 3 * MM_TO_PX * k;
    }
    // Fără logo încărcat (sau încă neîncărcat) înălțimea e 0: pornim de la un pătrat rezonabil, ca elementul să rămână prindabil.
    if (key === "logo" && h < 5 * MM_TO_PX * k) h = Math.min(w, 40 * MM_TO_PX * k);
    out[key] = clampBox({ xMm: mm(x), yMm: mm(y), widthMm: mm(w), heightMm: mm(h) }, minSizeMm(key));
  });
  // În factura reală linia albastră începe sub textul „Recalculări”: o lungim la stânga până la el, ca linia să fie continuă.
  const rec = out.recalculariText;
  const con = out.totalsConnectorLine;
  if (rec && con && rec.xMm < con.xMm) {
    out.totalsConnectorLine = clampBox({ ...con, xMm: rec.xMm, widthMm: con.widthMm + (con.xMm - rec.xMm) }, minSizeMm("totalsConnectorLine"));
  }
  return out;
}

/** Șablon salvat incomplet (nu toate elementele au poziție + mărime) = salvat cu o versiune veche a editorului. */
function isLegacy(l: ApaCanalLayout): boolean {
  const hasAny = ALL_ELEMENT_KEYS.some((k) => l[k] !== undefined);
  return hasAny && ALL_ELEMENT_KEYS.some((k) => l[k]?.xMm === undefined || l[k]?.widthMm === undefined);
}

const sameFlow = (a: Flow | null, b: Flow) => !!a && JSON.stringify(a) === JSON.stringify(b);

// ── Șabloane de text cu variabile (punct de plecare pentru „Text personalizat”) ───────────────────

const TEXT_TEMPLATES: Partial<Record<ApaCanalElementKey, string>> = {
  title: "Factura pentru serviciul de alimentare cu apă și de canalizare",
  datesBlock: "Data emiterii: {emitere}\nData limită de achitare: {scadenta}",
  contPersonalBlock: "Cont personal: {cont}\nAdresa locului de consum:\n{adresa}\n{consumator}",
  companyInfoText: "{firmaAdresa}\n{firmaEmail}\n{firma}\n{firmaCodFiscal}",
  meterTable: "Contor: {contor}\nIndici: {indPrec} → {indAct}",
  billingPeriodText: "Perioada de calcul: {perioada}",
  servicesTable: "Apă: {apaVolum} m³ × {apaTarif} = {apaSuma}\nCanalizare: {canalVolum} m³ × {canalTarif} = {canalSuma}",
  recalculariText: "Recalculări: {recalculari}\nPenalitate: {penalitati}",
  totalsBox: "Suma calculată: {suma}\nDatorii(+)/avans(-): {datorii}\nSuma spre plată: {total}",
  atentieBox: "ATENȚIE !\n{atentie}",
  anuntBox: "Anunț !\n{anunt}",
  contacteBlock: "Contacte: {contactNume}\n{contacte}",
};

// ── Câmp numeric: se poate tasta liber (și șterge), valoarea se limitează la părăsirea câmpului ───

const fmtNum = (n: number) => String(round2(n));

function NumField({
  value,
  onCommit,
  className,
  title,
  placeholder,
}: {
  value: number | undefined;
  onCommit: (n: number | undefined) => void;
  className?: string;
  title?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [focus, setFocus] = useState(false);
  return (
    <input
      type="text"
      inputMode="decimal"
      title={title}
      placeholder={placeholder}
      className={className}
      value={focus ? text : value === undefined ? "" : fmtNum(value)}
      onFocus={(e) => {
        setText(value === undefined ? "" : fmtNum(value));
        setFocus(true);
        e.currentTarget.select();
      }}
      onChange={(e) => {
        setText(e.target.value);
        const raw = e.target.value.trim().replace(",", ".");
        if (raw === "") return onCommit(undefined);
        const n = Number(raw);
        if (Number.isFinite(n)) onCommit(n);
      }}
      onBlur={() => setFocus(false)}
    />
  );
}

const inputCls = "h-9 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-sm outline-none focus:border-brand";
const cellCls = "h-7 w-full min-w-0 rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-1 text-center text-[11px] tabular-nums outline-none focus:border-brand";
const labelCls = "mb-1 block text-xs font-semibold text-ink-soft";
const btnCls = "tap h-9 cursor-pointer rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium hover:bg-[var(--color-surface-2)] disabled:cursor-default disabled:opacity-40";
const miniBtn = "tap grid h-8 min-w-8 cursor-pointer place-items-center rounded-lg border border-[var(--color-line)] px-1.5 text-sm hover:bg-[var(--color-surface-2)]";

const isTextKey = (k: ApaCanalElementKey) => APA_CANAL_TEXT_KEYS.includes(k);
const clampFont = (n: number) => Math.min(FONT_MAX_MM, Math.max(FONT_MIN_MM, round1(n)));

export default function ApaCanalLayoutEditor({
  company,
  onSave,
  sampleToken,
  host,
}: {
  company: Company;
  onSave: (layout: ApaCanalLayout) => Promise<LayoutState>;
  /** Token public al unei facturi Apă-Canal reale din această bază de date (pentru verificarea șablonului salvat). */
  sampleToken?: string | null;
  /** Site-ul pe care se salvează (fiecare site are propria bază de date și propriul șablon). */
  host?: string;
}) {
  const tr = useT();
  const toast = useToast();
  const router = useRouter();
  const initial = useMemo(() => sanitizeApaCanalLayout(company.apaCanalLayout), [company.apaCanalLayout]);
  const [state, dispatch] = useReducer(reducer, { layout: initial, past: [], future: [], tag: "", at: 0 });
  const layout = state.layout;
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(initial));
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [selected, setSelected] = useState<ApaCanalElementKey>("logo");
  const [pending, startTransition] = useTransition();
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [snap, setSnap] = useState(0);
  const [grid, setGrid] = useState(true);
  const [sampleKey, setSampleKey] = useState("standard");
  const [showReal, setShowReal] = useState(false);
  const [flowMeasured, setFlow] = useState<Flow | null>(null);
  const sample = SAMPLES[sampleKey]?.data ?? BASE_SAMPLE;

  // Șablon salvat cu o versiune veche (doar câteva elemente au poziție): elementele neatinse rămân la pozițiile din cod,
  // exact cum le arată factura publică. După „Pornește de la factura standard” sau după salvare, pozițiile vin din factura reală măsurată.
  const [legacyMode, setLegacyMode] = useState(() => isLegacy(initial));
  const flow = legacyMode ? null : flowMeasured;

  const dirty = useMemo(() => JSON.stringify(layout) !== savedJson, [layout, savedJson]);

  // ── Măsurarea facturii reale (instanță ascunsă, fără șablon, la mărime reală) ──
  const measureRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = measureRef.current;
    if (!root) return;
    let raf = 0;
    const run = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const m = measureFlow(root);
        if (Object.keys(m).length >= 10) setFlow((prev) => (sameFlow(prev, m) ? prev : m));
      });
    };
    run();
    const t = window.setTimeout(run, 600);
    const ro = new ResizeObserver(run);
    root.querySelectorAll("[data-el]").forEach((n) => ro.observe(n));
    const imgs = Array.from(root.querySelectorAll("img"));
    imgs.forEach((i) => i.addEventListener("load", run));
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
      ro.disconnect();
      imgs.forEach((i) => i.removeEventListener("load", run));
    };
  }, [company]);

  const boxOf = useCallback(
    (l: ApaCanalLayout, key: ApaCanalElementKey): BoxMm => {
      const base = flow?.[key] ?? APA_CANAL_LAYOUT_DEFAULTS[key];
      const o = l[key];
      return { xMm: o?.xMm ?? base.xMm, yMm: o?.yMm ?? base.yMm, widthMm: o?.widthMm ?? base.widthMm, heightMm: o?.heightMm ?? base.heightMm };
    },
    [flow],
  );

  // ── Scală: „Potrivit” = încape în lățime; sau procent din mărimea reală ──
  const previewRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState<number | null>(null);
  const PAGE_W_PX = PAGE_W_MM * MM_TO_PX;
  const PAGE_H_PX = PAGE_H_MM * MM_TO_PX;
  useLayoutEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const update = () => {
      const availW = el.clientWidth - 32; // p-4 = 16px pe fiecare parte
      setFitScale(Math.max(0.2, Math.min(1, Math.round((availW / PAGE_W_PX) * 100) / 100)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [PAGE_W_PX]);
  const scale = zoom === "fit" ? fitScale : zoom;

  // ── Editări ──
  const edit = useCallback((fn: (l: ApaCanalLayout) => ApaCanalLayout, tag = "") => dispatch({ type: "edit", fn, tag, at: Date.now() }), []);

  const setBox = useCallback(
    (key: ApaCanalElementKey, patch: Partial<BoxMm>, tag: string) =>
      edit((l) => {
        const b = clampBox({ ...boxOf(l, key), ...patch }, minSizeMm(key));
        return { ...l, [key]: { ...l[key], ...b } };
      }, `${tag}-${key}`),
    [edit, boxOf],
  );

  const setField = useCallback(
    (key: ApaCanalElementKey, patch: Partial<ApaCanalElementOverride>, tag: string) =>
      edit((l) => ({ ...l, [key]: { ...boxOf(l, key), ...l[key], ...patch } }), `${tag}-${key}`),
    [edit, boxOf],
  );

  // Tastatură: săgeți = deplasează elementul ales (Shift = 5mm, Alt = 0.1mm), Ctrl+Z / Ctrl+Y = anulare / refacere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        dispatch({ type: "redo" });
        return;
      }
      const step = e.shiftKey ? 5 : e.altKey ? 0.1 : 0.5;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!d) return;
      e.preventDefault();
      edit(
        (l) => {
          const b = boxOf(l, selected);
          const nb = clampBox({ ...b, xMm: b.xMm + d[0], yMm: b.yMm + d[1] }, minSizeMm(selected));
          return { ...l, [selected]: { ...l[selected], ...nb } };
        },
        `nudge-${selected}`,
      );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [edit, boxOf, selected]);

  // Avertizare la închiderea paginii cu modificări nesalvate.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // ── Salvare ──
  function persist(next: ApaCanalLayout, okMsg: string) {
    startTransition(async () => {
      try {
        const res = await onSave(next);
        if (res?.ok) {
          const stored = res.layout ?? next;
          dispatch({ type: "replace", layout: stored });
          setLegacyMode(false);
          setSavedJson(JSON.stringify(stored));
          setSavedAt(res.savedAt ?? new Date().toISOString());
          toast.success(okMsg);
          router.refresh();
        } else {
          toast.error(res?.error ?? "Eroare la salvare");
        }
      } catch (e) {
        // Eroare aruncată de server sau de rețea (altfel nu s-ar vedea nimic): arătăm că salvarea a eșuat.
        console.error("[layout] salvarea a eșuat:", e);
        toast.error(tr("Salvarea nu a reușit (eroare de server sau de rețea). Reîncarcă pagina și încearcă din nou."));
      }
    });
  }

  function save() {
    // Șablon COMPLET: fiecare element cu poziție și mărime explicite — factura nu mai depinde de nimic implicit.
    persist(completeApaCanalLayout(sanitizeApaCanalLayout(layout), flow ?? {}), "Șablon salvat și verificat în baza de date");
  }

  function removeTemplate() {
    if (!confirm(tr("Ștergi șablonul salvat? Facturile revin la aspectul automat (cel standard)."))) return;
    persist({}, "Șablon șters — facturile folosesc aspectul automat");
  }

  function discard() {
    if (dirty && !confirm(tr("Renunți la toate modificările nesalvate?"))) return;
    dispatch({ type: "replace", layout: JSON.parse(savedJson) as ApaCanalLayout });
  }

  function resetAll() {
    if (!confirm(tr("Readuci TOATE elementele la poziția din factura standard? (nu se salvează până nu apeși „Salvează”)"))) return;
    setLegacyMode(false);
    edit((l) => (l.customImages?.length ? { customImages: l.customImages } : {}), "reset-all");
  }

  function resetFonts() {
    edit((l) => {
      const next: ApaCanalLayout = { ...l };
      for (const k of ALL_ELEMENT_KEYS) {
        const o = l[k];
        if (o?.fontSizeMm !== undefined) next[k] = { ...o, fontSizeMm: undefined };
      }
      return next;
    }, "reset-fonts");
  }

  function resetOne(key: ApaCanalElementKey) {
    edit((l) => {
      const next = { ...l };
      delete next[key];
      return next;
    });
  }

  // ── Fotografii ──
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoWarn, setPhotoWarn] = useState("");

  function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if ((layout.customImages?.length ?? 0) >= MAX_CUSTOM_IMAGES) return setPhotoWarn(`Cel mult ${MAX_CUSTOM_IMAGES} fotografii.`);
    if (!f.type.startsWith("image/")) return setPhotoWarn("Alege un fișier imagine.");
    if (f.size > 2_500_000) return setPhotoWarn("Fotografia e prea mare (max ~2,5MB). Micșorează-o înainte.");
    setPhotoWarn("");
    const reader = new FileReader();
    reader.onload = () => {
      const image: ApaCanalCustomImage = {
        id: `img-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
        xMm: 100,
        yMm: 80,
        widthMm: 60,
        heightMm: 60,
        dataUrl: String(reader.result),
      };
      edit((l) => ({ ...l, customImages: [...(l.customImages ?? []), image] }));
    };
    reader.readAsDataURL(f);
  }

  const patchCustomImage = useCallback(
    (id: string, p: Partial<ApaCanalCustomImage>, tag = "") =>
      edit(
        (l) => ({
          ...l,
          customImages: (l.customImages ?? []).map((img) => (img.id === id ? { ...img, ...clampBox({ ...img, ...p }, minSizeMm("image")) } : img)),
        }),
        tag ? `${tag}-${id}` : "",
      ),
    [edit],
  );

  function deleteCustomImage(id: string) {
    edit((l) => ({ ...l, customImages: (l.customImages ?? []).filter((img) => img.id !== id) }));
  }

  // ── Variabile ──
  const vars = useMemo(() => buildApaCanalVars(sample, company), [sample, company]);
  const textRef = useRef<HTMLTextAreaElement>(null);

  function insertVariable(k: string) {
    const token = `{${k}}`;
    if (!isTextKey(selected)) {
      void navigator.clipboard?.writeText(token).catch(() => {});
      toast.success(`Copiat ${token} — lipește-l într-un element cu text`);
      return;
    }
    const cur = layout[selected]?.textOverride ?? "";
    const ta = textRef.current;
    const pos = ta && document.activeElement === ta ? (ta.selectionStart ?? cur.length) : cur.length;
    setField(selected, { textOverride: cur.slice(0, pos) + token + cur.slice(pos) }, "text");
  }

  // ── Verificări ──
  const boxes = useMemo(() => ALL_ELEMENT_KEYS.map((k) => ({ key: k, box: boxOf(layout, k) })), [layout, boxOf]);
  const overlaps = useMemo(() => {
    const solid = boxes.filter((b) => !APA_CANAL_LINE_KEYS.includes(b.key));
    const out: string[] = [];
    for (let i = 0; i < solid.length; i++) {
      for (let j = i + 1; j < solid.length; j++) {
        const a = solid[i].box;
        const b = solid[j].box;
        const ox = Math.min(a.xMm + a.widthMm, b.xMm + b.widthMm) - Math.max(a.xMm, b.xMm);
        const oy = Math.min(a.yMm + a.heightMm, b.yMm + b.heightMm) - Math.max(a.yMm, b.yMm);
        if (ox > 1.5 && oy > 1.5) out.push(`${tr(APA_CANAL_ELEMENT_LABELS[solid[i].key])} ↔ ${tr(APA_CANAL_ELEMENT_LABELS[solid[j].key])}`);
      }
    }
    return out;
  }, [boxes]);

  // Fonturi care se abat mult de cel standard (de obicei din redimensionări repetate care au scalat textul).
  const oddFonts = useMemo(
    () =>
      APA_CANAL_TEXT_KEYS.filter((k) => {
        const fs = layout[k]?.fontSizeMm;
        const def = APA_CANAL_DEFAULT_FONT_MM[k];
        return fs !== undefined && def !== undefined && (fs > def * 1.5 || fs < def * 0.6);
      }),
    [layout],
  );
  // Șablon salvat înainte de această versiune: nu are toate elementele (restul ar porni din poziții diferite de cele de pe factură).
  const legacy = legacyMode;
  const [legacyDismissed, setLegacyDismissed] = useState(false);

  const sel = boxOf(layout, selected);
  const selOv = layout[selected];
  const textKey = isTextKey(selected);
  const defaultFont = APA_CANAL_DEFAULT_FONT_MM[selected];
  const photos = layout.customImages ?? [];
  const groups = useMemo(() => {
    const g = new Map<string, typeof APA_CANAL_VARIABLES>();
    for (const v of APA_CANAL_VARIABLES) g.set(v.group, [...(g.get(v.group) ?? []), v]);
    return [...g];
  }, []);

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {legacy && !legacyDismissed && (
          <div className="card flex flex-wrap items-center gap-3 border-st-progress/40 bg-st-progress/10 p-3 text-xs text-st-progress">
            <p className="min-w-0 flex-1">
              <b>{tr("Șablonul salvat e vechi")}</b> {tr("(nu are toate elementele sau are poziții/fonturi modificate din versiuni anterioare), de aceea unele elemente par nepotrivite. Pornește de la factura standard, apoi ajustează ce vrei.")}
            </p>
            <button type="button" className={btnCls} onClick={() => { setLegacyMode(false); edit((l) => (l.customImages?.length ? { customImages: l.customImages } : {}), "reset-all"); setLegacyDismissed(true); }}>{tr("Pornește de la factura standard")}</button>
            <button type="button" className={btnCls} onClick={() => setLegacyDismissed(true)}>{tr("Păstrează șablonul")}</button>
          </div>
        )}
        {/* Bara de unelte */}
        <div className="card flex flex-wrap items-center gap-2 p-3 text-xs">
          <button type="button" className={btnCls} disabled={!state.past.length} onClick={() => dispatch({ type: "undo" })} title={tr("Anulează (Ctrl+Z)")}>{tr("↶ Anulează")}</button>
          <button type="button" className={btnCls} disabled={!state.future.length} onClick={() => dispatch({ type: "redo" })} title={tr("Refă (Ctrl+Y)")}>{tr("↷ Refă")}</button>
          <label className="flex items-center gap-1 font-medium">
            {tr("Zoom")}
            <select className="h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-1.5" value={zoom === "fit" ? "fit" : String(zoom)} onChange={(e) => setZoom(e.target.value === "fit" ? "fit" : Number(e.target.value))}>
              <option value="fit">{tr("Potrivit ecranului")}</option>
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((z) => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1 font-medium">
            {tr("Lipire la grilă")}
            <select className="h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-1.5" value={snap} onChange={(e) => setSnap(Number(e.target.value))}>
              <option value={0}>{tr("Liber")}</option>
              <option value={0.5}>{tr("0,5 mm")}</option>
              <option value={1}>{tr("1 mm")}</option>
              <option value={5}>{tr("5 mm")}</option>
            </select>
          </label>
          <label className="flex h-9 items-center gap-1.5 font-medium">
            <input type="checkbox" className="size-4 accent-[var(--color-brand)]" checked={grid} onChange={(e) => setGrid(e.target.checked)} />
            {tr("Grilă 10 mm + margini")}
          </label>
          <label className="flex items-center gap-1 font-medium">
            {tr("Date de test")}
            <select className="h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-1.5" value={sampleKey} onChange={(e) => setSampleKey(e.target.value)}>
              {Object.entries(SAMPLES).map(([k, s]) => <option key={k} value={k}>{tr(s.label)}</option>)}
            </select>
          </label>
          <span className="ml-auto text-ink-soft">
            {tr("A4 landscape · {PAGE_W_MM}×{PAGE_H_MM} mm{v1}", { PAGE_W_MM, PAGE_H_MM, v1: scale ? ` · ${Math.round(scale * 100)}%` : "" })}
          </span>
        </div>

        {/* Pânza: exact pagina din PDF */}
        <div ref={previewRef} className="min-w-0 overflow-auto rounded-2xl border border-[var(--color-line)] bg-zinc-200 p-4">
          {scale !== null && (
            <div key={scale} style={{ width: PAGE_W_PX * scale, height: PAGE_H_PX * scale }}>
              <div style={{ width: PAGE_W_PX, height: PAGE_H_PX, transform: `scale(${scale})`, transformOrigin: "top left" }}>
                <ApaCanalInvoicePublic
                  invoice={sample}
                  company={company}
                  layout={layout}
                  editable
                  previewScale={scale}
                  defaults={flow ?? undefined}
                  selectedKey={selected}
                  onSelect={setSelected}
                  snapMm={snap}
                  showGrid={grid}
                  onLayoutChange={(key, override) => edit((l) => ({ ...l, [key]: override }), "")}
                  onCustomImageChange={(id, p) => patchCustomImage(id, p)}
                />
              </div>
            </div>
          )}
        </div>

        {/* Factura reală, așa cum o vede clientul / PDF-ul, cu șablonul SALVAT */}
        <div className="card flex flex-col gap-2 p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-sm">{tr("Verifică pe o factură reală")}</b>
            <span className="text-ink-soft">{tr("arată șablonul salvat în baza de date a acestui site — la fel ca portalul, linkul public și PDF-ul.")}</span>
            {sampleToken ? (
              <button type="button" className={`${btnCls} ml-auto`} onClick={() => setShowReal((v) => !v)}>{showReal ? "Ascunde" : tr("Arată factura reală")}</button>
            ) : (
              <span className="ml-auto text-ink-soft">{tr("Nu există încă nicio factură Apă-Canal.")}</span>
            )}
          </div>
          {sampleToken && showReal && scale !== null && (
            <div className="overflow-auto rounded-xl border border-[var(--color-line)] bg-zinc-200 p-2">
              <div style={{ width: PAGE_W_PX * (fitScale ?? 1), height: PAGE_H_PX * (fitScale ?? 1) }}>
                <iframe
                  key={savedAt ?? "initial"}
                  title={tr("Factură reală")}
                  src={`/invoice/public/${sampleToken}?v=${encodeURIComponent(savedAt ?? "0")}`}
                  style={{ width: PAGE_W_PX + 40, height: PAGE_H_PX + 120, border: 0, background: "white", transform: `scale(${fitScale ?? 1})`, transformOrigin: "top left" }}
                />
              </div>
            </div>
          )}
          {sampleToken && (
            <div className="flex flex-wrap gap-2">
              <a className={`${btnCls} inline-flex items-center`} href={`/invoice/public/${sampleToken}`} target="_blank" rel="noreferrer">{tr("Deschide factura în filă nouă ↗")}</a>
              <a className={`${btnCls} inline-flex items-center`} href={`/api/invoice/public/${sampleToken}/pdf`} target="_blank" rel="noreferrer">{tr("Descarcă PDF-ul ↗")}</a>
            </div>
          )}
        </div>
      </div>

      <div className="flex w-full flex-col gap-4 lg:w-96 lg:shrink-0">
        {/* Salvare */}
        <div className="card flex flex-col gap-2 p-4">
          <div className="flex gap-2">
            <button onClick={save} disabled={pending} className="tap h-11 flex-1 cursor-pointer rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
              {pending ? tr("Se salvează…") : dirty ? tr("Salvează șablonul •") : tr("Salvează șablonul")}
            </button>
            <button onClick={discard} disabled={pending || !dirty} className={`${btnCls} h-11`} title={tr("Revino la ultima versiune salvată")}>{tr("Renunță")}</button>
          </div>
          <p className={`text-[11px] ${dirty ? "font-semibold text-st-progress" : "text-ink-soft"}`}>
            {dirty ? tr("Ai modificări nesalvate.") : savedAt ? tr("Salvat și verificat la {time}.", { time: new Date(savedAt).toLocaleTimeString("ro-RO") }) : tr("Nicio modificare nesalvată.")}
          </p>
          <p className="text-[11px] text-ink-soft">
            {tr("Șablonul se salvează în baza de date a site-ului")} <b>{host ?? "curent"}</b> {tr("și se aplică pe facturile acestui site (portal, link public, PDF). Alt site (ex. Vercel față de serverul propriu) are propria bază de date și propriul șablon.")}
          </p>
          <div className="flex flex-wrap gap-2">
            <button onClick={resetAll} disabled={pending} className={btnCls}>{tr("Resetează tot la standard")}</button>
            <button onClick={resetFonts} disabled={pending} className={btnCls} title={tr("Elimină mărimile de font modificate; textul revine la mărimea standard")}>{tr("Resetează fonturile")}</button>
            <button onClick={removeTemplate} disabled={pending} className={`${btnCls} text-st-cancelled`}>{tr("Șterge șablonul salvat")}</button>
          </div>
        </div>

        {/* Element ales */}
        <div className="card flex flex-col gap-3 p-4">
          <h3 className="text-sm font-bold">{tr("Element ales")}</h3>
          <p className="-mt-2 text-xs text-ink-soft">
            {tr("Apasă pe un element din pânză sau alege-l aici. Săgeți = 0,5 mm (Shift 5 mm, Alt 0,1 mm).")}
          </p>
          <select className={inputCls} value={selected} onChange={(e) => setSelected(e.target.value as ApaCanalElementKey)}>
            {ALL_ELEMENT_KEYS.map((key) => <option key={key} value={key}>{tr(APA_CANAL_ELEMENT_LABELS[key])}</option>)}
          </select>

          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["X (mm)", "xMm"],
                ["Y (mm)", "yMm"],
                ["Lățime (mm)", "widthMm"],
                ["Înălțime (mm)", "heightMm"],
              ] as const
            ).map(([label, field]) => (
              <div key={field}>
                <label className={labelCls}>{tr(label)}</label>
                <NumField className={inputCls} value={sel[field]} onCommit={(n) => n !== undefined && setBox(selected, { [field]: n }, field)} />
              </div>
            ))}
          </div>
          <p className="-mt-1 text-[11px] text-ink-soft">
            {tr("Limite: pagina {PAGE_W_MM}×{PAGE_H_MM} mm · minim {w}×{h} mm. Valorile se corectează automat.", { PAGE_W_MM, PAGE_H_MM, w: minSizeMm(selected).w, h: minSizeMm(selected).h })}</p>

          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" className={miniBtn} title={tr("Stânga")} onClick={() => setBox(selected, { xMm: sel.xMm - 0.5 }, "nx")}>◀</button>
            <button type="button" className={miniBtn} title={tr("Sus")} onClick={() => setBox(selected, { yMm: sel.yMm - 0.5 }, "ny")}>▲</button>
            <button type="button" className={miniBtn} title={tr("Jos")} onClick={() => setBox(selected, { yMm: sel.yMm + 0.5 }, "ny")}>▼</button>
            <button type="button" className={miniBtn} title={tr("Dreapta")} onClick={() => setBox(selected, { xMm: sel.xMm + 0.5 }, "nx")}>▶</button>
            <span className="mx-1 h-6 w-px bg-[var(--color-line)]" />
            <button type="button" className={`${miniBtn} text-[11px]`} title={tr("Centrat pe lățimea paginii")} onClick={() => setBox(selected, { xMm: (PAGE_W_MM - sel.widthMm) / 2 }, "al")}>{tr("↔ centru")}</button>
            <button type="button" className={`${miniBtn} text-[11px]`} title={tr("La marginea din stânga (5 mm)")} onClick={() => setBox(selected, { xMm: 5 }, "al")}>{tr("⇤ 5mm")}</button>
            <button type="button" className={`${miniBtn} text-[11px]`} title={tr("La marginea de sus (5 mm)")} onClick={() => setBox(selected, { yMm: 5 }, "al")}>{tr("⇥ sus")}</button>
          </div>

          {textKey && (
            <>
              <div className="flex items-end gap-3 border-t border-[var(--color-line)] pt-3">
                <div className="flex-1">
                  <label className={labelCls}>{tr("Mărime font (mm){v1}", { v1: defaultFont ? ` — implicit ${defaultFont}` : "" })}</label>
                  <NumField
                    className={inputCls}
                    value={selOv?.fontSizeMm}
                    placeholder="implicit"
                    onCommit={(n) => setField(selected, { fontSizeMm: n === undefined ? undefined : clampFont(n) }, "font")}
                  />
                </div>
                <label className="flex h-9 items-center gap-1.5 text-xs font-medium">
                  <input type="checkbox" className="size-4 accent-[var(--color-brand)]" checked={!!selOv?.bold} onChange={(e) => setField(selected, { bold: e.target.checked || undefined }, "bold")} />
                  {tr("Bold")}
                </label>
              </div>

              <div>
                <label className={labelCls}>{tr("Text personalizat (înlocuiește conținutul)")}</label>
                <textarea
                  ref={textRef}
                  className={`${inputCls} h-28 py-2 font-mono text-xs`}
                  value={selOv?.textOverride ?? ""}
                  maxLength={3000}
                  placeholder={tr("Lasă gol pentru conținutul normal al facturii")}
                  onChange={(e) => setField(selected, { textOverride: e.target.value === "" ? undefined : e.target.value }, "text")}
                />
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {TEXT_TEMPLATES[selected] && (
                    <button type="button" className={`${btnCls} h-7 px-2 text-[11px]`} onClick={() => setField(selected, { textOverride: TEXT_TEMPLATES[selected] }, "text")}>
                      {tr("Pornește de la textul standard, cu variabile")}
                    </button>
                  )}
                  {selOv?.textOverride && (
                    <button type="button" className={`${btnCls} h-7 px-2 text-[11px]`} onClick={() => setField(selected, { textOverride: undefined }, "text")}>{tr("Revino la conținutul normal")}</button>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-ink-soft">
                  {tr("Scrie variabile între acolade, ex.")} <code>{tr("{cont}")}</code> {tr("— fiecare factură își pune propriile valori. Lista completă e mai jos.")}
                </p>
              </div>
            </>
          )}

          <button onClick={() => resetOne(selected)} className={btnCls}>{tr("Resetează doar acest element")}</button>
        </div>

        {/* Toate elementele */}
        <div className="card flex flex-col gap-2 p-4">
          <h3 className="text-sm font-bold">{tr("Toate elementele")}</h3>
          <p className="-mt-1 text-xs text-ink-soft">{tr("Valorile în mm: X, Y, lățime, înălțime. Editează direct aici.")}</p>
          <div className="grid grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))] items-center gap-x-1 gap-y-1 text-[10px] font-semibold text-ink-soft">
            <span>{tr("Element")}</span><span className="text-center">X</span><span className="text-center">Y</span><span className="text-center">{tr("Lăț.")}</span><span className="text-center">{tr("Înăl.")}</span>
          </div>
          <div className="flex max-h-96 flex-col gap-1 overflow-y-auto pr-1">
            {boxes.map(({ key, box }) => (
              <div
                key={key}
                onClick={() => setSelected(key)}
                className={`grid cursor-pointer grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))] items-center gap-x-1 rounded-md px-1 py-0.5 ${selected === key ? "bg-brand/10 ring-1 ring-brand" : "hover:bg-[var(--color-surface-2)]"}`}
              >
                <span className="truncate text-[11px] font-medium" title={tr(APA_CANAL_ELEMENT_LABELS[key])}>{tr(APA_CANAL_ELEMENT_LABELS[key])}</span>
                {(["xMm", "yMm", "widthMm", "heightMm"] as const).map((f) => (
                  <NumField key={f} className={cellCls} value={box[f]} onCommit={(n) => n !== undefined && setBox(key, { [f]: n }, f)} />
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Variabile */}
        <details className="card p-4" open>
          <summary className="cursor-pointer text-sm font-bold">{tr("Variabile ({length})", { length: APA_CANAL_VARIABLES.length })}</summary>
          <p className="mt-1 text-xs text-ink-soft">
            {tr("Apasă pe una ca s-o inserezi în „Text personalizat” al elementului ales. Valorile arătate sunt din datele de test alese.")}
          </p>
          <div className="mt-2 flex max-h-[28rem] flex-col gap-3 overflow-y-auto pr-1">
            {groups.map(([group, list]) => (
              <div key={group}>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-soft">{tr(group)}</p>
                <div className="flex flex-col gap-0.5">
                  {list.map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      onClick={() => insertVariable(v.key)}
                      className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-2 rounded-md px-1.5 py-1 text-left hover:bg-brand-soft"
                      title={tr("Inserează {v}", { v: `{${v.key}}` })}
                    >
                      <code className="rounded bg-[var(--color-surface-2)] px-1 text-[11px]">{`{${v.key}}`}</code>
                      <span className="min-w-0 text-[11px]">
                        <span className="text-ink-soft">{tr(v.label)}: </span>
                        <span className="break-words font-medium">{(vars[v.key] ?? "").slice(0, 60) || "—"}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </details>

        {/* Verificări */}
        <div className="card flex flex-col gap-1 p-4 text-xs">
          <h3 className="text-sm font-bold">{tr("Verificări")}</h3>
          {overlaps.length === 0 ? (
            <p className="text-st-done">{tr("✓ Nicio suprapunere între elemente. Toate sunt în pagină.")}</p>
          ) : (
            <>
              <p className="text-st-progress">{tr("⚠ Elemente care se suprapun (verifică dacă e intenționat):")}</p>
              <ul className="list-disc pl-5 text-ink-soft">
                {overlaps.slice(0, 8).map((o) => <li key={o}>{o}</li>)}
                {overlaps.length > 8 && <li>{tr("… și încă {v1}", { v1: overlaps.length - 8 })}</li>}
              </ul>
            </>
          )}
          {oddFonts.length > 0 && (
            <p className="text-st-progress">
              {tr("⚠ Font mult diferit de cel standard:")} {oddFonts.map((k) => tr(APA_CANAL_ELEMENT_LABELS[k])).join(", ")}{tr(". Folosește „Resetează fonturile”.")}
            </p>
          )}
          <p className="mt-1 text-ink-soft">
            {tr("Dacă o factură are mai multe servicii decât cele 2 standard, elementele de sub tabel coboară automat, fără să iasă din pagină.")}
          </p>
        </div>

        {/* Fotografii */}
        <div className="card flex flex-col gap-3 p-4">
          <h3 className="text-sm font-bold">{tr("Fotografii")}</h3>
          <p className="-mt-2 text-xs text-ink-soft">{tr("Adaugă o imagine liberă (max {MAX_CUSTOM_IMAGES}), apoi trage/redimensionează pe pânză sau scrie valorile.", { MAX_CUSTOM_IMAGES })}</p>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onPickPhoto} />
          <button onClick={() => fileInputRef.current?.click()} className={btnCls}>{tr("+ Adaugă fotografie")}</button>
          {photoWarn && <p className="text-xs text-st-cancelled">{photoWarn}</p>}
          {photos.map((img) => (
            <div key={img.id} className="flex flex-col gap-1 border-t border-[var(--color-line)] pt-2">
              <div className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.dataUrl} alt="" className="size-10 shrink-0 rounded-lg border border-[var(--color-line)] object-cover" />
                <div className="grid flex-1 grid-cols-4 gap-1">
                  {(["xMm", "yMm", "widthMm", "heightMm"] as const).map((f) => (
                    <NumField key={f} className={cellCls} title={{ xMm: "X (mm)", yMm: "Y (mm)", widthMm: tr("Lățime (mm)"), heightMm: tr("Înălțime (mm)") }[f]} value={img[f]} onCommit={(n) => n !== undefined && patchCustomImage(img.id, { [f]: n }, f)} />
                  ))}
                </div>
                <button onClick={() => deleteCustomImage(img.id)} className="tap h-8 shrink-0 cursor-pointer rounded-lg border border-[var(--color-line)] px-2 text-xs text-st-cancelled hover:bg-[var(--color-surface-2)]">{tr("Șterge")}</button>
              </div>
              <p className="text-[10px] text-ink-soft">{tr("X · Y · Lățime · Înălțime (mm)")}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Factura reală, fără șablon, la mărime reală — de aici luăm pozițiile de pornire exacte. */}
      <div ref={measureRef} aria-hidden style={{ position: "absolute", top: 0, left: -20000, width: `${PAGE_W_MM}mm`, visibility: "hidden", pointerEvents: "none" }}>
        <ApaCanalInvoicePublic invoice={BASE_SAMPLE} company={company} layout={null} />
      </div>
    </div>
  );
}
