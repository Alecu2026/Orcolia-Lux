import Link from "next/link";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import PortalLoginForm from "@/app/components/PortalLoginForm";
import { getT } from "@/lib/i18n/server-t";
import BrandLogo from "@/app/components/BrandLogo";

export const dynamic = "force-dynamic";

export default async function PortalLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  const t = await getT();
  if (!env.isConfigured) redirect("/dashboard");
  const { reset } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <div className="card aqua-border w-full max-w-sm p-7 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <BrandLogo size={48} />
          <div className="min-w-0">
          <h1 className="text-lg font-bold leading-5">{t("Portal client")}</h1>
          <p className="mt-1 text-xs text-ink-soft">{t("Apă-Canal — facturi și cereri")}</p>
          </div>
        </div>

        {reset === "1" && (
          <p className="mb-4 rounded-xl bg-brand-soft px-3 py-2 text-xs text-brand-strong">
            {t("Parola a fost schimbată. Autentifică-te cu noua parolă.")}
          </p>
        )}

        <PortalLoginForm />

        <p className="mt-5 text-center text-xs text-ink-soft">
          {t("Nu ai cont?")}{" "}
          <Link href="/portal/register" className="text-brand hover:underline">
            {t("Activează-l cu contul personal")}
          </Link>
        </p>
      </div>
    </main>
  );
}
