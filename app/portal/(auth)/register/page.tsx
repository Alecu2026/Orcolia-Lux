import Link from "next/link";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import PortalRegisterRequestForm from "@/app/components/PortalRegisterRequestForm";
import PortalRegisterConfirmForm from "@/app/components/PortalRegisterConfirmForm";

export const dynamic = "force-dynamic";

export default async function PortalRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ meterSeries?: string; email?: string; sent?: string }>;
}) {
  if (!env.isConfigured) redirect("/dashboard");
  const { meterSeries = "", email = "", sent } = await searchParams;
  const step2 = sent === "1" && !!meterSeries && !!email;

  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <div className="card w-full max-w-sm p-7 shadow-sm">
        <div className="mb-6">
          <h1 className="text-lg font-bold leading-5">Activare cont</h1>
          <p className="mt-1 text-xs text-ink-soft">
            {step2
              ? "Am trimis un cod de 6 cifre pe email. Introdu-l mai jos împreună cu parola pe care vrei s-o folosești."
              : "Introdu seria contorului (de pe factură) și emailul tău — îți trimitem un cod de confirmare."}
          </p>
        </div>

        {step2 ? (
          <PortalRegisterConfirmForm meterSeries={meterSeries} email={email} />
        ) : (
          <PortalRegisterRequestForm />
        )}

        <p className="mt-5 text-center text-xs text-ink-soft">
          <Link href="/portal/login" className="text-brand hover:underline">
            Înapoi la autentificare
          </Link>
        </p>
      </div>
    </main>
  );
}
