import Link from "next/link";
import { getT } from "@/lib/i18n/server-t";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import PortalForgotPasswordForm from "@/app/components/PortalForgotPasswordForm";

export const dynamic = "force-dynamic";

export default async function PortalForgotPasswordPage() {
  if (!env.isConfigured) redirect("/dashboard");
  const t = await getT();

  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <div className="card w-full max-w-sm p-7 shadow-sm">
        <div className="mb-6">
          <h1 className="text-lg font-bold leading-5">{t("Am uitat parola")}</h1>
          <p className="mt-1 text-xs text-ink-soft">
            {t("Introdu emailul contului tău — îți trimitem un cod de confirmare.")}
          </p>
        </div>

        <PortalForgotPasswordForm />

        <p className="mt-5 text-center text-xs text-ink-soft">
          <Link href="/portal/login" className="text-brand hover:underline">
            {t("Înapoi la autentificare")}
          </Link>
        </p>
      </div>
    </main>
  );
}
