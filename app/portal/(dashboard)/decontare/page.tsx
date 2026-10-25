import { requireClient } from "@/lib/client-dal";
import { getPayerStatement } from "@/lib/services/payer-statement";
import PayerStatementView from "@/app/components/PayerStatementView";
import { getT } from "@/lib/i18n/server-t";

export const dynamic = "force-dynamic";

/** Decontarea clientului: un rând per lună facturată + TOTAL (aceleași cifre ca fișa din administrare, fără facturile ciornă). */
export default async function PortalStatementPage() {
  const t = await getT();
  const client = await requireClient();
  const statement = await getPayerStatement(client.id, { forPortal: true });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold">{t("Decontare")}</h1>
        <p className="mt-0.5 text-xs text-ink-soft">{t("Situația facturilor tale, lună cu lună.")}</p>
      </div>

      {statement && (
        <>
          <div className="card grid grid-cols-2 gap-x-4 gap-y-1 p-4 text-sm">
            <div>
              <p className="text-xs text-ink-soft">{t("Cont personal")}</p>
              <p className="font-medium">{statement.client.meterSeries ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-ink-soft">{t("Adresă")}</p>
              <p className="font-medium">{statement.client.consumAddress ?? "—"}</p>
            </div>
          </div>
          <PayerStatementView statement={statement} portal />
        </>
      )}
    </div>
  );
}
