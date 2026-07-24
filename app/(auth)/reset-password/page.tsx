import Link from "next/link";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import ResetPasswordForm from "@/app/components/ResetPasswordForm";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; sent?: string }>;
}) {
  if (!env.isConfigured) redirect("/dashboard");
  const { email = "", sent } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <div className="card w-full max-w-sm p-7 shadow-sm">
        <div className="mb-6">
          <h1 className="text-lg font-bold leading-5">Resetare parolă</h1>
          <p className="mt-1 text-xs text-ink-soft">
            {sent === "1"
              ? "Am trimis un cod de 6 cifre pe email. Introdu-l mai jos împreună cu noua parolă."
              : "Introdu codul de 6 cifre primit pe email, împreună cu noua parolă."}
          </p>
        </div>

        <ResetPasswordForm email={email} />

        <p className="mt-5 text-center text-xs text-ink-soft">
          <Link href="/login" className="text-brand hover:underline">
            Înapoi la autentificare
          </Link>
        </p>
      </div>
    </main>
  );
}
