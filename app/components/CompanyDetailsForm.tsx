"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { updateCompanySettings, type CompanyState } from "@/app/actions/company";
import type { Company } from "@/lib/queries/company";
import { IconX } from "./icons";
import { useMessages } from "@/lib/i18n/context";

const input =
  "h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";
const label = "mb-1.5 block text-xs font-semibold text-ink-soft";

export default function CompanyDetailsForm({
  company,
  canEdit,
}: {
  company: Company;
  canEdit: boolean;
}) {
  const router = useRouter();
  const m = useMessages();
  const [state, action, pending] = useActionState<CompanyState, FormData>(
    updateCompanySettings,
    undefined,
  );
  const [logo, setLogo] = useState<string | null>(company.logo);
  const [warn, setWarn] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const [apaCanalLogo, setApaCanalLogo] = useState<string | null>(company.apaCanalLogo);
  const [apaCanalWarn, setApaCanalWarn] = useState("");
  const apaCanalFileRef = useRef<HTMLInputElement>(null);

  function onApaCanalFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5_000_000) {
      setApaCanalWarn(m.company.logoTooLarge);
      return;
    }
    setApaCanalWarn("");
    const reader = new FileReader();
    reader.onload = () => setApaCanalLogo(String(reader.result));
    reader.readAsDataURL(f);
  }

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5_000_000) {
      setWarn(m.company.logoTooLarge);
      return;
    }
    setWarn("");
    const reader = new FileReader();
    reader.onload = () => setLogo(String(reader.result));
    reader.readAsDataURL(f);
  }

  if (!canEdit) {
    return (
      <div className="card p-5">
        <h2 className="text-base font-bold">{m.company.title}</h2>
        <p className="mt-1 text-sm text-ink-soft">{m.company.noEditPermission}</p>
      </div>
    );
  }

  return (
    <form action={action} className="card flex flex-col gap-4 p-5">
      <h2 className="text-base font-bold">{m.company.title}</h2>
      <p className="-mt-2 text-xs text-ink-soft">{m.company.subtitle}</p>

      <input type="hidden" name="logo" value={logo ?? ""} />
      <div className="flex items-center gap-4">
        <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)]">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="Logo" className="size-full object-contain" />
          ) : (
            <span className="text-xs text-ink-soft">Logo</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
          <button type="button" onClick={() => fileRef.current?.click()} className="tap rounded-lg border border-[var(--color-line)] px-3 py-2 text-sm hover:bg-[var(--color-surface-2)]">
            {m.company.uploadLogo}
          </button>
          {logo && (
            <button type="button" onClick={() => setLogo(null)} className="tap inline-flex items-center gap-1 text-xs text-st-cancelled">
              <IconX className="size-3.5" /> {m.company.removeLogo}
            </button>
          )}
        </div>
      </div>
      {warn && <p className="text-sm text-st-cancelled">{warn}</p>}

      <div>
        <label className={label}>{m.company.nameLabel}</label>
        <input name="companyName" defaultValue={company.companyName} required className={input} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>{m.company.phoneLabel}</label>
          <input name="phone" defaultValue={company.phone ?? ""} className={input} />
        </div>
        <div>
          <label className={label}>{m.company.emailLabel}</label>
          <input name="email" type="email" defaultValue={company.email ?? ""} className={input} />
        </div>
      </div>

      <div>
        <label className={label}>{m.company.addressLabel}</label>
        <input name="address" defaultValue={company.address ?? ""} className={input} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>{m.company.taxIdLabel}</label>
          <input name="taxId" defaultValue={company.taxId ?? ""} className={input} />
        </div>
        <div>
          <label className={label}>{m.company.vatLabel}</label>
          <input name="vatNumber" defaultValue={company.vatNumber ?? ""} className={input} />
        </div>
      </div>

      <div>
        <label className={label}>{m.company.bankLabel}</label>
        <textarea name="bankDetails" defaultValue={company.bankDetails ?? ""} rows={2} className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5 text-sm outline-none focus:border-brand" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>{m.company.currencyLabel}</label>
          <input name="currency" defaultValue={company.currency} className={input} />
        </div>
        <div>
          <label className={label}>{m.company.invoicePrefixLabel}</label>
          <input name="invoicePrefix" defaultValue={company.invoicePrefix} className={input} />
        </div>
      </div>

      <div>
        <label className={label}>{m.company.apptModuleLabel}</label>
        <input
          name="appointmentsLabel"
          defaultValue={company.appointmentsLabel}
          placeholder={m.company.apptModulePlaceholder}
          className={input}
        />
        <p className="mt-1 text-xs text-ink-soft">{m.company.apptModuleHint}</p>
      </div>

      <details className="rounded-xl border border-[var(--color-line)] p-3">
        <summary className="cursor-pointer text-sm font-semibold">Factură Apă-Canal</summary>
        <p className="mt-1 text-xs text-ink-soft">
          Logo-ul și textele fixe afișate pe facturile de tip „Apă-Canal" (antet, contacte, avertismente) — separate de logo-ul principal al firmei de mai sus.
        </p>
        <div className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="apaCanalLogo" value={apaCanalLogo ?? ""} />
          <div className="flex items-center gap-4">
            <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)]">
              {apaCanalLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={apaCanalLogo} alt="Logo Apă-Canal" className="size-full object-contain" />
              ) : (
                <span className="text-xs text-ink-soft">Logo</span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <input ref={apaCanalFileRef} type="file" accept="image/*" onChange={onApaCanalFile} className="hidden" />
              <button type="button" onClick={() => apaCanalFileRef.current?.click()} className="tap rounded-lg border border-[var(--color-line)] px-3 py-2 text-sm hover:bg-[var(--color-surface-2)]">
                Încarcă logo Apă-Canal
              </button>
              {apaCanalLogo && (
                <button type="button" onClick={() => setApaCanalLogo(null)} className="tap inline-flex items-center gap-1 text-xs text-st-cancelled">
                  <IconX className="size-3.5" /> Elimină logo
                </button>
              )}
            </div>
          </div>
          {apaCanalWarn && <p className="text-sm text-st-cancelled">{apaCanalWarn}</p>}

          <div>
            <label className={label}>Denumire furnizor</label>
            <input name="apaCanalCompanyLine" defaultValue={company.apaCanalCompanyLine} className={input} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>Adresă furnizor</label>
              <input name="apaCanalAddress" defaultValue={company.apaCanalAddress} className={input} />
            </div>
            <div>
              <label className={label}>Email furnizor</label>
              <input name="apaCanalEmail" defaultValue={company.apaCanalEmail} className={input} />
            </div>
          </div>
          <div>
            <label className={label}>Cod fiscal</label>
            <input name="apaCanalCodFiscal" defaultValue={company.apaCanalCodFiscal} className={input} />
          </div>
          <div>
            <label className={label}>Nume persoană de contact</label>
            <input name="apaCanalContactName" defaultValue={company.apaCanalContactName} className={input} />
          </div>
          <div>
            <label className={label}>Lista de contacte (un rând pe telefon)</label>
            <textarea name="apaCanalContactsText" defaultValue={company.apaCanalContactsText} rows={6} className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5 text-sm outline-none focus:border-brand" />
          </div>
          <div>
            <label className={label}>Text „ATENȚIE"</label>
            <textarea name="apaCanalAtentieText" defaultValue={company.apaCanalAtentieText} rows={4} className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5 text-sm outline-none focus:border-brand" />
          </div>
          <div>
            <label className={label}>Text „Anunț"</label>
            <textarea name="apaCanalAnuntText" defaultValue={company.apaCanalAnuntText} rows={3} className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5 text-sm outline-none focus:border-brand" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>Tarif implicit apă, lei/m³</label>
              <input name="apaCanalTarifApa" type="number" inputMode="decimal" step="any" defaultValue={company.apaCanalTarifApa || ""} className={input} />
            </div>
            <div>
              <label className={label}>Tarif implicit canalizare, lei/m³</label>
              <input name="apaCanalTarifCanal" type="number" inputMode="decimal" step="any" defaultValue={company.apaCanalTarifCanal || ""} className={input} />
            </div>
          </div>
          <p className="-mt-1 text-xs text-ink-soft">
            Aceste tarife se pre-completează automat la crearea unei facturi noi Apă-Canal — pot fi modificate oricând direct pe factură.
          </p>
        </div>
      </details>

      {state?.error && <p className="text-sm text-st-cancelled">{state.error}</p>}
      {state?.ok && <p className="text-sm text-st-done">{m.company.saved}</p>}

      <button type="submit" disabled={pending} className="tap h-11 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
        {pending ? m.common.saving : m.company.saveBtn}
      </button>
    </form>
  );
}
