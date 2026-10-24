"use client";

import { useRef, useState } from "react";
import { zipSync, strToU8 } from "fflate";
import VoicePicker from "./VoicePicker";
import { useToast } from "./toast";
import { IconX } from "./icons";
import { DEFAULT_VOICE, voiceById } from "@/lib/payer-notify";
import { wavToTelephony } from "@/lib/wav";
import { markNotifyCallsExportedAction } from "@/app/actions/notify-calls";
import { useT } from "@/lib/i18n/context";

export type ExportRow = { id: string; phone: string; clientName: string; text: string };

type Download = { name: string; url: string; size: number; note: string };

// Un singur fișier/arhivă are limita de 10 MB la încărcarea în PBX → arhive de maxim ~9 MB.
const PART_LIMIT = 9_000_000;
const MAX_TEXT = 500;

const digits = (p: string) => p.replace(/\D/g, "");
const kb = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.round(n / 1000)} KB`);

/**
 * Export pentru „Автоинформирование" din PBX Moldcell. PBX-ul nu are API, deci pregătim fișierele de încărcat:
 *  - numere.csv — lista de numere (una pe linie);
 *  - arhive ZIP, fiecare cu câte un audio per plătitor (cu numele și suma lui, vocea aleasă, generat chiar în browser) și
 *    mapare.csv cu liniile „număr;fișier" (formatul cerut de PBX pentru „audio diferit pentru fiecare client").
 * Generarea durează câteva secunde pe plătitor și cere fila deschisă.
 */
export default function AutoinformDialog({ rows, onClose, onExported }: { rows: ExportRow[]; onClose: () => void; onExported: (ids: string[]) => void }) {
  const t = useT();
  const toast = useToast();
  const [voice, setVoice] = useState<string>(DEFAULT_VOICE);
  const [phase, setPhase] = useState<"idle" | "working" | "done">("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0, label: "" });
  const [downloads, setDownloads] = useState<Download[]>([]);
  const [exportedIds, setExportedIds] = useState<string[]>([]);
  const [failures, setFailures] = useState<string[]>([]);
  const [marking, setMarking] = useState(false);
  const stopRef = useRef(false);

  const okRows = rows.filter((r) => digits(r.phone).length >= 9);
  const sample = okRows[0]?.text ?? "";

  async function run() {
    stopRef.current = false;
    setPhase("working");
    setDownloads([]);
    setFailures([]);
    setExportedIds([]);
    const total = okRows.length;
    setProgress({ done: 0, total, label: "Se încarcă vocea…" });
    const bad: string[] = [];
    try {
      const tts = await import("@diffusionstudio/vits-web");
      const id = voiceById(voice).id as Parameters<typeof tts.predict>[0]["voiceId"];
      if (!(await tts.stored()).includes(id)) {
        await tts.download(id, (p) => { if (p.total > 1_000_000) setProgress((s) => ({ ...s, label: t("Se descarcă vocea… {n}%", { n: Math.round((p.loaded * 100) / p.total) }) })); });
      }

      // parts: listă de arhive; fiecare = { files, rows, bytes }
      type Part = { files: Record<string, Uint8Array>; lines: string[]; bytes: number; ids: string[] };
      const parts: Part[] = [{ files: {}, lines: [], bytes: 0, ids: [] }];
      const allNumbers: string[] = [];
      const used = new Set<string>();

      for (let i = 0; i < okRows.length; i++) {
        if (stopRef.current) break;
        const r = okRows[i];
        setProgress({ done: i, total, label: t("Se generează audio: {name}", { name: r.clientName }) });
        const num = digits(r.phone);
        try {
          const wav = await wavToTelephony(await tts.predict({ text: r.text.slice(0, MAX_TEXT * 4), voiceId: id }));
          let name = `${num}.wav`;
          for (let k = 2; used.has(name); k++) name = `${num}_${k}.wav`;
          used.add(name);
          let part = parts[parts.length - 1];
          if (part.bytes > 0 && part.bytes + wav.length > PART_LIMIT) {
            part = { files: {}, lines: [], bytes: 0, ids: [] };
            parts.push(part);
          }
          part.files[name] = wav;
          part.lines.push(`${num};${name}`);
          part.bytes += wav.length;
          part.ids.push(r.id);
          allNumbers.push(num);
        } catch (e) {
          console.error("[autoinformare] audio:", e);
          bad.push(r.clientName);
        }
        // lasă browserul să respire (interfața rămâne fluidă)
        await new Promise((res) => setTimeout(res, 0));
      }

      const out: Download[] = [];
      if (allNumbers.length > 0) {
        const csv = strToU8(allNumbers.join("\r\n") + "\r\n");
        out.push({ name: "numere.csv", url: URL.createObjectURL(new Blob([csv as BlobPart], { type: "text/csv" })), size: csv.length, note: `${allNumbers.length} numere` });
      }
      const idsDone: string[] = [];
      parts.filter((p) => p.ids.length > 0).forEach((p, i, all) => {
        const files: Record<string, Uint8Array> = { ...p.files, "mapare.csv": strToU8(p.lines.join("\r\n") + "\r\n") };
        const zip = zipSync(files, { level: 6 });
        const name = all.length > 1 ? `autoinformare-${i + 1}-din-${all.length}.zip` : "autoinformare.zip";
        out.push({ name, url: URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" })), size: zip.length, note: `${p.ids.length} audio + mapare.csv` });
        idsDone.push(...p.ids);
      });
      setDownloads(out);
      setExportedIds(idsDone);
      setFailures(bad);
      setProgress({ done: idsDone.length, total, label: stopRef.current ? "Oprit" : "Gata" });
      setPhase("done");
    } catch (e) {
      console.error("[autoinformare] export:", e);
      toast.error(t("Nu am putut genera audio (verifică conexiunea la internet — vocea se descarcă o dată)."));
      setPhase("idle");
    }
  }

  async function markExported() {
    setMarking(true);
    const res = await markNotifyCallsExportedAction(exportedIds).catch(() => null);
    setMarking(false);
    if (res?.ok) {
      onExported(exportedIds);
      toast.success(t("{n} plătitori marcați „exportați în PBX”.", { n: res.count }));
      onClose();
    } else {
      toast.error(res && !res.ok ? res.error : "Nu am putut marca rândurile.");
    }
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const working = phase === "working";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && !working && onClose()}>
      <div className="card max-h-[94dvh] w-full max-w-xl overflow-auto rounded-b-none rounded-t-2xl p-4 sm:rounded-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">{t("Export pentru autoinformare (PBX Moldcell)")}</h2>
            <p className="text-xs text-ink-soft">{t("{length} plătitori în coadă{v1}", { length: okRows.length, v1: rows.length !== okRows.length ? ` · ${rows.length - okRows.length} fără număr valid, omiși` : "" })}</p>
          </div>
          <button onClick={onClose} disabled={working} className="tap grid size-8 cursor-pointer place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40" aria-label={t("Închide")}><IconX className="size-4" /></button>
        </div>

        {phase === "idle" && (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-[var(--color-line)] p-2.5 text-[13px]">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{t("Exemplu de mesaj (primul din coadă)")}</p>
              <p className="whitespace-pre-wrap">{sample || "—"}</p>
            </div>
            <VoicePicker voice={voice} text={sample} onChange={setVoice} />
            <p className="text-xs text-ink-soft">
              {t("Generez câte un fișier audio pentru fiecare plătitor (vocea aleasă, calitate de telefonie), plus lista de numere și fișierul de mapare. Durează câteva secunde pe plătitor — ține fila deschisă. Prima dată se descarcă vocea (~60 MB).")}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="tap h-10 cursor-pointer rounded-xl border border-[var(--color-line)] px-4 text-sm text-ink-soft hover:bg-[var(--color-surface-2)]">{t("Anulează")}</button>
              <button type="button" disabled={okRows.length === 0} onClick={() => void run()} className="tap h-10 cursor-pointer rounded-xl bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-strong disabled:cursor-default disabled:opacity-40">
                {t("Generează ({length})", { length: okRows.length })}</button>
            </div>
          </div>
        )}

        {working && (
          <div className="flex flex-col gap-3">
            <div>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="min-w-0 truncate font-semibold">{t(progress.label)}</span>
                <span className="tabular-nums text-ink-soft">{progress.done} / {progress.total}</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]"><div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} /></div>
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={() => { stopRef.current = true; }} className="tap h-9 cursor-pointer rounded-xl border border-[var(--color-line)] px-4 text-sm hover:bg-[var(--color-surface-2)]">{t("■ Oprește și folosește ce e gata")}</button>
            </div>
          </div>
        )}

        {phase === "done" && (
          <div className="flex flex-col gap-3">
            {downloads.length === 0 ? (
              <p className="rounded-lg bg-st-cancelled/10 px-3 py-2 text-sm text-st-cancelled">{t("Nu s-a generat niciun fișier.")}</p>
            ) : (
              <>
                <p className="text-sm font-semibold">{t("{length} audio generate. Descarcă fișierele:", { length: exportedIds.length })}</p>
                <ul className="flex flex-col gap-1.5">
                  {downloads.map((d) => (
                    <li key={d.name} className="flex items-center gap-2 rounded-lg border border-[var(--color-line)] px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate"><b>{d.name}</b> <span className="text-xs text-ink-soft">· {d.note} · {kb(d.size)}</span></span>
                      <a href={d.url} download={d.name} className="tap inline-flex h-8 cursor-pointer items-center rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong">{t("⬇ Descarcă")}</a>
                    </li>
                  ))}
                </ul>
                <ol className="list-decimal space-y-0.5 pl-5 text-xs text-ink-soft">
                  <li>{t("În PBX: Setări → Autoinformare → pornești funcția și alegi numerele de pe care se sună.")}</li>
                  <li>{t("Sarcini → „Adaugă sarcină” → încarci")} <b>numere.csv</b> {t("(lista de numere).")}</li>
                  <li>{t("La mesaj alegi „audio diferit pentru fiecare client” și încarci arhiva ZIP (una pe sarcină, dacă sunt mai multe).")}</li>
                  <li>{t("Setezi programul, încercările și durata minimă de ascultare, apoi salvezi.")}</li>
                </ol>
              </>
            )}
            {failures.length > 0 && <p className="rounded-lg bg-st-progress/10 px-3 py-2 text-xs text-st-progress">{t("Nu s-a putut genera audio pentru: {v1}{v2}. Rămân în coadă.", { v1: failures.slice(0, 8).join(", "), v2: failures.length > 8 ? ` și încă ${failures.length - 8}` : "" })}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={onClose} className="tap h-10 cursor-pointer rounded-xl border border-[var(--color-line)] px-4 text-sm text-ink-soft hover:bg-[var(--color-surface-2)]">{t("Închide")}</button>
              {exportedIds.length > 0 && (
                <button type="button" disabled={marking} onClick={() => void markExported()} className="tap h-10 cursor-pointer rounded-xl bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50" title={t("Scoate rândurile din coadă, ca să nu fie exportate a doua oară")}>
                  {marking ? "…" : t("Am descărcat — marchează {n} ca exportați", { n: exportedIds.length })}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
