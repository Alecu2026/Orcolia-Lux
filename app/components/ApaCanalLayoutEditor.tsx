"use client";

import { useLayoutEffect, useRef, useState, useTransition } from "react";
import type { Company } from "@/lib/queries/company";
import type { ApaCanalLayout, ApaCanalElementKey } from "@/lib/apa-canal-layout";
import { APA_CANAL_ELEMENT_LABELS, APA_CANAL_TEXT_KEYS, APA_CANAL_LAYOUT_DEFAULTS, MM_TO_PX } from "@/lib/apa-canal-layout";
import type { LayoutState } from "@/app/actions/company";
import ApaCanalInvoicePublic, { type ApaCanalInvoiceData } from "./ApaCanalInvoicePublic";
import { useToast } from "./toast";

const SAMPLE_INVOICE: ApaCanalInvoiceData = {
  number: "INV-2026-0000",
  issueDate: new Date(),
  dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
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
  grandTotal: 293.6,
  monthlyConsumption: ["7", "8", "9", "10", "11", "12", "1", "2", "3", "4", "5", "6"].map((label, i) => ({
    label,
    value: [10, 31, 10, 10, 6, 8, 5, 5, 27, 32, 0, 13][i],
  })),
  client: { name: "Gheorghe" },
  items: [
    { description: "Serviciul de alimentare cu apa", quantity: 13, unitPrice: 23.45, lineTotal: 304.85 },
    { description: "Serviciul de canalizare", quantity: 13, unitPrice: 13.75, lineTotal: 178.75 },
  ],
};

const inputCls = "h-9 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-sm outline-none focus:border-brand";
const labelCls = "mb-1 block text-xs font-semibold text-ink-soft";

const ELEMENT_KEYS = Object.keys(APA_CANAL_ELEMENT_LABELS) as ApaCanalElementKey[];

export default function ApaCanalLayoutEditor({
  company,
  onSave,
}: {
  company: Company;
  onSave: (layout: ApaCanalLayout) => Promise<LayoutState>;
}) {
  const toast = useToast();
  const [layout, setLayout] = useState<ApaCanalLayout>(company.apaCanalLayout ?? {});
  const [selected, setSelected] = useState<ApaCanalElementKey>("logo");
  const [pending, startTransition] = useTransition();

  const PAGE_W_PX = 297 * MM_TO_PX;
  const PAGE_H_PX = 210 * MM_TO_PX;

  // Factura se randează la mărime reală (297mm ≈ 1122px), care de obicei depășește lățimea
  // disponibilă lângă panoul lateral — coloana din dreapta (logo/text companie/Anunț/Contacte/
  // Scanează) ieșea din zona vizibilă fără niciun indiciu că mai trebuie scrollat orizontal,
  // ceea ce părea că acele elemente "lipsesc". Rezolvare: scalăm vizual containerul ca să încapă
  // mereu în lățime, transmițând același factor lui react-rnd prin prop-ul `scale` (necesar ca
  // să convertească corect delta-urile de mouse la trage/redimensionare).
  //
  // Important: NU randăm factura editabilă până nu știm scala reală. react-rnd sincronizează
  // poziția internă cu DOM-ul la montare/actualizare folosind `scale` — dacă am monta întâi cu
  // scala implicită (1) și am schimba-o imediat după (la prima măsurătoare), acel du-te-vino
  // (montare → schimbare scală fără remontare completă) producea poziții duble/greșite. Montând
  // o singură dată, direct cu scala corectă, problema dispare (verificat cu teste reale de mouse).
  const previewRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const update = () => {
      const availW = el.clientWidth - 32; // p-4 = 16px pe fiecare parte
      setScale(Math.min(1, Math.round((availW / PAGE_W_PX) * 100) / 100));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [PAGE_W_PX]);

  function patch(key: ApaCanalElementKey, next: Partial<ApaCanalLayout[ApaCanalElementKey]>) {
    setLayout((prev) => {
      const base = APA_CANAL_LAYOUT_DEFAULTS[key];
      const current = prev[key] ?? base;
      return { ...prev, [key]: { ...current, ...next } };
    });
  }

  function save() {
    startTransition(async () => {
      const res = await onSave(layout);
      if (res?.ok) toast.success("Șablon salvat");
      else toast.error(res?.error ?? "Eroare la salvare");
    });
  }

  function reset() {
    setLayout({});
  }

  function resetOne(key: ApaCanalElementKey) {
    setLayout((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  const base = APA_CANAL_LAYOUT_DEFAULTS[selected];
  const val = layout[selected] ?? base;
  const isTextKey = APA_CANAL_TEXT_KEYS.includes(selected);

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div ref={previewRef} className="min-w-0 flex-1 overflow-auto rounded-2xl border border-[var(--color-line)] bg-zinc-100 p-4">
        {scale !== null && (
          <div style={{ width: PAGE_W_PX * scale, height: PAGE_H_PX * scale }}>
            <div style={{ width: PAGE_W_PX, height: PAGE_H_PX, transform: `scale(${scale})`, transformOrigin: "top left" }}>
              <ApaCanalInvoicePublic
                invoice={SAMPLE_INVOICE}
                company={company}
                layout={layout}
                editable
                previewScale={scale}
                onLayoutChange={(key, override) => setLayout((prev) => ({ ...prev, [key]: override }))}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex w-full flex-col gap-4 lg:w-80 lg:shrink-0">
        <div className="card flex flex-col gap-3 p-4">
          <h3 className="text-sm font-bold">Elemente</h3>
          <p className="-mt-2 text-xs text-ink-soft">
            Trage/redimensionează direct pe factură (dreptunghiurile punctate), sau alege un element aici pentru control exact.
          </p>
          <select
            className={inputCls}
            value={selected}
            onChange={(e) => setSelected(e.target.value as ApaCanalElementKey)}
          >
            {ELEMENT_KEYS.map((key) => (
              <option key={key} value={key}>{APA_CANAL_ELEMENT_LABELS[key]}</option>
            ))}
          </select>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>X (mm)</label>
              <input type="number" step="0.1" className={inputCls} value={val.xMm ?? base.xMm}
                onChange={(e) => patch(selected, { xMm: Number(e.target.value) })} />
            </div>
            <div>
              <label className={labelCls}>Y (mm)</label>
              <input type="number" step="0.1" className={inputCls} value={val.yMm ?? base.yMm}
                onChange={(e) => patch(selected, { yMm: Number(e.target.value) })} />
            </div>
            <div>
              <label className={labelCls}>Lățime (mm)</label>
              <input type="number" step="0.1" className={inputCls} value={val.widthMm ?? base.widthMm}
                onChange={(e) => patch(selected, { widthMm: Number(e.target.value) })} />
            </div>
            <div>
              <label className={labelCls}>Înălțime (mm)</label>
              <input type="number" step="0.1" className={inputCls} value={val.heightMm ?? base.heightMm}
                onChange={(e) => patch(selected, { heightMm: Number(e.target.value) })} />
            </div>
          </div>

          {isTextKey && (
            <div className="flex items-end gap-3 border-t border-[var(--color-line)] pt-3">
              <div className="flex-1">
                <label className={labelCls}>Mărime font (mm)</label>
                <input type="number" step="0.1" className={inputCls} value={layout[selected]?.fontSizeMm ?? ""}
                  placeholder="implicit"
                  onChange={(e) => patch(selected, { fontSizeMm: e.target.value === "" ? undefined : Number(e.target.value) })} />
              </div>
              <label className="flex h-9 items-center gap-1.5 text-xs font-medium">
                <input type="checkbox" className="size-4 accent-[var(--color-brand)]" checked={!!layout[selected]?.bold}
                  onChange={(e) => patch(selected, { bold: e.target.checked })} />
                Bold
              </label>
            </div>
          )}

          <button
            onClick={() => resetOne(selected)}
            className="tap h-9 rounded-lg border border-[var(--color-line)] text-xs font-medium hover:bg-[var(--color-surface-2)]"
          >
            Resetează doar acest element
          </button>
        </div>

        <div className="flex gap-2">
          <button onClick={save} disabled={pending} className="tap h-11 flex-1 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
            {pending ? "Se salvează…" : "Salvează șablonul"}
          </button>
          <button onClick={reset} disabled={pending} className="tap h-11 rounded-xl border border-[var(--color-line)] px-4 text-sm font-medium hover:bg-[var(--color-surface-2)]">
            Resetează tot
          </button>
        </div>
      </div>
    </div>
  );
}
