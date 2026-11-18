import { Suspense } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import AuthForm from "@/app/components/AuthForm";
import { getT } from "@/lib/i18n/server-t";
import BrandLogo from "@/app/components/BrandLogo";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  const t = await getT();
  // Mod demo (fără DB/secret): intri direct în aplicație cu date de exemplu.
  if (!env.isConfigured) {
    redirect("/dashboard");
  }

  const hasUser = (await prisma.user.count().catch(() => 1)) > 0;
  const mode = hasUser ? "login" : "register";
  const { reset } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <div className="card aqua-border w-full max-w-sm p-7 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <BrandLogo size={48} />
          <div>
            <h1 className="text-xl font-bold leading-5">
              Aqua<span className="aqua-wave">CRM</span>
            </h1>
            <p className="text-xs text-ink-soft">
              {mode === "login" ? t("Autentificare") : t("Configurare inițială")}
            </p>
          </div>
        </div>

        {reset === "1" && mode === "login" && (
          <p className="mb-4 rounded-xl bg-brand-soft px-3 py-2 text-xs text-brand-strong">
            {t("Parola a fost schimbată. Autentifică-te cu noua parolă.")}
          </p>
        )}

        {mode === "register" && (
          <p className="mb-4 rounded-xl bg-brand-soft px-3 py-2 text-xs text-brand-strong">
            {t("Nu există încă niciun cont. Creează contul de administrator pentru a începe.")}
          </p>
        )}

        <Suspense>
          <AuthForm mode={mode} />
        </Suspense>

        <p className="mt-5 text-center text-xs text-ink-soft">
          {t("Sesiune sigură, păstrată pe acest dispozitiv timp îndelungat.")}
        </p>
      </div>
    </main>
  );
}
