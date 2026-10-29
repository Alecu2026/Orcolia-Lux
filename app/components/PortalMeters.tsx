"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { submitPortalReadingAction, uploadPortalPhotoAction } from "@/app/actions/portal-meters";
import { ISSUE_LABELS } from "@/lib/meter-issues";
import { PORTAL_ISSUE_KINDS, type PortalMeterDto } from "@/lib/portal-meters";
import { JUMP_CONFIRM_M3, parseIndex } from "@/lib/meter-readings";
import { optimizeImage } from "@/lib/image-optimize";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";
import { IconChevronDown } from "./icons";

const inp = "h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";
const nf = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",");

/**
 * „Contoarele mele” din cabinetul personal: un dropdown cu contoarele plătitorului; pentru cel ales — ultimul index, citirea lunii (dacă există) și formularul de trimitere:
 * indexul (m³), poza contorului și starea contorului. Plătitorul își poate corecta citirea din portal în aceeași lună; o citire făcută de cititor nu se mai schimbă de aici.
 */
export default function PortalMeters({ meters, period }: { meters: PortalMeterDto[]; period: string }) {
  const t = useT();
  const router = useRouter();
  const tag = dateTag(useLocale());
  const [sel, setSel] = useState(meters[0]?.id ?? "");
  // secțiunea se deschide singură cât timp mai sunt contoare necitite, dar nu se mai închide de la sine după ce trimiți o citire
  const [open, setOpen] = useState(() => meters.some((x) => !x.thisMonth));
  const m = useMemo(() => meters.find((x) => x.id === sel) ?? meters[0], [meters, sel]);

  const [value, setValue] = useState("");
  const [kind, setKind] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "lower" | "high">(null);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // la schimbarea contorului formularul pornește de la zero (cu indexul trimis deja din portal, dacă există)
  useEffect(() => {
    setValue(m?.thisMonth?.source === "PORTAL" ? nf(m.thisMonth.value) : "");
    setKind(""); setNote(""); setPhoto(null); setPreview(null); setConfirm(null); setMsg(null);
    if (fileRef.current) fileRef.current.value = "";
  }, [m?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  if (!m) return null;
  const doneByField = m.thisMonth && m.thisMonth.source === "FIELD";
  const missing = meters.filter((x) => !x.thisMonth).length;
  const fmtDay = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(tag, { timeZone: "Europe/Bucharest" }) : "");
  const periodLabel = new Date(`${period}-15T12:00:00`).toLocaleDateString(tag, { month: "long", year: "numeric" });

  async function submit(confirmed: boolean) {
    const v = parseIndex(value);
    if (v == null) { setMsg({ ok: false, text: t("Index invalid. Scrie un număr (m³), ex. 1234,5.") }); return; }
    setPending(true); setMsg(null);
    try {
      const fd = new FormData();
      fd.set("meterId", m.id);
      fd.set("value", value);
      if (confirmed) fd.set("confirmed", "1");
      fd.set("issueKind", kind);
      fd.set("issueNote", note);
      const res = await submitPortalReadingAction(fd);
      if (!res.ok) {
        if (res.confirm) setConfirm(res.confirm);
        else setMsg({ ok: false, text: t(res.error) });
        return;
      }
      setConfirm(null);
      let text = res.consum != null ? t("Citirea a fost salvată: {value} m³ (consum {consum} m³).", { value: nf(res.value), consum: nf(res.consum) }) : t("Citirea a fost salvată: {value} m³.", { value: nf(res.value) });
      let ok = true;
      if (photo) {
        const pf = new FormData();
        pf.set("readingId", res.readingId);
        pf.set("file", await optimizeImage(photo));
        const up = await uploadPortalPhotoAction(pf);
        if (up.ok) { setPhoto(null); setPreview(null); if (fileRef.current) fileRef.current.value = ""; }
        else { ok = false; text += ` ${t("Poza nu s-a încărcat: {error}", { error: t(up.error) })}`; }
      }
      if (res.issueError) { ok = false; text += ` ${t("Starea contorului nu s-a salvat: {error}", { error: t(res.issueError) })}`; }
      else if (res.issueSaved) text += ` ${t("Starea contorului a fost transmisă.")}`;
      setMsg({ ok, text });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: t("A apărut o eroare. Încearcă din nou.") });
    } finally {
      setPending(false);
    }
  }

  return (
    <details open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} className="card group p-0">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4">
        <span className="text-sm font-semibold">
          {t("Contoarele mele")} <span className="font-normal text-ink-soft">({meters.length})</span>
          {missing > 0 && <span className="ml-2 rounded-full bg-st-progress/12 px-2 py-0.5 text-[11px] font-medium text-st-progress">{t("de citit luna aceasta: {n}", { n: missing })}</span>}
        </span>
        <IconChevronDown className="size-4 text-ink-soft transition-transform group-open:rotate-180" />
      </summary>

      <div className="flex flex-col gap-3 border-t border-[var(--color-line)] p-4">
        <label className="text-xs font-semibold text-ink-soft">
          {t("Alege contorul")}
          <select value={m.id} onChange={(e) => setSel(e.target.value)} className={`${inp} mt-1`}>
            {meters.map((x) => (
              <option key={x.id} value={x.id}>
                {t("Contor")} {x.contor}{x.address ? ` — ${x.address}` : ""}{x.thisMonth ? " ✓" : ""}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)]/50 p-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-[11px] text-ink-soft">{t("Ultimul index cunoscut")}</p>
            <p className="font-semibold tabular-nums">{m.lastIndex != null ? `${nf(m.lastIndex)} m³` : "—"}{m.lastDate && <span className="ml-1 text-xs font-normal text-ink-soft">({fmtDay(m.lastDate)})</span>}</p>
          </div>
          <div>
            <p className="text-[11px] text-ink-soft">{t("Citirea pentru {period}", { period: periodLabel })}</p>
            {m.thisMonth ? (
              <p className="font-semibold tabular-nums">
                {nf(m.thisMonth.value)} m³
                <span className="ml-1 text-xs font-normal text-ink-soft">({fmtDay(m.thisMonth.readAt)} · {m.thisMonth.source === "PORTAL" ? t("trimisă de tine") : t("citită de cititor")})</span>
              </p>
            ) : (
              <p className="font-semibold text-st-progress">{t("încă netrimisă")}</p>
            )}
          </div>
          {m.openIssues.length > 0 && (
            <div className="sm:col-span-2">
              <p className="text-[11px] text-ink-soft">{t("Stare raportată (în verificare)")}</p>
              <p className="text-xs">{m.openIssues.map((i) => t(ISSUE_LABELS[i.kind])).join(" · ")}</p>
            </div>
          )}
          {m.thisMonth?.photoUrl && (
            <a href={m.thisMonth.photoUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand underline sm:col-span-2">{t("Vezi poza trimisă")}</a>
          )}
        </div>

        {doneByField ? (
          <p className="rounded-xl bg-brand-soft/60 p-3 text-sm">{t("Pentru luna aceasta citirea a fost deja înregistrată de cititor. Mulțumim!")}</p>
        ) : (
          <form
            onSubmit={(e) => { e.preventDefault(); void submit(false); }}
            className="flex flex-col gap-3"
          >
            <label className="text-xs font-semibold text-ink-soft">
              {t("Indexul contorului (m³)")}
              <input
                value={value}
                onChange={(e) => { setValue(e.target.value); setConfirm(null); }}
                inputMode="decimal"
                placeholder={m.lastIndex != null ? `≥ ${nf(m.lastIndex)}` : t("ex. 1234,5")}
                className={`${inp} mt-1 text-lg font-semibold tabular-nums`}
                required
              />
            </label>

            <div>
              <p className="mb-1 text-xs font-semibold text-ink-soft">{t("Poza contorului")}</p>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setPhoto(f);
                  setPreview(f ? URL.createObjectURL(f) : null);
                }}
                className="block w-full text-xs file:mr-3 file:h-10 file:cursor-pointer file:rounded-xl file:border-0 file:bg-brand file:px-4 file:text-sm file:font-semibold file:text-white"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {preview && <img src={preview} alt="" className="mt-2 max-h-48 rounded-xl border border-[var(--color-line)] object-contain" />}
              <p className="mt-1 text-[11px] text-ink-soft">{t("Fotografiază cadranul cu indexul, ca să se vadă clar cifrele.")}</p>
            </div>

            <label className="text-xs font-semibold text-ink-soft">
              {t("Starea contorului")}
              <select value={kind} onChange={(e) => setKind(e.target.value)} className={`${inp} mt-1`}>
                <option value="">{t("Normal — fără probleme")}</option>
                {PORTAL_ISSUE_KINDS.map((k) => (
                  <option key={k} value={k}>{t(ISSUE_LABELS[k])}</option>
                ))}
              </select>
            </label>
            {kind && (
              <label className="text-xs font-semibold text-ink-soft">
                {kind === "OTHER" ? t("Descrie problema") : t("Observații (opțional)")}
                <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className="mt-1 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-brand" required={kind === "OTHER"} />
              </label>
            )}

            {confirm && (
              <div className="rounded-xl border border-st-progress/40 bg-st-progress/8 p-3 text-sm">
                <p className="font-semibold">
                  {confirm === "lower"
                    ? t("Indexul e mai mic decât cel anterior ({last} m³).", { last: nf(m.lastIndex ?? 0) })
                    : t("Consumul pare neobișnuit de mare (peste {n} m³).", { n: JUMP_CONFIRM_M3 })}
                </p>
                <p className="mt-0.5 text-xs text-ink-soft">{t("Verifică cifrele. Dacă indexul e corect (ex. contor înlocuit), confirmă.")}</p>
                <button type="button" disabled={pending} onClick={() => void submit(true)} className="tap mt-2 h-10 cursor-pointer rounded-xl bg-st-progress px-4 text-sm font-semibold text-white disabled:opacity-50">
                  {t("Da, indexul e corect")}
                </button>
              </div>
            )}

            {msg && <p className={`rounded-xl px-3 py-2 text-sm ${msg.ok ? "bg-brand-soft/60 text-ink" : "bg-st-cancelled/10 text-st-cancelled"}`}>{msg.text}</p>}

            <button type="submit" disabled={pending || !value.trim()} className="tap h-12 cursor-pointer rounded-xl bg-brand text-base font-semibold text-white hover:bg-brand-strong disabled:opacity-50">
              {pending ? t("Se trimite…") : m.thisMonth ? t("Actualizează citirea") : t("Trimite citirea")}
            </button>
          </form>
        )}

        {m.history.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold text-ink-soft">{t("Citiri anterioare")}</p>
            <div className="divide-y divide-[var(--color-line)] overflow-hidden rounded-xl border border-[var(--color-line)] text-sm">
              {m.history.map((h) => (
                <div key={h.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                  <span className="text-xs text-ink-soft">{new Date(`${h.period}-15T12:00:00`).toLocaleDateString(tag, { month: "long", year: "numeric" })}</span>
                  <span className="text-right tabular-nums">
                    <b>{nf(h.value)} m³</b>
                    {h.consum != null && <span className="ml-2 text-xs text-ink-soft">+{nf(h.consum)}</span>}
                    {h.photoUrl && <a href={h.photoUrl} target="_blank" rel="noreferrer" className="ml-2 text-xs text-brand underline">{t("poză")}</a>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
