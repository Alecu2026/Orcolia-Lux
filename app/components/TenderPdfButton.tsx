"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";

/** Descarcă caietul de sarcini în PDF (toate punctele, cu bifele și textul din „i”): română + engleză, doar română sau doar engleză. */
export default function TenderPdfButton() {
  const t = useT();
  const [lang, setLang] = useState<"both" | "ro" | "en">("both");
  const [show, setShow] = useState<"all" | "done" | "todo">("all");
  const [info, setInfo] = useState(true);
  const href = `/api/contract/pdf?lang=${lang}&show=${show}${info ? "" : "&info=0"}`;
  const field = "h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 text-sm";
  return (
    <div className="card flex flex-wrap items-center gap-2 p-3" data-tender-pdf="">
      <select value={lang} onChange={(e) => setLang(e.target.value as typeof lang)} className={field} aria-label={t("Limba PDF-ului")} data-tender-pdf-lang="">
        <option value="both">{t("Română + engleză")}</option>
        <option value="ro">{t("Română")}</option>
        <option value="en">{t("Engleză")}</option>
      </select>
      <select value={show} onChange={(e) => setShow(e.target.value as typeof show)} className={field} aria-label={t("Puncte în PDF")} data-tender-pdf-show="">
        <option value="all">{t("Toate")}</option>
        <option value="done">{t("Bifate")}</option>
        <option value="todo">{t("Nebifate")}</option>
      </select>
      <label className="flex h-9 cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" checked={info} onChange={(e) => setInfo(e.target.checked)} className="size-4 accent-[var(--color-brand)]" data-tender-pdf-info="" />
        {t("Cu textul din „i”")}
      </label>
      <a
        href={href}
        download
        data-tender-pdf-link=""
        className="tap ml-auto inline-flex h-9 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong"
      >
        {t("Descarcă PDF")}
      </a>
    </div>
  );
}
