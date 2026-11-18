import Link from "next/link";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import PortalResetPasswordForm from "@/app/components/PortalResetPasswordForm";
import { getT } from "@/lib/i18n/server-t";
import BrandLogo from "@/app/components/BrandLogo";

export const dynamic = "force-dynamic";

export default async function PortalResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; sent?: string }>;
}) {
  const t = await getT();
  if (!env.isConfigured) redirect("/dashboard");
  const { email = "", sent } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <div className="card aqua-border w-full max-w-sm p-7 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <BrandLogo size={48} />
          <div className="min-w-0">
          <h1 className="text-lg font-bold leading-5">{t("Resetare parolă")}</h1>
          <p className="mt-1 text-xs text-ink-soft">
            {sent === "1"
              ? t("Am trimis un cod de 6 cifre pe email. Introdu-l mai jos împreună cu noua parolă.")
              : t("Introdu codul de 6 cifre primit pe email, împreună cu noua parolă.")}
          </p>
          </div>
        </div>

        <PortalResetPasswordForm email={email} />

        <p className="mt-5 text-center text-xs text-ink-soft">
          <Link href="/portal/login" className="text-brand hover:underline">
            {t("Înapoi la autentificare")}
          </Link>
        </p>
      </div>
    </main>
  );
}
