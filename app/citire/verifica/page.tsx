import { prisma } from "@/lib/prisma";
import { verifyReadingToken } from "@/lib/reading-verify-token";
import ReadingVerifyForm from "@/app/components/ReadingVerifyForm";
import { getT } from "@/lib/i18n/server-t";
import { getLocaleFromCookie } from "@/lib/i18n/locale-cookie";
import { dateTag } from "@/lib/i18n/t";

export const dynamic = "force-dynamic";

/**
 * Linkul din emailul de verificare a citirii (public, fără cont): arată citirea și lasă plătitorul s-o confirme sau s-o conteste. Confirmarea se face cu un buton (cerere POST), nu din simpla
 * deschidere a linkului — programele de protecție ale căsuțelor de email deschid automat linkurile și ar confirma în locul plătitorului.
 */
export default async function VerifyReadingPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const t = await getT();
  const tag = dateTag(await getLocaleFromCookie());
  const token = (await searchParams).t ?? "";
  const claim = verifyReadingToken(token);
  const r = claim
    ? await prisma.meterReading.findUnique({
        where: { id: claim.readingId },
        select: { value: true, prevValue: true, contor: true, period: true, readAt: true, verifiedAt: true, disputedAt: true },
      }).catch(() => null)
    : null;

  let problem: string | null = null;
  if (!claim) problem = "Linkul nu este valid sau a expirat.";
  else if (!r) problem = "Citirea nu mai există.";
  else if (r.value !== claim.value) problem = "Citirea a fost modificată între timp. Verifică emailul cel mai recent.";

  const consum = r && r.prevValue != null ? Math.round((r.value - r.prevValue) * 1000) / 1000 : null;
  const fmt = (n: number) => n.toLocaleString(tag, { maximumFractionDigits: 3 });
  const when = r ? new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Chisinau" }).format(r.readAt) : "";

  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <div className="card w-full max-w-md p-6 shadow-sm">
        <h1 className="text-lg font-bold">{t("Verificarea citirii contorului")}</h1>
        {problem || !r ? (
          <p className="mt-4 rounded-xl bg-st-cancelled/10 px-3 py-3 text-sm text-st-cancelled" role="alert" data-verify-problem="">{t(problem ?? "Citirea nu mai există.")}</p>
        ) : (
          <>
            <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl bg-[var(--color-surface-2)] p-4 text-sm" data-verify-reading="">
              <dt className="text-ink-soft">{t("Contor")}</dt>
              <dd className="font-semibold">{r.contor}</dd>
              <dt className="text-ink-soft">{t("Luna")}</dt>
              <dd className="font-semibold">{r.period}</dd>
              <dt className="text-ink-soft">{t("Index trimis")}</dt>
              <dd className="font-semibold">{fmt(r.value)} m³</dd>
              {consum != null && (
                <>
                  <dt className="text-ink-soft">{t("Consum")}</dt>
                  <dd className="font-semibold">{fmt(consum)} m³</dd>
                </>
              )}
              <dt className="text-ink-soft">{t("Data și ora")}</dt>
              <dd className="font-semibold">{when}</dd>
            </dl>
            <ReadingVerifyForm token={token} initial={r.disputedAt ? "disputed" : r.verifiedAt ? "confirmed" : null} />
          </>
        )}
      </div>
    </main>
  );
}
