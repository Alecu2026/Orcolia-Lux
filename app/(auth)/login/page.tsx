import { Suspense } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import AuthForm from "@/app/components/AuthForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Mod demo (fără DB/secret): intri direct în aplicație cu date de exemplu.
  if (!env.isConfigured) {
    redirect("/dashboard");
  }

  const hasUser = (await prisma.user.count().catch(() => 1)) > 0;
  const mode = hasUser ? "login" : "register";

  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <div className="card w-full max-w-sm p-7 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-brand text-white">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
              <path d="M3 9h18M8 2.5v4M16 2.5v4" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold leading-5">Programări</h1>
            <p className="text-xs text-ink-soft">
              {mode === "login" ? "Autentificare" : "Configurare inițială"}
            </p>
          </div>
        </div>

        {mode === "register" && (
          <p className="mb-4 rounded-xl bg-brand-soft px-3 py-2 text-xs text-brand-strong">
            Nu există încă niciun cont. Creează contul de administrator pentru a
            începe.
          </p>
        )}

        <Suspense>
          <AuthForm mode={mode} />
        </Suspense>

        <p className="mt-5 text-center text-xs text-ink-soft">
          Sesiune sigură, păstrată pe acest dispozitiv timp îndelungat.
        </p>
      </div>
    </main>
  );
}
