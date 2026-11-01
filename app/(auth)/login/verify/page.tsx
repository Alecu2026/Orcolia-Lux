import { redirect } from "next/navigation";
import TotpLoginForm from "@/app/components/TotpLoginForm";
import { readMfaPending } from "@/lib/login-security";
import { getT } from "@/lib/i18n/server-t";

export const dynamic = "force-dynamic";

/** Pasul 2 al intrării: se ajunge aici doar cu parola corectă (cookie semnat, 5 minute). Fără el, înapoi la autentificare. */
export default async function LoginVerifyPage() {
  const t = await getT();
  if (!(await readMfaPending())) redirect("/login");
  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <div className="card w-full max-w-sm p-7 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-brand text-white">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="11" width="16" height="10" rx="2.5" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold leading-5">{t("Verificare în doi pași")}</h1>
            <p className="text-xs text-ink-soft">{t("Parola este corectă. Mai trebuie un cod.")}</p>
          </div>
        </div>
        <TotpLoginForm />
      </div>
    </main>
  );
}
