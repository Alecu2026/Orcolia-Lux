import Link from "next/link";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import ForgotPasswordForm from "@/app/components/ForgotPasswordForm";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  if (!env.isConfigured) redirect("/dashboard");

  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <div className="card w-full max-w-sm p-7 shadow-sm">
        <div className="mb-6">
          <h1 className="text-lg font-bold leading-5">Am uitat parola</h1>
          <p className="mt-1 text-xs text-ink-soft">
            Introdu emailul contului tău — îți trimitem un cod de confirmare.
          </p>
        </div>

        <ForgotPasswordForm />

        <p className="mt-5 text-center text-xs text-ink-soft">
          <Link href="/login" className="text-brand hover:underline">
            Înapoi la autentificare
          </Link>
        </p>
      </div>
    </main>
  );
}
