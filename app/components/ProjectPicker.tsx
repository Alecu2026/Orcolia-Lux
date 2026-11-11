"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import SuggestInput, { type SuggestItem } from "./SuggestInput";
import { useToast } from "./toast";
import { IconCheck, IconPlus, IconX } from "./icons";

/**
 * Proiectul unei sarcini: câmp cu sugestii (se scrie, apar proiectele potrivite), nu listă derulantă. Id-ul ales se trimite în câmpul ascuns `name` (implicit `projectId`).
 * Cu `onQuickCreate`, „+” adaugă un proiect nou direct din formular (doar nume).
 */

type Opt = { id: string; name: string };
type QuickResult = { ok: true; id: string; name: string } | { ok: false; error: string };

const field = "h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";

export default function ProjectPicker({
  name = "projectId",
  projects,
  defaultId = "",
  placeholder,
  canCreate = false,
  onQuickCreate,
}: {
  name?: string;
  projects: Opt[];
  defaultId?: string;
  placeholder?: string;
  canCreate?: boolean;
  onQuickCreate?: (name: string) => Promise<QuickResult>;
}) {
  const t = useT();
  const toast = useToast();
  const [list, setList] = useState<Opt[]>(projects);
  const [value, setValue] = useState<SuggestItem | null>(() => {
    const p = defaultId ? projects.find((x) => x.id === defaultId) : null;
    return p ? { id: p.id, name: p.name } : null;
  });
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  // proiectele vin odată cu pagina (sunt puține față de clienți): sugestiile se filtrează local, fără cereri
  async function search(q: string): Promise<SuggestItem[]> {
    const needle = q.toLowerCase();
    return list.filter((p) => p.name.toLowerCase().includes(needle)).slice(0, 8);
  }

  async function create() {
    const n = newName.trim();
    if (!n || !onQuickCreate) return;
    setBusy(true);
    const res = await onQuickCreate(n);
    setBusy(false);
    if (res.ok) {
      setList((l) => [{ id: res.id, name: res.name }, ...l]);
      setValue({ id: res.id, name: res.name });
      setNewName("");
      setAdding(false);
      toast.success(t("Creat"));
    } else {
      toast.error(t(res.error));
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <SuggestInput
        name={name}
        value={value}
        onChange={setValue}
        search={search}
        placeholder={placeholder ?? t("Caută proiect")}
        noResults={t("Niciun proiect găsit")}
        action={
          canCreate && onQuickCreate && !adding ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              title={t("Proiect nou")}
              aria-label={t("Proiect nou")}
              className="tap grid size-11 shrink-0 place-items-center rounded-xl border border-[var(--color-line)] text-brand hover:bg-brand-soft"
            >
              <IconPlus className="size-4" />
            </button>
          ) : undefined
        }
      />
      {adding && (
        <div className="flex gap-2">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void create();
              }
              if (e.key === "Escape") {
                setAdding(false);
                setNewName("");
              }
            }}
            placeholder={t("Numele proiectului nou…")}
            className={field}
          />
          <button type="button" disabled={busy || !newName.trim()} onClick={() => void create()} className="tap grid size-11 shrink-0 place-items-center rounded-xl bg-brand text-white hover:bg-brand-strong disabled:opacity-50" title={t("Salvează")}>
            <IconCheck className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setNewName("");
            }}
            className="tap grid size-11 shrink-0 place-items-center rounded-xl border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)]"
            title={t("Anulează")}
          >
            <IconX className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
