"use client";

import { useActionState, useEffect, useState } from "react";
import { useOnActionResult } from "@/lib/use-action-result";
import { useRouter } from "next/navigation";
import { createPortalTicket, type PortalTicketState } from "@/app/actions/portal";
import { useT } from "@/lib/i18n/context";
import type { PortalTemplate } from "@/lib/portal-template";
import { isPetitionName } from "@/lib/portal-default-templates";

const input =
  "w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-4 py-3 text-[15px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/30";
const CUSTOM = "_custom";

/**
 * Cerere nouă din cabinetul personal, în doi pași: mai întâi alegi din lista de șabloane (derulabilă dacă sunt multe) sau „Altă cerere”,
 * apoi apar subiectul și descrierea, completate din șablon și editabile. Fără șabloane, formularul apare direct.
 */
export default function PortalNewTicketForm({
  templates = [],
  initialTemplateId = "",
  defaults,
  onSent,
}: {
  /** Șabloanele create de administrator. */
  templates?: PortalTemplate[];
  /** Șablonul deja ales (ex. din link): sare peste pasul cu lista. */
  initialTemplateId?: string;
  /** Valorile implicite ale datelor cererii: adresa de consum și numele clientului (editabile). */
  defaults?: { address: string | null; consumerName: string };
  /** Apelat după ce cererea a plecat (panoul din pagina cu facturi se închide). */
  onSent?: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const first = templates.find((x) => x.id === initialTemplateId);
  // null = încă nu s-a ales nimic (se vede lista); CUSTOM = cerere scrisă de client; altfel id-ul șablonului ales
  const [chosen, setChosen] = useState<string | null>(first ? first.id : templates.length === 0 ? CUSTOM : null);
  const [title, setTitle] = useState(first?.title ?? "");
  const [description, setDescription] = useState(first?.description ?? "");
  const [address, setAddress] = useState(defaults?.address ?? "");
  const [consumerName, setConsumerName] = useState(defaults?.consumerName ?? "");
  const today = new Date().toLocaleDateString("ro-RO", { timeZone: "Europe/Bucharest" });
  const [state, formAction, pending] = useActionState<PortalTicketState, FormData>(async (prev, fd) => {
    const res = await createPortalTicket(prev, fd);
    if (res?.ok) { setChosen(templates.length === 0 ? CUSTOM : null); setTitle(""); setDescription(""); onSent?.(); } // cererea a plecat: formularul revine la început
    return res;
  }, undefined);

  function pick(id: string) {
    setChosen(id);
    const tpl = templates.find((x) => x.id === id);
    setTitle(tpl?.title ?? "");
    setDescription(tpl?.description ?? "");
  }

  useOnActionResult(state, (s) => {
    if (s.ok) router.refresh();
  });

  const isPetition = chosen !== CUSTOM && isPetitionName(templates.find((x) => x.id === chosen)?.name);
  const chosenName = chosen === CUSTOM ? t("✍ Altă cerere (scriu eu)") : templates.find((x) => x.id === chosen)?.name;

  if (chosen === null) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">{t("Alege tipul cererii")}</p>
        <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1" role="listbox" aria-label={t("Alege un șablon de cerere")}>
          {templates.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => pick(tpl.id)}
              className="tap cursor-pointer rounded-xl border border-[var(--color-line)] px-4 py-3 text-left text-sm font-medium hover:border-brand hover:bg-brand-soft"
            >
              {tpl.name}
            </button>
          ))}
          <button
            type="button"
            role="option"
            aria-selected={false}
            onClick={() => pick(CUSTOM)}
            className="tap cursor-pointer rounded-xl border border-dashed border-brand px-4 py-3 text-left text-sm font-semibold text-brand hover:bg-brand-soft"
          >
            {t("✍ Altă cerere (scriu eu)")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {templates.length > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-brand-soft px-3 py-2 text-sm">
          <span className="min-w-0 truncate font-medium text-brand-strong">{chosenName}</span>
          <button type="button" onClick={() => setChosen(null)} className="shrink-0 cursor-pointer text-xs font-semibold text-brand underline">
            {t("Schimbă")}
          </button>
        </div>
      )}
      <input type="hidden" name="templateId" value={chosen && chosen !== CUSTOM ? chosen : ""} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-ink-soft">
          {t("Adresa")} *
          <input name="address" value={address} onChange={(e) => setAddress(e.target.value)} required maxLength={300} placeholder={t("Localitate, strada, nr.")} className={`${input} mt-1 font-normal`} />
        </label>
        <label className="text-xs font-semibold text-ink-soft">
          {t("Nume consumator")} *
          <input name="consumerName" value={consumerName} onChange={(e) => setConsumerName(e.target.value)} required maxLength={150} className={`${input} mt-1 font-normal`} />
        </label>
      </div>
      <div className="grid gap-1 rounded-xl bg-[var(--color-surface-2)] px-3 py-2 text-xs text-ink-soft sm:grid-cols-2">
        <p>{t("Data depunerii")}: <b className="text-ink">{today}</b> <span>({t("automat")})</span></p>
        <p>{t("Data executării")}: <span>{t("o stabilește echipa")}</span></p>
      </div>
      <input name="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("Subiect (ex: Scurgere la contor)")} required autoFocus={chosen === CUSTOM} className={input} />
      <textarea name="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={isPetition ? t("Textul petiției") : t("Descriere (opțional)")} required={isPetition} rows={isPetition ? 8 : 4} className={input} />

      {state?.error && <p className="text-sm text-st-cancelled">{t(state.error)}</p>}
      {state?.ok && <p className="text-sm text-brand-strong">{t("Cerere trimisă cu succes.")}</p>}

      <button
        type="submit"
        disabled={pending}
        className="tap h-11 self-start rounded-xl bg-brand px-5 font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
      >
        {pending ? t("Se trimite…") : t("Trimite cerere")}
      </button>
    </form>
  );
}
