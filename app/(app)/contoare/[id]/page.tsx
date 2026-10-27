import { cache, Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/dal";
import { can, canViewTask, canViewTaskData } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getMeterDetail } from "@/lib/queries/meters";
import { getPayerInvoices } from "@/lib/queries/payers";
import { getMeterSnap } from "@/lib/services/meter-cache";
import { listMeterReadings } from "@/lib/services/meter-readings";
import { averageConsum, enumLabel, type MeterRow } from "@/lib/meters";
import { currentPeriod, mapsUrl, FAR_METERS } from "@/lib/meter-readings";
import { INVOICE_STATUS, type InvoiceStatusKey } from "@/app/components/invoice-meta";
import InvoiceViewButton from "@/app/components/InvoiceViewButton";
import MeterMonthView, { type InvoiceLite } from "@/app/components/MeterMonthView";
import { Item, Section, Skeleton } from "@/app/components/MeterBits";
import { IconChevronLeft } from "@/app/components/icons";
import { TASK_STATUS_RO } from "@/lib/telegram";
import { getT } from "@/lib/i18n/server-t";
import { getLocaleFromCookie } from "@/lib/i18n/locale-cookie";
import { dateTag } from "@/lib/i18n/t";

export const dynamic = "force-dynamic";

const CARD_BTN = "tap inline-flex h-9 items-center gap-1 rounded-xl border border-[var(--color-line)] px-3 text-sm font-medium hover:bg-brand-soft";

// ── Încărcări partajate între secțiuni: o singură interogare per cerere (cache React), iar fiecare secțiune apare imediat ce are datele ──
const loadSnap = cache(() => getMeterSnap().catch(() => null));
const loadRow = cache(async (id: string): Promise<MeterRow | null> => (await loadSnap())?.rows.find((r) => r.id === id) ?? null);
const loadDetail = cache((id: string) => getMeterDetail(id, { historyLimit: 120 }));
const loadInvoices = cache((clientId: string) => getPayerInvoices(clientId));
const loadField = cache((id: string) => listMeterReadings(id));

async function fmts() {
  const t = await getT();
  const tag = dateTag(await getLocaleFromCookie());
  const num = new Intl.NumberFormat(tag, { maximumFractionDigits: 3 });
  const moneyF = new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return {
    t,
    tag,
    nf: (n: number) => num.format(n),
    money: (n: number, cur = "MDL") => `${moneyF.format(n)} ${cur}`,
    dmy: (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join(".") : null),
  };
}

/**
 * Pagina unui contor. Se deschide INSTANT: scheletul vine imediat (loading.tsx), antetul apare din lista din memorie, iar fiecare secțiune se afișează
 * singură, pe măsură ce își primește datele (Suspense) — nu se așteaptă cea mai lentă interogare. „Date pe lună" se schimbă de la o lună la alta fără
 * să mai ceară nimic serverului. Id-ul din adresă e stabil între sincronizările 1C (vezi lib/queries/meters.ts).
 */
export default async function MeterPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("payers.view");
  const { id: rawId } = await params;
  let id = rawId;
  try {
    id = decodeURIComponent(rawId);
  } catch {}
  const perms = {
    task: can(user, "tasks.create"),
    editInvoices: can(user, "invoices.edit"),
    read: can(user, "meters.read"),
    viewTasks: canViewTaskData(user),
  };

  return (
    <div className="flex w-full flex-col gap-4">
      <BackLink />
      <Suspense fallback={<Skeleton className="h-32" />}>
        <HeaderBlock id={id} canTask={perms.task} />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <MonthBlock id={id} canEditInvoices={perms.editInvoices} canRead={perms.read} />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-72" />}>
        <InfoBlock id={id} />
      </Suspense>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Suspense fallback={<Skeleton className="h-72" />}>
          <HistoryBlock id={id} />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-72" />}>
          <FieldBlock id={id} canRead={perms.read} />
        </Suspense>
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Suspense fallback={<Skeleton className="h-48" />}>
          <InvoicesBlock id={id} canEdit={perms.editInvoices} />
        </Suspense>
        {perms.viewTasks && (
          <Suspense fallback={<Skeleton className="h-48" />}>
            <TasksBlock id={id} user={user} />
          </Suspense>
        )}
      </div>
      <Suspense fallback={<Skeleton className="h-40" />}>
        <RelatedBlock id={id} />
      </Suspense>
    </div>
  );
}

async function BackLink() {
  const { t } = await fmts();
  return (
    <Link href="/contoare" className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
      <IconChevronLeft className="size-4" /> {t("Înapoi la contoare")}
    </Link>
  );
}

async function HeaderBlock({ id, canTask }: { id: string; canTask: boolean }) {
  const { t, dmy } = await fmts();
  const row = await loadRow(id);
  // Fără rând în lista din memorie (ex. contor Axioma neîncărcat încă): ne bazăm pe detaliile din 1C; fără niciuna → „negăsit”.
  const detail = row ? null : await loadDetail(id);
  if (!row && !detail) notFound();
  const contor = row?.contor ?? detail?.meter?.contor ?? "—";
  const removedAt = row?.removedAt ?? detail?.meter?.dataScoatere ?? null;
  const clientId = row?.clientId ?? null;
  const taskHref = clientId
    ? `/tasks?${new URLSearchParams({ create: "task", client: clientId, desc: [`${t("Contor")} ${contor}`, row?.name, row?.account ?? row?.contract, row?.phone].filter(Boolean).join(" · ") }).toString()}`
    : null;
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">
            {t("Contor")} <span className="font-mono">{contor}</span>
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            {row?.name ?? "—"}
            {row?.account ? <> · {t("Cont personal {n}", { n: row.account })}</> : row?.contract ? <> · {t("Contract {n}", { n: row.contract })}</> : null}
            {row?.address ? <> · {row.address}</> : null}
          </p>
        </div>
        {removedAt ? (
          <span className="rounded-full bg-st-cancelled/12 px-2.5 py-1 text-xs font-medium text-st-cancelled">{t("scos la {date}", { date: dmy(removedAt) ?? "" })}</span>
        ) : (
          <span className="rounded-full bg-st-done/12 px-2.5 py-1 text-xs font-medium text-st-done">{t("Activ")}</span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--color-line)] pt-3">
        {clientId && (
          <Link href={`/platitori/${clientId}`} className="tap inline-flex h-9 items-center rounded-xl bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong">
            {t("Pagina plătitorului →")}
          </Link>
        )}
        {taskHref && canTask && (
          <Link href={taskHref} prefetch={false} className={CARD_BTN}>
            + {t("Sarcină")}
          </Link>
        )}
      </div>
    </div>
  );
}

async function MonthBlock({ id, canEditInvoices, canRead }: { id: string; canEditInvoices: boolean; canRead: boolean }) {
  const row = await loadRow(id);
  const clientId = row?.clientId ?? null;
  const [detail, invoices, field] = await Promise.all([loadDetail(id), clientId ? loadInvoices(clientId) : Promise.resolve([]), loadField(id)]);
  if (!row && !detail) return null;
  const lite: InvoiceLite[] = invoices.map((i) => ({
    id: i.id,
    number: i.number,
    status: i.status,
    total: i.grandTotal,
    currency: i.currency,
    issueDate: i.issueDate.toISOString(),
    dueDate: i.dueDate ? i.dueDate.toISOString() : null,
    token: i.publicToken,
    label: i.billingPeriodLabel,
  }));
  return <MeterMonthView meterId={id} months={detail?.months ?? []} field={field} invoices={lite} currentPeriod={currentPeriod()} canEditInvoices={canEditInvoices} canRead={canRead} />;
}

async function InfoBlock({ id }: { id: string }) {
  const { t, nf, money, dmy } = await fmts();
  const [row, detail] = await Promise.all([loadRow(id), loadDetail(id)]);
  if (!row && !detail) return null;
  const m = detail?.meter ?? null;
  const sub = detail?.subscriber ?? null;
  const cons = detail?.consumer ?? null;
  const inv = row?.invoice ?? null;
  const st = inv ? INVOICE_STATUS[inv.status as InvoiceStatusKey] : null;
  const removedAt = row?.removedAt ?? m?.dataScoatere ?? null;
  const hasSub = !!m && !!(m.subAbonat || m.subContract || m.subCont || m.subConsumator || m.subContor);
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-4">
      <div className="flex flex-col gap-4">
        <Section title={t("Contor")}>
          <Item label={t("Nr. contor")} value={<span className="font-mono">{row?.contor ?? m?.contor}</span>} />
          <Item label={t("Status")} value={removedAt ? <span className="text-st-cancelled">{t("Scos")}</span> : <span className="text-st-done">{t("Activ")}</span>} />
          <Item label={t("Instalat")} value={dmy(row?.installedAt ?? m?.dataInstalare)} />
          <Item label={t("Scos la")} value={dmy(removedAt)} />
          <Item label={t("Nr. sigiliu")} value={row?.sigiliu ?? m?.sigiliu} />
          <Item label={t("Consumator")} value={row?.consumator ?? m?.consumator} />
          <Item label={t("IDNO")} value={row?.inn ?? m?.inn} />
          <Item label={t("Perioada în registrul 1C")} value={dmy(m?.perioada)} />
          <Item label={t("Sursa datelor")} value={row?.source === "axioma" ? "Axioma" : "1C"} />
        </Section>
        {hasSub && m && (
          <Section title={t("Sub-abonat / sub-contor (1C)")}>
            <Item label={t("Sub-abonat")} value={m.subAbonat} />
            <Item label={t("Sub-contract")} value={m.subContract} />
            <Item label={t("Sub-cont personal")} value={m.subCont} />
            <Item label={t("Sub-consumator")} value={m.subConsumator} />
            <Item label={t("Sub-contor")} value={m.subContor} />
          </Section>
        )}
      </div>

      <Section title={t("Abonat")}>
        <Item label={t("Nume")} value={row?.name} />
        <Item label={t("Cont personal")} value={row?.account ?? sub?.contPersonal} />
        <Item label={t("Contract")} value={row?.contract ?? sub?.nrContract} />
        <Item label={t("Tip")} value={row ? (row.person ? t("Persoană fizică") : t("Firmă / instituție")) : null} />
        <Item label={t("Sector")} value={enumLabel(row?.sector, t)} />
        <Item label={t("Tip sector (1C)")} value={enumLabel(sub?.tipSector, t)} />
        <Item label={t("Adresă")} value={row?.address} />
        <Item label={t("Telefon")} value={row?.phone ?? sub?.telefon} />
        <Item label={t("Email")} value={row?.email} />
        <Item label={t("Cont portal")} value={row ? (row.activated ? <span className="text-st-done">{t("activat")}</span> : t("neactivat")) : null} />
        <Item label={t("Contoare active")} value={row ? String(row.meterCount) : null} />
      </Section>

      <div className="flex flex-col gap-4">
        <Section title={t("Factura curentă")}>
          {inv ? (
            <>
              <Item label={t("Număr")} value={inv.number} />
              <Item label={t("Status")} value={st ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{t(st.label)}</span> : null} />
              <Item label={t("De achitat")} value={<b>{money(inv.grandTotal, inv.currency)}</b>} />
              <Item label={t("Scadență")} value={dmy(inv.dueDate)} />
            </>
          ) : (
            <p className="px-3 py-2.5 text-sm text-ink-soft">{t("Nicio factură.")}</p>
          )}
        </Section>
        <Section title={t("Document 1C")}>
          <Item label={t("Document 1C")} value={dmy(sub?.dataDoc ?? row?.docDate)} />
          <Item label={t("Calculat (1C)")} value={sub?.calculat != null ? money(sub.calculat) : null} />
          <Item label={t("Datorie / avans (1C)")} value={sub?.datorieAvans != null ? money(sub.datorieAvans) : null} />
          <Item label={t("De achitat (1C)")} value={sub?.deAchitat != null ? <b>{money(sub.deAchitat)}</b> : null} />
        </Section>
      </div>

      {(cons || hasSub) && (
        <Section title={t("Consumator (1C)")}>
          <Item label={t("Nume")} value={cons?.nume} />
          <Item label={t("Zonă presiune apă")} value={cons?.zona} />
          <Item label={t("Sector de deservire")} value={cons?.sector} />
          <Item label={t("Nr. persoane")} value={cons ? String(cons.nrPersoane) : null} />
          <Item label={t("Suprafață")} value={cons ? nf(cons.suprafata) : null} />
          <Item label={t("Început consum")} value={dmy(cons?.inceput)} />
          <Item label={t("Sfârșit consum")} value={dmy(cons?.sfarsit)} />
        </Section>
      )}
    </div>
  );
}

async function HistoryBlock({ id }: { id: string }) {
  const { t, nf, dmy } = await fmts();
  const detail = await loadDetail(id);
  const history = detail?.history ?? [];
  const bars = [...history].reverse().slice(-24);
  const maxConsum = Math.max(1, ...bars.map((h) => h.consum));
  const avg = averageConsum(history);
  return (
    <Section title={`${t("Istoric citiri")} (${history.length})`}>
      {history.length === 0 ? (
        <p className="px-3 py-2.5 text-sm text-ink-soft">{t("Nicio citire în istoric.")}</p>
      ) : (
        <>
          <div className="border-b border-[var(--color-line)] px-3 py-3">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-[11px] text-ink-soft">
              <span>{t("Consum pe citiri (m³)")}</span>
              {avg && <span>{t("Consum mediu lunar")}: <b className="text-ink">{nf(avg.avg)} m³</b> ({t("din ultimele {n} citiri", { n: avg.count })})</span>}
            </div>
            <div className="flex h-28 items-end gap-1" role="img" aria-label={t("Consum pe citiri (m³)")}>
              {bars.map((h, i) => (
                <div key={i} className="flex h-full min-w-[8px] max-w-[56px] flex-1 flex-col justify-end" title={`${dmy(h.currDate ?? h.docDate) ?? "—"} · ${nf(h.consum)} m³`}>
                  <span className="mb-0.5 text-center text-[9px] leading-none text-ink-soft">{nf(h.consum)}</span>
                  <div className="w-full rounded-t bg-brand/70" style={{ height: `${Math.max(3, (h.consum / maxConsum) * 80)}%` }} />
                </div>
              ))}
            </div>
            <div className="mt-1 flex gap-1">
              {bars.map((h, i) => (
                <span key={i} className="min-w-[8px] max-w-[56px] flex-1 truncate text-center text-[9px] text-ink-soft">{(dmy(h.currDate ?? h.docDate) ?? "").slice(3, 5)}</span>
              ))}
            </div>
          </div>
          <div className="max-h-96 overflow-auto">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead className="sticky top-0 bg-[var(--color-surface-2)] text-left text-[11px] text-ink-soft">
                <tr>
                  <th className="px-3 py-1.5 font-semibold">{t("Data citirii")}</th>
                  <th className="px-3 py-1.5 text-right font-semibold">{t("Citire anterioară")}</th>
                  <th className="px-3 py-1.5 text-right font-semibold">{t("Citire curentă")}</th>
                  <th className="px-3 py-1.5 text-right font-semibold">{t("Consum (m³)")}</th>
                  <th className="px-3 py-1.5 font-semibold">{t("Sursa citirii")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {history.map((h, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap px-3 py-1.5">{dmy(h.currDate ?? h.docDate) ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums" title={dmy(h.prevDate) ?? undefined}>{nf(h.prev)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium">{nf(h.curr)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{nf(h.consum)} m³</td>
                    <td className="px-3 py-1.5 text-ink-soft">{enumLabel(h.sursa, t) || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  );
}

async function FieldBlock({ id, canRead }: { id: string; canRead: boolean }) {
  const { t, nf, tag } = await fmts();
  const field = await loadField(id);
  return (
    <Section title={`${t("Citiri din teren")} (${field.length})`}>
      {field.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 text-sm text-ink-soft">
          <span>{t("Nicio citire din teren încă.")}</span>
          {canRead && (
            <Link href={`/contoare/citiri?meter=${encodeURIComponent(id)}`} className="tap inline-flex h-8 items-center rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong">
              {t("Introdu citirea din teren")}
            </Link>
          )}
        </div>
      ) : (
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead className="sticky top-0 bg-[var(--color-surface-2)] text-left text-[11px] text-ink-soft">
              <tr>
                <th className="px-3 py-1.5 font-semibold">{t("Luna")}</th>
                <th className="px-3 py-1.5 text-right font-semibold">{t("Index (m³)")}</th>
                <th className="px-3 py-1.5 text-right font-semibold">{t("Consum (m³)")}</th>
                <th className="px-3 py-1.5 font-semibold">{t("Citit de")}</th>
                <th className="px-3 py-1.5 font-semibold">{t("Locație")}</th>
                <th className="px-3 py-1.5 font-semibold">{t("Poza")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {field.map((f) => (
                <tr key={f.id}>
                  <td className="whitespace-nowrap px-3 py-1.5">{f.period.split("-").reverse().join(".")}</td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums">{nf(f.value)}</td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{f.prevValue != null ? `${nf(f.value - f.prevValue)} m³` : "—"}</td>
                  <td className="px-3 py-1.5 text-ink-soft">
                    {f.userName}
                    <span className="block text-[11px]">{new Date(f.readAt).toLocaleString(tag, { dateStyle: "short", timeStyle: "short" })}</span>
                  </td>
                  <td className="px-3 py-1.5">
                    {f.lat != null && f.lng != null ? (
                      <a href={mapsUrl(f.lat, f.lng)} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                        {t("Harta")}
                      </a>
                    ) : (
                      <span className="text-ink-soft/60">—</span>
                    )}
                    {f.accuracy != null && <span className="text-[11px] text-ink-soft"> ±{f.accuracy} m</span>}
                    {f.distanceM != null && f.distanceM > FAR_METERS && <span className="block text-[11px] text-st-progress">{t("La {n} m de locația citirii anterioare", { n: f.distanceM })}</span>}
                  </td>
                  <td className="px-3 py-1.5">
                    {f.photoUrl ? (
                      <a href={f.photoUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                        {t("Vezi poza")}
                      </a>
                    ) : (
                      <span className="text-ink-soft/60">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

async function InvoicesBlock({ id, canEdit }: { id: string; canEdit: boolean }) {
  const { t, money, dmy } = await fmts();
  const row = await loadRow(id);
  const clientId = row?.clientId ?? null;
  if (!clientId) return null;
  const invoices = (await loadInvoices(clientId)).slice(0, 12);
  return (
    <Section title={`${t("Facturi")} (${invoices.length})`}>
      {invoices.length === 0 ? (
        <p className="px-3 py-2.5 text-sm text-ink-soft">{t("Nicio factură încă.")}</p>
      ) : (
        <ul className="divide-y divide-[var(--color-line)] text-sm">
          {invoices.map((i) => {
            const s = INVOICE_STATUS[i.status as InvoiceStatusKey];
            const label = i.billingPeriodLabel || i.number;
            return (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{label}</span>
                  <span className="block text-[11px] text-ink-soft">
                    {i.number} · {t("emisă")} {dmy(i.issueDate.toISOString()) ?? ""}
                    {i.dueDate && <> · {t("scadentă")} {dmy(i.dueDate.toISOString())}</>}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-right">
                    <span className="block tabular-nums">{money(i.grandTotal, i.currency)}</span>
                    {s && <span className={`inline-block rounded-full px-1.5 text-[10px] font-medium ${s.cls}`}>{t(s.label)}</span>}
                  </span>
                  <InvoiceViewButton token={i.publicToken} title={`${label} · ${i.number}`} />
                  {canEdit && (
                    <Link href={`/invoices/${i.id}/edit`} className="tap h-9 rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium leading-9 hover:bg-[var(--color-surface-2)]">
                      {t("Editează")}
                    </Link>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

async function TasksBlock({ id, user }: { id: string; user: Awaited<ReturnType<typeof requirePermission>> }) {
  const { t, dmy } = await fmts();
  const row = await loadRow(id);
  const clientId = row?.clientId ?? null;
  if (!clientId) return null;
  const all = await prisma.task.findMany({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { id: true, seq: true, type: true, title: true, status: true, createdAt: true, creatorId: true, assigneeId: true, extraAssigneeIds: true, teamId: true, extraTeamIds: true },
  });
  const tasks = all.filter((x) => canViewTask(user, x)).slice(0, 10);
  return (
    <Section title={`${t("Sarcini și cereri")} (${tasks.length})`}>
      {tasks.length === 0 ? (
        <p className="px-3 py-2.5 text-sm text-ink-soft">{t("Nicio sarcină sau cerere pentru acest plătitor.")}</p>
      ) : (
        <ul className="divide-y divide-[var(--color-line)] text-sm">
          {tasks.map((x) => (
            <li key={x.id}>
              <Link href={x.type === "TICKET" ? `/tickets/${x.id}` : `/tasks/${x.id}`} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-brand-soft/40">
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {x.seq ? `#${x.seq} · ` : ""}
                    {x.title}
                  </span>
                  <span className="block text-[11px] text-ink-soft">
                    {x.type === "TICKET" ? t("Cerere") : t("Sarcină")} · {dmy(x.createdAt.toISOString())}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-[var(--color-surface-2)] px-2.5 py-0.5 text-xs font-medium text-ink-soft">{t(TASK_STATUS_RO[x.status] ?? x.status)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

async function RelatedBlock({ id }: { id: string }) {
  const { t, nf, dmy } = await fmts();
  const [snap, row] = await Promise.all([loadSnap(), loadRow(id)]);
  if (!snap || !row) return null;
  const subKey = id.startsWith("a:") ? null : id.slice(0, id.lastIndexOf("~", id.lastIndexOf("~") - 1));
  const siblings = snap.rows.filter((r) => r.id !== id && (row.clientId ? r.clientId === row.clientId : !!subKey && r.id.startsWith(`${subKey}~`)));
  const sibIds = new Set(siblings.map((r) => r.id));
  const sameAddress = row._a ? snap.rows.filter((r) => r._a === row._a && r.id !== id && !sibIds.has(r.id)) : [];
  if (siblings.length === 0 && sameAddress.length === 0) return null;
  return (
    <div className="grid items-start gap-4 xl:grid-cols-2">
      {siblings.length > 0 && (
        <Section title={`${t("Alte contoare ale abonatului")} (${siblings.length})`}>
          <MeterLinks list={siblings} t={t} nf={nf} dmy={dmy} />
        </Section>
      )}
      {sameAddress.length > 0 && (
        <Section title={`${t("Alte contoare la aceeași adresă")} (${sameAddress.length})`}>
          <MeterLinks list={sameAddress} t={t} nf={nf} dmy={dmy} showName />
        </Section>
      )}
    </div>
  );
}

function MeterLinks({
  list,
  t,
  nf,
  dmy,
  showName = false,
}: {
  list: MeterRow[];
  t: (ro: string, v?: Record<string, string | number>) => string;
  nf: (n: number) => string;
  dmy: (d: string | null | undefined) => string | null;
  showName?: boolean;
}) {
  const LIMIT = 40;
  return (
    <ul className="max-h-72 divide-y divide-[var(--color-line)] overflow-y-auto text-[13px]">
      {list.slice(0, LIMIT).map((r) => (
        <li key={r.id}>
          <Link href={`/contoare/${encodeURIComponent(r.id)}`} className="flex items-baseline justify-between gap-3 px-3 py-2 hover:bg-brand-soft/40">
            <span className="min-w-0">
              <span className="block font-mono font-medium">{r.contor}</span>
              <span className="block truncate text-[11px] text-ink-soft">{showName ? r.name : r.consumator || r.address || "—"}</span>
            </span>
            <span className="shrink-0 text-right text-[11px]">
              {r.removedAt ? <span className="text-st-cancelled">{t("scos la {date}", { date: dmy(r.removedAt) ?? "" })}</span> : <span className="text-st-done">{t("activ")}</span>}
              {r.consum != null && <span className="block text-ink-soft">{t("consum")} {nf(r.consum)} m³</span>}
            </span>
          </Link>
        </li>
      ))}
      {list.length > LIMIT && <li className="px-3 py-2 text-[11px] text-ink-soft">{t("… și încă {n}", { n: list.length - LIMIT })}</li>}
    </ul>
  );
}
