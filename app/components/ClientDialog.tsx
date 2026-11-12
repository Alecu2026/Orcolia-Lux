"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { linkCallToClientAction } from "@/app/actions/pbx";
import {
  createClient,
  updateClient,
  type ClientState,
} from "@/app/actions/clients";
import { IconX } from "./icons";
import { useMessages, useT } from "@/lib/i18n/context";

export type ClientEdit = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  telegramChatId: string | null;
  notes: string | null;
  address?: string | null;
};

/** Clientul nou pornit dintr-un apel PBX: telefonul apelantului și ce se știe deja despre el (din CRM sau din lista de abonați 1C). */
export type ClientPrefill = {
  phone: string;
  name: string | null;
  address: string | null;
  email: string | null;
  source: "client" | "meter" | null;
  /** clientul din CRM care are deja acest număr */
  clientId: string | null;
  /** apelul de pe care s-a pornit */
  callId: string | null;
};

const input =
  "h-12 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-4 text-[15px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/30";

export default function ClientDialog({
  client,
  prefill = null,
  onClose,
  onCreated,
}: {
  client: ClientEdit | null; // null = creare
  prefill?: ClientPrefill | null;
  onClose: () => void;
  /** Apelat după crearea unui client nou (ex. din formularul de task: clientul se alege pe loc). Fără el, lista paginii se reîmprospătează. */
  onCreated?: (c: { id: string; name: string }) => void;
}) {
  const router = useRouter();
  const m = useMessages();
  const t = useT();
  const action = client ? updateClient : createClient;
  const [state, formAction, pending] = useActionState<ClientState, FormData>(
    action,
    undefined,
  );

  const [linking, startLink] = useTransition();
  const [linkMsg, setLinkMsg] = useState<string | null>(null);

  useEffect(() => {
    if (state?.ok) {
      if (onCreated && state.id) onCreated({ id: state.id, name: state.name ?? "" });
      else router.refresh();
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="card max-h-[92dvh] w-full max-w-md overflow-auto rounded-b-none rounded-t-2xl p-5 sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold">
            {client ? m.clients.editTitle : m.clients.newTitle}
          </h2>
          <button onClick={onClose} className="tap grid size-9 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={m.common.close}>
            <IconX className="size-4" />
          </button>
        </div>

        <form action={formAction} className="flex flex-col gap-3">
          {client && <input type="hidden" name="id" value={client.id} />}
          {prefill?.callId && <input type="hidden" name="callId" value={prefill.callId} />}
          {prefill && prefill.source === "client" && prefill.clientId && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              {t("Numărul acesta există deja în CRM, la clientul „{name}”. Nu crea un duplicat: leagă apelul de el.", { name: prefill.name ?? "" })}
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={linking || !prefill.callId}
                  onClick={() => startLink(async () => {
                    const r = await linkCallToClientAction(prefill.callId ?? "", prefill.clientId ?? "");
                    setLinkMsg(r.ok ? t("Apelul a fost legat de client.") : t(r.error));
                    if (r.ok) { router.refresh(); }
                  })}
                  className="tap h-8 rounded-lg bg-brand px-3 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {t("Leagă apelul de acest client")}
                </button>
                {linkMsg && <span>{linkMsg}</span>}
              </div>
            </div>
          )}
          {prefill && prefill.source === "meter" && (
            <p className="rounded-xl bg-brand/10 px-3 py-2 text-xs text-ink-soft">{t("Datele au fost completate automat din lista de abonați 1C (după număr). Verifică-le înainte de a salva.")}</p>
          )}
          <input name="name" defaultValue={client?.name ?? prefill?.name ?? ""} placeholder={m.clients.namePlaceholder} required className={input} />
          <input name="phone" defaultValue={client?.phone ?? prefill?.phone ?? ""} placeholder={m.clients.phonePlaceholder} inputMode="tel" className={input} />
          <input name="address" defaultValue={client?.address ?? prefill?.address ?? ""} placeholder={t("Adresă (opțional)")} autoComplete="street-address" maxLength={300} className={input} />
          <input name="email" type="email" defaultValue={client?.email ?? prefill?.email ?? ""} placeholder={m.clients.emailPlaceholder} className={input} />
          <textarea name="notes" defaultValue={client?.notes ?? ""} placeholder={m.clients.notesPlaceholder} rows={3} className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-4 py-3 text-[15px] outline-none focus:border-brand" />

          {state?.error && <p className="text-sm text-st-cancelled">{t(state.error)}</p>}

          <button type="submit" disabled={pending} className="tap h-12 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
            {pending ? m.common.saving : m.common.save}
          </button>
        </form>
      </div>
    </div>
  );
}
