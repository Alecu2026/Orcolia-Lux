"use client";

import { useLayoutEffect, useRef, useState, useTransition } from "react";
import type { Company } from "@/lib/queries/company";
import type { ApaCanalLayout, ApaCanalElementKey, ApaCanalCustomImage } from "@/lib/apa-canal-layout";
import { APA_CANAL_ELEMENT_LABELS, APA_CANAL_TEXT_KEYS, APA_CANAL_DEFAULT_FONT_MM, APA_CANAL_LAYOUT_DEFAULTS, MM_TO_PX, round1 } from "@/lib/apa-canal-layout";
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
  subtotal: 483.6,
  grandTotal: 293.6,
  monthlyConsumption: ["7", "8", "9", "10", "11", "12", "1", "2", "3", "4", "5", "6"].map((label, i) => ({
    label,
    value: [10, 31, 10, 10, 6, 8, 5, 5, 27, 32, 0, 13][i],
  })),
  client: { name: "Gheorghe" },
  items: [
    { id: "sample-apa", description: "Serviciul de alimentare cu apa", quantity: 13, unitPrice: 23.45, lineTotal: 304.85 },
    { id: "sample-canal", description: "Serviciul de canalizare", quantity: 13, unitPrice: 13.75, lineTotal: 178.75 },
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

  // Textul urmează caseta și când înălțimea e schimbată din câmpul numeric (nu doar la tras de
  // colț pe factură) — vezi explicația din onResizeStop din ApaCanalInvoicePublic.
  function patchHeight(key: ApaCanalElementKey, newHeightMm: number) {
    setLayout((prev) => {
      const base = APA_CANAL_LAYOUT_DEFAULTS[key];
      const current = prev[key] ?? base;
      const oldHeightMm = current.heightMm ?? base.heightMm;
      const isText = (APA_CANAL_TEXT_KEYS as ApaCanalElementKey[]).includes(key);
      if (!isText || oldHeightMm <= 0) return { ...prev, [key]: { ...current, heightMm: newHeightMm } };
      const ratio = newHeightMm / oldHeightMm;
      const currentFontSizeMm = (current as { fontSizeMm?: number }).fontSizeMm ?? APA_CANAL_DEFAULT_FONT_MM[key] ?? 3;
      const fontSizeMm = Math.min(24, Math.max(1.5, round1(currentFontSizeMm * ratio)));
      return { ...prev, [key]: { ...current, heightMm: newHeightMm, fontSizeMm } };
    });
  }

  function save() {
    startTransition(async () => {
      try {
        const res = await onSave(layout);
        if (res?.ok) toast.success("Șablon salvat");
        else toast.error(res?.error ?? "Eroare la salvare");
      } catch (e) {
        // Eroare aruncată de server sau de rețea (altfel nu s-ar vedea nimic): arătăm că salvarea a eșuat.
        console.error("[layout] salvarea a eșuat:", e);
        toast.error("Salvarea nu a reușit (eroare de server sau de rețea). Reîncarcă pagina și încearcă din nou.");
      }
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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoWarn, setPhotoWarn] = useState("");

  function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 5_000_000) {
      setPhotoWarn("Fotografia e prea mare (max 5MB).");
      return;
    }
    setPhotoWarn("");
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const image: ApaCanalCustomImage = {
        id: `img-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
        xMm: 100,
        yMm: 80,
        widthMm: 60,
        heightMm: 60,
        dataUrl,
      };
      setLayout((prev) => ({ ...prev, customImages: [...(prev.customImages ?? []), image] }));
    };
    reader.readAsDataURL(f);
  }

  function patchCustomImage(id: string, patch: Partial<ApaCanalCustomImage>) {
    setLayout((prev) => ({
      ...prev,
      customImages: (prev.customImages ?? []).map((img) => (img.id === id ? { ...img, ...patch } : img)),
    }));
  }

  function deleteCustomImage(id: string) {
    setLayout((prev) => ({ ...prev, customImages: (prev.customImages ?? []).filter((img) => img.id !== id) }));
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
                onCustomImageChange={patchCustomImage}
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
                onChange={(e) => patchHeight(selected, Number(e.target.value))} />
            </div>
          </div>

          {isTextKey && (
            <>
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

              <div>
                <label className={labelCls}>Text personalizat (înlocuiește conținutul)</label>
                <textarea
                  className={`${inputCls} h-20 py-2`}
                  value={layout[selected]?.textOverride ?? ""}
                  placeholder="Lasă gol pentru conținutul normal al facturii"
                  onChange={(e) => patch(selected, { textOverride: e.target.value === "" ? undefined : e.target.value })}
                />
                <p className="mt-1 text-[11px] text-ink-soft">
                  Atenție: pe elemente cu date live (sume, indici, tabele), textul rămâne fix identic pe toate facturile.
                </p>
              </div>
            </>
          )}

          <button
            onClick={() => resetOne(selected)}
            className="tap h-9 rounded-lg border border-[var(--color-line)] text-xs font-medium hover:bg-[var(--color-surface-2)]"
          >
            Resetează doar acest element
          </button>
        </div>

        <div className="card flex flex-col gap-3 p-4">
          <h3 className="text-sm font-bold">Fotografii</h3>
          <p className="-mt-2 text-xs text-ink-soft">Adaugă o imagine liberă, apoi trage/redimensionează pe factură.</p>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onPickPhoto} />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="tap h-9 rounded-lg border border-[var(--color-line)] text-xs font-medium hover:bg-[var(--color-surface-2)]"
          >
            + Adaugă fotografie
          </button>
          {photoWarn && <p className="text-xs text-st-cancelled">{photoWarn}</p>}

          {(layout.customImages ?? []).map((img) => (
            <div key={img.id} className="flex items-center gap-2 border-t border-[var(--color-line)] pt-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.dataUrl} alt="" className="size-10 shrink-0 rounded-lg border border-[var(--color-line)] object-cover" />
              <div className="grid flex-1 grid-cols-2 gap-1">
                <input type="number" step="0.1" className={`${inputCls} h-7 text-xs`} value={img.xMm}
                  onChange={(e) => patchCustomImage(img.id, { xMm: Number(e.target.value) })} title="X (mm)" />
                <input type="number" step="0.1" className={`${inputCls} h-7 text-xs`} value={img.yMm}
                  onChange={(e) => patchCustomImage(img.id, { yMm: Number(e.target.value) })} title="Y (mm)" />
              </div>
              <button
                onClick={() => deleteCustomImage(img.id)}
                className="tap h-8 shrink-0 rounded-lg border border-[var(--color-line)] px-2 text-xs text-st-cancelled hover:bg-[var(--color-surface-2)]"
              >
                Șterge
              </button>
            </div>
          ))}
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
