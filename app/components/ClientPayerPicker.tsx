"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n/context";
import ClientDialog from "./ClientDialog";
import SuggestInput, { type SuggestItem } from "./SuggestInput";
import { IconPlus } from "./icons";

/**
 * Plătitorul și clientul unei sarcini, ca două câmpuri SEPARATE cu sugestii (nu liste derulante — sunt sute de mii): „Plătitor” (abonații din 1C, după nume, telefon sau cont)
 * și „Client” (clienții obișnuiți din CRM, fără plătitori). O sarcină are una dintre ele: alegerea într-un câmp o golește pe cealaltă. Valoarea se trimite în câmpul ascuns `name`
 * (implicit `clientId`). Lângă „Client” e „+”: se creează un client nou (nume, telefon, adresă, email, notițe) și se alege pe loc.
 */

type Sel = { kind: "payer" | "client"; item: SuggestItem } | null;
type Hit = { id: string; name: string; phone: string | null; account: string | null; payer: boolean };

const toItem = (h: Hit): SuggestItem => ({ id: h.id, name: h.name, hint: h.account ? h.account : h.phone });

async function searchKind(kind: "payer" | "client", q: string): Promise<SuggestItem[]> {
  const r = await fetch(`/api/clients/search?q=${encodeURIComponent(q)}&kind=${kind}`);
  if (!r.ok) return [];
  const j = (await r.json()) as { items?: Hit[] };
  return (j.items ?? []).map(toItem);
}

export default function ClientPayerPicker({
  defaultId = "",
  name = "clientId",
  canCreate = true,
  onPick,
}: {
  /** clientul / plătitorul ales la început (la editare sau din apel) */
  defaultId?: string;
  name?: string;
  canCreate?: boolean;
  /** apelat când se alege un plătitor / client (id-ul) */
  onPick?: (id: string) => void;
}) {
  const t = useT();
  const [sel, setSel] = useState<Sel>(null);
  const [loading, setLoading] = useState(!!defaultId);
  const [gen, setGen] = useState(0);
  const [creating, setCreating] = useState(false);

  // ce era ales la început: se află dacă e plătitor sau client și cum se numește
  useEffect(() => {
    if (!defaultId) return;
    let alive = true;
    fetch(`/api/clients/search?id=${encodeURIComponent(defaultId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { item?: Hit | null } | null) => {
        if (!alive) return;
        if (j?.item) setSel({ kind: j.item.payer ? "payer" : "client", item: toItem(j.item) });
        setLoading(false);
      })
      .catch(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [defaultId]);

  function choose(kind: "payer" | "client", item: SuggestItem | null) {
    if (item) {
      setSel({ kind, item });
      setGen((g) => g + 1); // celălalt câmp se golește (se remontează)
      onPick?.(item.id);
    } else if (sel?.kind === kind) {
      setSel(null);
      setGen((g) => g + 1);
    }
  }

  const lbl = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-soft";
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <input type="hidden" name={name} value={sel?.item.id ?? (loading ? defaultId : "")} />
      <div>
        <label className={lbl}>{t("Plătitor")}</label>
        <SuggestInput
          key={`payer-${gen}`}
          value={sel?.kind === "payer" ? sel.item : null}
          onChange={(v) => choose("payer", v)}
          search={(q) => searchKind("payer", q)}
          placeholder={t("Caută plătitor (nume, telefon, cont)")}
          noResults={t("Niciun plătitor găsit")}
        />
      </div>
      <div>
        <label className={lbl}>{t("Client")}</label>
        <SuggestInput
          key={`client-${gen}`}
          value={sel?.kind === "client" ? sel.item : null}
          onChange={(v) => choose("client", v)}
          search={(q) => searchKind("client", q)}
          placeholder={t("Caută client (nume, telefon)")}
          noResults={t("Niciun client găsit — apasă + ca să adaugi unul")}
          action={
            canCreate ? (
              <button
                type="button"
                onClick={() => setCreating(true)}
                title={t("Client nou")}
                aria-label={t("Client nou")}
                className="tap grid size-11 shrink-0 place-items-center rounded-xl border border-[var(--color-line)] text-brand hover:bg-brand-soft"
              >
                <IconPlus className="size-4" />
              </button>
            ) : undefined
          }
        />
      </div>
      {creating &&
        createPortal(
          <ClientDialog
            client={null}
            onClose={() => setCreating(false)}
            onCreated={(c) => {
              choose("client", { id: c.id, name: c.name, hint: null });
            }}
          />,
          document.body,
        )}
    </div>
  );
}
