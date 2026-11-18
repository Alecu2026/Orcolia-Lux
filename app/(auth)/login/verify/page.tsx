import { redirect } from "next/navigation";
import TotpLoginForm from "@/app/components/TotpLoginForm";
import { readMfaPending } from "@/lib/login-security";
import { getT } from "@/lib/i18n/server-t";
import BrandLogo from "@/app/components/BrandLogo";

export const dynamic = "force-dynamic";

/** Pasul 2 al intrării: se ajunge aici doar cu parola corectă (cookie semnat, 5 minute). Fără el, înapoi la autentificare. */
export default async function LoginVerifyPage() {
  const t = await getT();
  if (!(await readMfaPending())) redirect("/login");
  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <div className="card aqua-border w-full max-w-sm p-7 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <BrandLogo size={48} />
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
