import ReadingConfirmForm from "@/app/components/ReadingConfirmForm";
import { getPendingForConfirm } from "@/lib/services/portal-meters";
import { getT } from "@/lib/i18n/server-t";
import { getLocaleFromCookie } from "@/lib/i18n/locale-cookie";
import { dateTag } from "@/lib/i18n/t";

export const dynamic = "force-dynamic";

/**
 * Linkul din emailul „Confirmă citirea” (public, fără cont): arată citirea trimisă din portal (index + poză) care încă NU e înregistrată și un buton de confirmare. Confirmarea se face cu un buton
 * (cerere POST), nu din simpla deschidere a linkului — programele de protecție ale căsuțelor de email deschid automat linkurile și ar confirma în locul plătitorului.
 */
export default async function ConfirmReadingPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const t = await getT();
  const tag = dateTag(await getLocaleFromCookie());
  const token = (await searchParams).t ?? "";
  const p = await getPendingForConfirm(token);
  const fmt = (n: number) => n.toLocaleString(tag, { maximumFractionDigits: 3 });

  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <div className="card w-full max-w-md p-6 shadow-sm">
        <h1 className="text-lg font-bold">{t("Confirmarea citirii contorului")}</h1>
        {"error" in p ? (
          <p className="mt-4 rounded-xl bg-st-cancelled/10 px-3 py-3 text-sm text-st-cancelled" role="alert" data-confirm-problem="">{t(p.error)}</p>
        ) : (
          <>
            <p className="mt-2 text-sm text-ink-soft">{t("Citirea de mai jos nu este încă înregistrată. Confirm-o dacă ai trimis-o tu și indexul este cel de pe contor.")}</p>
            <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl bg-[var(--color-surface-2)] p-4 text-sm" data-confirm-reading="">
              <dt className="text-ink-soft">{t("Contor")}</dt>
              <dd className="font-semibold">{p.contor}</dd>
              <dt className="text-ink-soft">{t("Luna")}</dt>
              <dd className="font-semibold">{p.period}</dd>
              <dt className="text-ink-soft">{t("Index trimis")}</dt>
              <dd className="font-semibold">{fmt(p.value)} m³</dd>
              <dt className="text-ink-soft">{t("Data și ora")}</dt>
              <dd className="font-semibold">{new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Chisinau" }).format(p.submittedAt)}</dd>
            </dl>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.photoUrl} alt={t("Poza contorului")} className="mt-3 max-h-64 w-full rounded-xl border border-[var(--color-line)] object-contain" />
            <ReadingConfirmForm token={token} />
          </>
        )}
      </div>
    </main>
  );
}
