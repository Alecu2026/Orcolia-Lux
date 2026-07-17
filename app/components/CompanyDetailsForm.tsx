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

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 700_000) {
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

      {state?.error && <p className="text-sm text-st-cancelled">{state.error}</p>}
      {state?.ok && <p className="text-sm text-st-done">{m.company.saved}</p>}

      <button type="submit" disabled={pending} className="tap h-11 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
        {pending ? m.common.saving : m.company.saveBtn}
      </button>
    </form>
  );
}
