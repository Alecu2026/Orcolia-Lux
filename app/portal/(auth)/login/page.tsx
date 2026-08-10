import Link from "next/link";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import PortalLoginForm from "@/app/components/PortalLoginForm";

export const dynamic = "force-dynamic";

export default async function PortalLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  if (!env.isConfigured) redirect("/dashboard");
  const { reset } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <div className="card w-full max-w-sm p-7 shadow-sm">
        <div className="mb-6">
          <h1 className="text-lg font-bold leading-5">Portal client</h1>
          <p className="mt-1 text-xs text-ink-soft">Apă-Canal — facturi și tichete</p>
        </div>

        {reset === "1" && (
          <p className="mb-4 rounded-xl bg-brand-soft px-3 py-2 text-xs text-brand-strong">
            Parola a fost schimbată. Autentifică-te cu noua parolă.
          </p>
        )}

        <PortalLoginForm />

        <p className="mt-5 text-center text-xs text-ink-soft">
          Nu ai cont?{" "}
          <Link href="/portal/register" className="text-brand hover:underline">
            Activează-l cu seria contorului
          </Link>
        </p>
      </div>
    </main>
  );
}
