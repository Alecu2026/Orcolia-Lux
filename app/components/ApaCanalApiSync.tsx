"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { IconX } from "./icons";
import ApaCanalSyncReport from "./ApaCanalSyncReport";
import type { SyncReport } from "@/lib/services/apa-canal-import";
import { useT } from "@/lib/i18n/context";

type Config = {
  url: string;
  username: string;
  hasPassword: boolean;
  hasToken: boolean;
  lastSyncAt: string | null;
  lastSyncOk: boolean | null;
  lastSyncMessage: string | null;
  lastSuccessAt: string | null;
  autoSync: boolean;
  canEdit: boolean;
};

type Stats = {
  documenteTotale: number;
  sariteFaraAbonent: number;
  clientiNoiDeCreat: number;
  clientiExistentiActualizati: number;
  facturiDeCreat: number;
  facturiSaritePreexistente: number;
  facturiActualizate?: number;
  totalNecuvenit: number;
  totalDePlata: number;
};
type Applied = { clientsCreated: number; clientsUpdated: number; invoicesCreated: number; itemsCreated: number; invoicesUpdated?: number };

const fld =
  "h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand disabled:opacity-60";
const lbl = "mb-1 block text-xs font-semibold text-ink-soft";
const money = (n: number) => `${n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MDL`;

// Parametrul de perioadă al API-ului lor (ex: ?DateOfTheMonth=2026-07-01) — mai simplu cu un
// selector de zi/lună/an decât editat de mână în link de fiecare dată când vor altă lună.
const PERIOD_PARAM = "DateOfTheMonth";
function isAbsoluteUrl(raw: string): boolean {
  try { new URL(raw); return true; } catch { return false; }
}
function getPeriodParam(raw: string): string {
  try { return new URL(raw).searchParams.get(PERIOD_PARAM) ?? ""; } catch { return ""; }
}
function withPeriodParam(raw: string, date: string): string {
  try {
    const u = new URL(raw);
    if (date) u.searchParams.set(PERIOD_PARAM, date);
    else u.searchParams.delete(PERIOD_PARAM);
    return u.toString();
  } catch {
    return raw; // linkul nu e încă o adresă completă — nimic de atașat
  }
}

/**
 * Buton + fereastră pentru sincronizarea plătitorilor dintr-un API: aici se pun linkul și credențialele
 * (login/parolă sau token), se testează conexiunea (fără să scrie nimic) și se extrag datele.
 * Parola nu se citește niciodată înapoi din server — câmpul rămâne gol când există una salvată.
 */
export default function ApaCanalApiSync() {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<null | "save" | "test" | "sync">(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [elapsed, setElapsed] = useState(0);

  async function load() {
    setError(null);
    try {
      const r = await fetch("/api/integrations/apa-canal", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Eroare la încărcare.");
      setCfg(j);
      setUrl(j.url);
      setUsername(j.username);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Eroare la încărcare.");
    }
  }

  useEffect(() => {
    if (open) {
      setReport(null);
      setStats(null);
      setApplied(null);
      setInfo(null);
      setPassword("");
      setToken("");
      load();
    }
  }, [open]);

  const dirty = !!cfg && (url.trim() !== cfg.url || username.trim() !== cfg.username || password !== "" || token !== "");

  // Un cronometru vizibil cât timp durează testarea/extragerea — altfel, din reclamație, nu se vedea
  // dacă aplicația mai lucrează sau s-a blocat ("nu îmi dă mesaj dacă a mers sau nu").
  useEffect(() => {
    if (busy !== "test" && busy !== "sync") { setElapsed(0); return; }
    const t0 = Date.now();
    const iv = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [busy]);

  async function save(): Promise<boolean> {
    setError(null);
    setInfo(null);
    setBusy("save");
    try {
      const r = await fetch("/api/integrations/apa-canal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // câmpurile goale de parolă/token = "păstrează ce e salvat" (nu se trimit deloc)
        body: JSON.stringify({ url, username, ...(password ? { password } : {}), ...(token ? { token } : {}) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Nu s-a putut salva.");
      setCfg(j);
      setPassword("");
      setToken("");
      setInfo("Salvat.");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nu s-a putut salva.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function toggleAuto(next: boolean) {
    setError(null);
    setInfo(null);
    setBusy("save");
    // Optimist: altfel checkbox-ul (controlat de cfg.autoSync) revine vizual la starea veche cât timp
    // cererea e în zbor, pentru că `disabled` devine true în același re-render — pare că apăsarea "nu a prins".
    setCfg((c) => (c ? { ...c, autoSync: next } : c));
    try {
      const r = await fetch("/api/integrations/apa-canal", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoSync: next }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Nu s-a putut schimba.");
      setCfg(j);
      setInfo(next ? "Sincronizare automată pornită — se rulează în fiecare noapte." : "Sincronizare automată oprită.");
    } catch (e) {
      setCfg((c) => (c ? { ...c, autoSync: !next } : c));
      setError(e instanceof Error ? e.message : "Nu s-a putut schimba.");
    } finally {
      setBusy(null);
    }
  }

  async function run(commit: boolean) {
    setError(null);
    setInfo(null);
    setStats(null);
    setApplied(null);
    setReport(null);
    if (cfg?.canEdit && dirty && !(await save())) return;
    if (commit && !confirm(t("Extrag plătitorii din API și îi scriu în aplicație (clienți și facturi noi). Continui?"))) return;
    setBusy(commit ? "sync" : "test");
    // Dacă serverul nu răspunde deloc (conexiune blocată, nu doar lentă), nu așteptăm la nesfârșit —
    // funcția de pe server oricum se oprește la 300 s, deci la fel și aici, ca butonul să nu rămână
    // blocat vizual fără niciun mesaj.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 295_000);
    try {
      const r = await fetch("/api/integrations/apa-canal/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commit }),
        signal: ctrl.signal,
      });
      let j: { error?: string; stats?: Stats; report?: SyncReport; applied?: Applied };
      try {
        j = await r.json();
      } catch {
        throw new Error(`Răspuns neașteptat de la server (HTTP ${r.status}) — probabil a durat prea mult și a fost întrerupt.`);
      }
      if (!r.ok) throw new Error(j.error ?? "Eroare la sincronizare.");
      setStats(j.stats ?? null);
      setReport(j.report ?? null);
      if (commit) {
        setApplied(j.applied ?? null);
        router.refresh();
      }
      await load();
    } catch (e) {
      const isAbort = e instanceof DOMException && e.name === "AbortError";
      setError(isAbort ? "A durat prea mult (peste 5 minute) și s-a întrerupt. Încearcă din nou — dacă se repetă, API-ul lor e prea lent sau indisponibil." : e instanceof Error ? e.message : "Eroare la sincronizare.");
      await load();
    } finally {
      clearTimeout(timer);
      setBusy(null);
    }
  }

  const locked = busy !== null;
  const canEdit = cfg?.canEdit ?? false;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="tap inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--color-line)] px-3 text-sm font-medium text-ink-soft hover:bg-[var(--color-surface-2)]"
      >
        {t("🔌 Sincronizare API")}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={() => !locked && setOpen(false)}>
          <div className="max-h-[92vh] w-full max-w-xl overflow-auto rounded-t-2xl bg-[var(--color-surface)] p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">{t("Sincronizare plătitori din API")}</h2>
                <p className="mt-1 text-xs text-ink-soft">
                  {t("Pune linkul API-ului și credențialele; la apăsare, aplicația extrage plătitorii direct de acolo. API-ul trebuie să întoarcă același JSON ca exportul 1C (Документы, Абоненты, Потребители…). Ce există deja nu se dublează.")}
                </p>
              </div>
              <button type="button" disabled={locked} onClick={() => setOpen(false)} className="tap grid size-9 shrink-0 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40" aria-label={t("Închide")}>
                <IconX className="size-4" />
              </button>
            </div>

            {!cfg && !error && <p className="py-6 text-center text-sm text-ink-soft">{t("Se încarcă…")}</p>}

            {cfg && (
              <div className="flex flex-col gap-3">
                <div>
                  <label className={lbl} htmlFor="api-url">{t("Link API")}</label>
                  <input id="api-url" value={url} onChange={(e) => setUrl(e.target.value)} disabled={!canEdit || locked} placeholder="https://server.exemplu.md/api/platitori" inputMode="url" autoComplete="off" className={fld} />
                </div>
                <div>
                  <label className={lbl} htmlFor="api-period">{t("Perioadă (parametrul „{PERIOD_PARAM}” din link)", { PERIOD_PARAM })}</label>
                  <input
                    id="api-period"
                    type="date"
                    value={getPeriodParam(url)}
                    onChange={(e) => setUrl((u) => withPeriodParam(u, e.target.value))}
                    disabled={!canEdit || locked || !isAbsoluteUrl(url)}
                    className={fld}
                  />
                  <p className="mt-1 text-[11px] text-ink-soft">
                    {isAbsoluteUrl(url)
                      ? "Alegi ziua/luna/anul — se scrie automat în linkul de mai sus."
                      : "Completează întâi linkul (cu https://…), ca să poți alege perioada."}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={lbl} htmlFor="api-user">{t("Login")}</label>
                    <input id="api-user" value={username} onChange={(e) => setUsername(e.target.value)} disabled={!canEdit || locked} autoComplete="off" className={fld} />
                  </div>
                  <div>
                    <label className={lbl} htmlFor="api-pass">{t("Parolă")}</label>
                    <input id="api-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={!canEdit || locked} autoComplete="new-password" placeholder={cfg.hasPassword ? "•••••••• salvată" : ""} className={fld} />
                  </div>
                </div>
                <div>
                  <label className={lbl} htmlFor="api-token">{t("Token (opțional — se folosește doar dacă nu ai login)")}</label>
                  <input id="api-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} disabled={!canEdit || locked} autoComplete="new-password" placeholder={cfg.hasToken ? "•••••••• salvat" : ""} className={fld} />
                </div>
                {/^http:\/\//i.test(url.trim()) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(url.trim()) && (
                  <p className="rounded-lg bg-st-progress/10 px-3 py-2 text-xs text-st-progress">
                    {t("Linkul începe cu http:// — login-ul și parola ar circula necriptat prin internet. Folosește https:// dacă serverul îl permite.")}
                  </p>
                )}
                {!canEdit && <p className="text-xs text-ink-soft">{t("Doar un administrator poate schimba linkul și credențialele. Poți totuși testa și sincroniza.")}</p>}
                <p className="text-[11px] text-ink-soft">{t("Parola se păstrează criptat și nu mai apare niciodată pe ecran.")}</p>

                {cfg.lastSyncAt && (
                  <p className={`rounded-lg px-3 py-2 text-xs ${cfg.lastSyncOk ? "bg-brand-soft text-brand-strong" : "bg-st-cancelled/10 text-st-cancelled"}`}>
                    {t("Ultima încercare: {v1} — {lastSyncMessage}", { v1: new Date(cfg.lastSyncAt).toLocaleString("ro-RO"), lastSyncMessage: cfg.lastSyncMessage ?? "" })}
                  </p>
                )}
                {cfg.lastSuccessAt && <p className="text-[11px] text-ink-soft">{t("Ultima dată când s-au scris date din API: {v1}.", { v1: new Date(cfg.lastSuccessAt).toLocaleString("ro-RO") })}</p>}

                <div className="rounded-xl border border-[var(--color-line)] p-3">
                  <label className="flex items-start gap-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={cfg.autoSync}
                      disabled={!canEdit || locked || dirty || (!cfg.autoSync && cfg.lastSyncOk !== true)}
                      onChange={(e) => toggleAuto(e.target.checked)}
                      className="mt-0.5 size-4 accent-[var(--color-brand)]"
                    />
                    <span>
                      <b>{t("Extrage automat în fiecare noapte")}</b> {t("(în jur de 03:00)")}
                      <span className="mt-0.5 block text-xs text-ink-soft">
                        {cfg.autoSync
                          ? "Pornit: aplicația își aduce singură datele, nu mai trebuie să apeși butonul. Dacă API-ul întoarce același lucru ca data trecută, nu se schimbă nimic."
                          : cfg.lastSyncOk === true
                            ? "Setările au funcționat — poți porni extragerea automată."
                            : "Se poate porni doar după o testare sau o sincronizare reușită cu setările curente."}
                        {!canEdit && " Doar un administrator o poate porni sau opri."}
                      </span>
                    </span>
                  </label>
                </div>

                <div className="flex flex-wrap gap-2">
                  {canEdit && (
                    <button type="button" disabled={locked || !dirty} onClick={save} className="tap h-11 rounded-xl border border-[var(--color-line)] px-4 text-sm font-semibold hover:bg-[var(--color-surface-2)] disabled:opacity-40">
                      {busy === "save" ? "Se salvează…" : "Salvează"}
                    </button>
                  )}
                  <button type="button" disabled={locked || !(cfg.url || url.trim())} onClick={() => run(false)} className="tap h-11 rounded-xl border border-brand px-4 text-sm font-semibold text-brand-strong hover:bg-brand-soft disabled:opacity-40">
                    {busy === "test" ? `Se testează… (${elapsed}s)` : "Testează conexiunea"}
                  </button>
                  <button type="button" disabled={locked || !(cfg.url || url.trim())} onClick={() => run(true)} className="tap h-11 rounded-xl bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-40">
                    {busy === "sync" ? `Se extrage… (${elapsed}s)` : "Extrage din API"}
                  </button>
                </div>
                {locked && (busy === "test" || busy === "sync") && (
                  <p className="text-xs text-ink-soft">
                    {elapsed < 5
                      ? "Se descarcă și se procesează datele — nu închide fereastra."
                      : `Încă lucrează (${elapsed} secunde) — poate dura până la câteva minute la un fișier mare, e normal. Rămâi pe pagină.`}
                  </p>
                )}
              </div>
            )}

            {error && <p className="mt-3 rounded-lg bg-st-cancelled/10 px-3 py-2 text-sm text-st-cancelled">{error}</p>}
            {info && !error && <p className="mt-3 text-sm text-brand-strong">{info}</p>}

            {stats && (
              <div className="mt-3 rounded-xl border border-[var(--color-line)] p-3 text-sm">
                <p className="mb-1 font-semibold">{applied ? "Sincronizare încheiată" : "Conexiune reușită — iată ce s-ar schimba (nu s-a scris nimic)"}</p>
                <ul className="grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
                  <li>{t("Abonați în API:")} <b>{stats.documenteTotale.toLocaleString("ro-RO")}</b></li>
                  <li>{t("Clienți noi:")} <b>{stats.clientiNoiDeCreat.toLocaleString("ro-RO")}</b></li>
                  <li>{t("Clienți actualizați:")} <b>{stats.clientiExistentiActualizati.toLocaleString("ro-RO")}</b></li>
                  <li>{t("Facturi noi:")} <b>{stats.facturiDeCreat.toLocaleString("ro-RO")}</b></li>
                  <li>Facturi deja existente: <b>{stats.facturiSaritePreexistente.toLocaleString("ro-RO")}</b>{stats.facturiActualizate ? <> {t("(din care actualizate:")} <b>{stats.facturiActualizate.toLocaleString("ro-RO")}</b>)</> : null}</li>
                  <li>{t("Fără abonat/document (sărite):")} <b>{stats.sariteFaraAbonent.toLocaleString("ro-RO")}</b></li>
                  <li>{t("Calculat (facturi noi):")} <b>{money(stats.totalNecuvenit)}</b></li>
                  <li>{t("De achitat (facturi noi):")} <b>{money(stats.totalDePlata)}</b></li>
                </ul>
                {applied && (
                  <p className="mt-2 text-xs text-brand-strong">
                    {t("Scrise: {clientsCreated} clienți noi, {clientsUpdated} actualizați, {invoicesCreated} facturi noi ({itemsCreated} linii){v1}.", { clientsCreated: applied.clientsCreated, clientsUpdated: applied.clientsUpdated, invoicesCreated: applied.invoicesCreated, itemsCreated: applied.itemsCreated, v1: applied.invoicesUpdated ? `, ${applied.invoicesUpdated} facturi existente actualizate` : "" })}</p>
                )}
              </div>
            )}
            {report && <ApaCanalSyncReport report={report} committed={!!applied} />}
          </div>
        </div>
      )}
    </>
  );
}
