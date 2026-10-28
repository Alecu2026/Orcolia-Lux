"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createUser, updateUser } from "@/app/actions/users";
import { ALL_PERMISSION_KEYS, PERMISSIONS_V2, PERMISSION_GROUPS, USER_TYPES, effectivePermissionKeys, userTypeOf } from "@/lib/permissions";
import { NOTIFY_EVENTS } from "@/lib/notify-meta";
import { useMessages, useT } from "@/lib/i18n/context";
import { useToast } from "./toast";
import { IconX } from "./icons";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "STAFF";
  isActive: boolean;
  isSuperAdmin: boolean;
  permissions: string[];
  notifyEvents: string[];
  telegramChatId: string | null;
  notifyScope: string;
  notifyTeamIds: string[];
  notifyMemberIds: string[];
  taskViewScope: string;
  taskViewTeamIds: string[];
  taskViewMemberIds: string[];
};
export type Opt = { id: string; name: string };

const input =
  "h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";
const card = "rounded-xl border border-[var(--color-line)] p-3";
const chip =
  "tap h-7 cursor-pointer rounded-full border border-[var(--color-line)] px-2.5 text-[11px] font-medium hover:border-brand hover:bg-brand-soft";

const ALL_EVENT_KEYS = NOTIFY_EVENTS.map((e) => e.key as string);

/** Orice permisiune dintr-un grup (creare/editare/…) cere „Vizualizare” din același grup: fără ea omul n-ar vedea ecranul pe care are voie să lucreze. */
const VIEW_OF: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const g of PERMISSION_GROUPS) {
    const view = g.items.find((i) => i.key.endsWith(".view"));
    if (!view) continue;
    const prefix = view.key.split(".")[0];
    for (const i of g.items) if (i.key !== view.key && i.key.split(".")[0] === prefix) out[i.key] = view.key;
  }
  return out;
})();

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-2.5 text-sm ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand)]" />
      <span>
        {label}
        {hint && <span className="mt-0.5 block text-[11px] text-ink-soft">{hint}</span>}
      </span>
    </label>
  );
}

function PickList({ items, selected, onToggle, empty }: { items: Opt[]; selected: Set<string>; onToggle: (id: string, on: boolean) => void; empty: string }) {
  if (items.length === 0) return <p className="text-xs text-ink-soft">{empty}</p>;
  return (
    <div className="grid max-h-48 grid-cols-1 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
      {items.map((it) => (
        <Toggle key={it.id} checked={selected.has(it.id)} onChange={(on) => onToggle(it.id, on)} label={it.name} />
      ))}
    </div>
  );
}

const toggleIn = (s: Set<string>, id: string, on: boolean) => {
  const n = new Set(s);
  if (on) n.add(id);
  else n.delete(id);
  return n;
};

export default function UserDialog({
  user,
  allUsers,
  teams,
  viewerId,
  viewerIsSuper,
  viewerIsAdmin,
  onClose,
}: {
  user: UserRow | null;
  allUsers: UserRow[];
  teams: Opt[];
  viewerId: string;
  viewerIsSuper: boolean;
  /** Spectatorul e administrator (rol ADMIN): doar el poate crea/promova administratori. */
  viewerIsAdmin: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const m = useMessages();
  const t = useT();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  // ── Starea întregului formular (controlată: la o eroare nu se pierde nimic din ce ai scris) ──
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [telegram, setTelegram] = useState(user?.telegramChatId ?? "");
  const [role, setRole] = useState<"ADMIN" | "STAFF">(user?.role ?? "STAFF");
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [perms, setPerms] = useState<Set<string>>(() => new Set(effectivePermissionKeys(user?.permissions ?? []).filter((p) => ALL_PERMISSION_KEYS.includes(p as never))));

  // „Toate tipurile”: la administrator = listă goală (inclusiv evenimentele viitoare); la angajat = toate bifate explicit.
  const initialIsAdmin = (user?.role ?? "STAFF") === "ADMIN";
  const [allEvents, setAllEvents] = useState(() => (initialIsAdmin ? (user?.notifyEvents.length ?? 0) === 0 : (user?.notifyEvents.length ?? 0) >= ALL_EVENT_KEYS.length));
  const [events, setEvents] = useState<Set<string>>(() => new Set(user?.notifyEvents ?? []));
  const [notifyScope, setNotifyScope] = useState(user?.notifyScope ?? "ALL");
  const [notifyTeams, setNotifyTeams] = useState<Set<string>>(() => new Set(user?.notifyTeamIds ?? []));
  const [notifyMembers, setNotifyMembers] = useState<Set<string>>(() => new Set(user?.notifyMemberIds ?? []));
  // Ce sarcini vede: ALL = toate; OWN = doar create de el / asignate lui (implicit la conturile NOI); CUSTOM = + echipele / persoanele alese.
  // OWN și CUSTOM fără nimic ales se salvează la fel (RESTRICTED fără liste), deci la editare se recunosc după liste.
  const [viewMode, setViewMode] = useState<"ALL" | "OWN" | "CUSTOM">(() =>
    !user ? "OWN" : user.taskViewScope !== "RESTRICTED" ? "ALL" : (user.taskViewTeamIds?.length ?? 0) + (user.taskViewMemberIds?.length ?? 0) > 0 ? "CUSTOM" : "OWN",
  );
  const [viewTouched, setViewTouched] = useState(false);
  const [viewTeams, setViewTeams] = useState<Set<string>>(() => new Set(user?.taskViewTeamIds ?? []));
  const [viewMembers, setViewMembers] = useState<Set<string>>(() => new Set(user?.taskViewMemberIds ?? []));
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  // Rolul e blocat dacă: te editezi pe tine (nu te poți retrograda), editezi un alt admin fără să fii super, sau nu ești administrator.
  const roleLocked = !!user && (user.id === viewerId || (!viewerIsSuper && user.role === "ADMIN") || user.isSuperAdmin);
  const adminOptionLocked = !viewerIsAdmin && role !== "ADMIN"; // un angajat cu „Gestionare utilizatori” nu poate crea administratori
  const staffOptions = useMemo(() => allUsers.filter((u) => u.id !== user?.id).map((u) => ({ id: u.id, name: u.name })), [allUsers, user?.id]);
  const isAdminRole = role === "ADMIN";
  const hasFullAccess = perms.has("admin");
  const activeType = useMemo(() => userTypeOf("STAFF", [...perms, PERMISSIONS_V2]), [perms]);

  /** Schimbă rolul. La un cont nou, „ce sarcini vede” urmează rolul (administrator = toate, angajat = doar ale lui) cât timp nu a fost ales explicit. */
  function changeRole(r: "ADMIN" | "STAFF") {
    setTouched(true);
    setRole(r);
    if (!user && !viewTouched) setViewMode(r === "ADMIN" ? "ALL" : "OWN");
  }

  const mark = <T,>(set: (v: T) => void) => (v: T) => {
    setTouched(true);
    setError(null);
    set(v);
  };

  // ── Permisiuni ──
  function setPerm(key: string, on: boolean) {
    setTouched(true);
    // „Acces administrativ (tot)” = rolul Administrator: rolul trece singur pe „Administrator (tot)” (dacă are voie cine editează), iar bifa nu mai e necesară
    if (key === "admin" && on && !roleLocked && !adminOptionLocked) {
      changeRole("ADMIN");
      setPerms((prev) => {
        const next = new Set(prev);
        next.delete("admin");
        return next;
      });
      return;
    }
    setPerms((prev) => {
      const next = new Set(prev);
      if (on) {
        next.add(key);
        const v = VIEW_OF[key];
        if (v) next.add(v);
      } else {
        next.delete(key);
        for (const [k, v] of Object.entries(VIEW_OF)) if (v === key) next.delete(k);
      }
      return next;
    });
  }
  function setGroup(keys: string[], on: boolean) {
    setTouched(true);
    setPerms((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (k === "admin") continue; // accesul total nu se acordă „în bloc”
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  }
  const applyPreset = (keys: string[]) => {
    setTouched(true);
    setPerms(new Set(keys));
  };

  // ── Validare locală (aceleași reguli ca pe server) ──
  function validate(): string | null {
    if (name.trim().length < 2) return t("Nume prea scurt.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return t("Email invalid.");
    if (!user && password.length < 8) return t("Parola: minim 8 caractere.");
    if (user && password !== "" && password.length < 8) return t("Parola nouă: minim 8 caractere (sau lasă gol ca să rămână neschimbată).");
    const tg = telegram.trim();
    if (tg && !/^-?\d{5,15}$/.test(tg)) return t("Telegram chat ID invalid: doar cifre (ex. 123456789).");
    if (!isAdminRole && !allEvents && events.size === 0) return null; // permis: doar notificările directe
    return null;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError(null);

    const fd = new FormData();
    if (user) fd.set("id", user.id);
    fd.set("name", name.trim());
    fd.set("email", email.trim());
    if (password) fd.set("password", password);
    fd.set("telegramChatId", telegram.trim());
    fd.set("role", role);
    if (isActive) fd.set("isActive", "on");
    if (!isAdminRole) for (const p of perms) fd.append("permissions", p);
    const evs = allEvents ? (isAdminRole ? [] : ALL_EVENT_KEYS) : [...events];
    for (const k of evs) fd.append("notifyEvents", k);
    if (isAdminRole) {
      fd.set("notifyScope", notifyScope);
      if (notifyScope === "TEAMS") for (const id of notifyTeams) fd.append("notifyTeamIds", id);
      if (notifyScope === "MEMBERS") for (const id of notifyMembers) fd.append("notifyMemberIds", id);
    }
    fd.set("taskViewScope", viewMode === "ALL" ? "ALL" : "RESTRICTED");
    if (viewMode === "CUSTOM") {
      for (const id of viewTeams) fd.append("taskViewTeamIds", id);
      for (const id of viewMembers) fd.append("taskViewMemberIds", id);
    }

    startTransition(async () => {
      try {
        const res = user ? await updateUser(undefined, fd) : await createUser(undefined, fd);
        if (res?.ok) {
          toast.success(user ? t("Utilizator salvat.") : t("Utilizator creat."));
          router.refresh();
          onClose();
        } else {
          setError(res?.error ?? t("Salvarea nu a reușit."));
        }
      } catch (err) {
        console.error("[users] salvarea a eșuat:", err);
        setError(t("Salvarea nu a reușit (eroare de server sau de rețea). Reîncearcă."));
      }
    });
  }

  function requestClose() {
    if (pending) return;
    if (touched && !confirm(t("Renunți la modificările nesalvate?"))) return;
    onClose();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touched, pending]);

  const permCount = perms.size;
  const eventsLabelAdmin = allEvents ? t("Toate tipurile de evenimente") : t("{n} tipuri selectate", { n: events.size });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && requestClose()}
      role="dialog"
      aria-modal="true"
    >
      <form
        onSubmit={submit}
        autoComplete="off"
        className="card flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-b-none rounded-t-2xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] px-5 py-3">
          <h2 className="text-base font-bold">{user ? m.users.editTitle : m.users.newTitle}</h2>
          <button type="button" onClick={requestClose} className="tap grid size-9 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={m.common.close}>
            <IconX className="size-4" />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          {/* 1 · Cont */}
          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-ink-soft">1 · {t("Cont")}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-ink-soft">
                {t("Nume")} *
                <input value={name} onChange={(e) => mark(setName)(e.target.value)} autoComplete="off" required className={`${input} mt-1 font-normal text-ink`} />
              </label>
              <label className="text-xs font-semibold text-ink-soft">
                {t("Email *")}
                <input value={email} onChange={(e) => mark(setEmail)(e.target.value)} type="email" autoComplete="off" required className={`${input} mt-1 font-normal text-ink`} />
              </label>
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-soft">
                {user ? t("Parolă nouă") : `${t("Parolă")} *`}
                <div className="relative mt-1">
                  <input
                    value={password}
                    onChange={(e) => mark(setPassword)(e.target.value)}
                    type={showPw ? "text" : "password"}
                    // „new-password”: fără asta browserul completează parola SALVATĂ în acest câmp și o schimbă fără să știi.
                    autoComplete="new-password"
                    required={!user}
                    placeholder={user ? t("lasă gol = rămâne neschimbată") : t("minim 8 caractere")}
                    className={`${input} pr-20 font-normal text-ink`}
                  />
                  <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium text-ink-soft hover:bg-[var(--color-surface)]">
                    {showPw ? t("Ascunde") : t("Arată")}
                  </button>
                </div>
              </label>
              {user && password === "" && <p className="mt-1 text-[11px] text-ink-soft">{t("Parola actuală nu se modifică.")}</p>}
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-soft">
                {t("Telegram chat ID (opțional)")}
                <input value={telegram} onChange={(e) => mark(setTelegram)(e.target.value)} inputMode="numeric" autoComplete="off" className={`${input} mt-1 font-normal text-ink`} placeholder="123456789" />
              </label>
              <p className="mt-1 text-xs text-ink-soft">{m.users.telegramHint}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-semibold text-ink-soft">{t("Rol")}</p>
                <div className="grid grid-cols-2 gap-1 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] p-1">
                  {(["STAFF", "ADMIN"] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      disabled={roleLocked || (r === "ADMIN" && adminOptionLocked)}
                      onClick={() => changeRole(r)}
                      className={`h-9 cursor-pointer rounded-lg px-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${role === r ? "bg-brand text-white" : "text-ink-soft hover:bg-[var(--color-surface)]"}`}
                    >
                      {r === "STAFF" ? m.users.roleEmployee : m.users.roleAdmin}
                    </button>
                  ))}
                </div>
                {roleLocked && <p className="mt-1 text-[11px] text-ink-soft">{m.users.roleLockedHint}</p>}
                {!roleLocked && adminOptionLocked && <p className="mt-1 text-[11px] text-ink-soft">{t("Doar un administrator poate crea alt administrator.")}</p>}
              </div>
              <div className="flex items-end pb-1.5">
                <Toggle
                  checked={isActive}
                  onChange={(v) => { setTouched(true); setIsActive(v); }}
                  disabled={!!user && user.id === viewerId}
                  label={t("Cont activ")}
                  hint={!isActive ? t("Dezactivat: nu se poate autentifica și sesiunile lui se închid.") : user && user.id === viewerId ? m.users.deactivateSelf : undefined}
                />
              </div>
            </div>
          </section>

          {/* 2 · Permisiuni */}
          <section className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-ink-soft">2 · {m.users.permissionsLabel}</h3>
              {!isAdminRole && <span className="text-[11px] text-ink-soft">{hasFullAccess ? t("Acces total") : t("{n} permisiuni bifate", { n: permCount })}</span>}
            </div>
            {isAdminRole ? (
              <p className={`${card} bg-brand-soft/40 text-sm`}>{t("Administratorii au acces la tot. Permisiunile individuale se aplică doar angajaților.")}</p>
            ) : (
              <>
                <div className={card}>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase text-ink-soft">{t("Tip de utilizator")} <span className="font-normal normal-case">— {t("bifează singur permisiunile; le poți ajusta după")}</span></p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {USER_TYPES.map((ut) => {
                      const on = activeType === ut.key;
                      return (
                        <button
                          key={ut.key}
                          type="button"
                          title={t(ut.description)}
                          aria-pressed={on}
                          className={`${chip} ${on ? "!border-brand !bg-brand !text-white" : ""}`}
                          onClick={() => applyPreset(ut.permissions as string[])}
                        >
                          {t(ut.label)}
                        </button>
                      );
                    })}
                    <button type="button" className={`${chip} ${perms.size === 0 ? "!border-brand !bg-brand-soft" : ""}`} onClick={() => applyPreset([])}>{t("Fără permisiuni")}</button>
                    {!activeType && perms.size > 0 && <span className="text-[11px] text-ink-soft">{t("Personalizat")}</span>}
                  </div>
                  {activeType && <p className="mt-1.5 text-[11px] text-ink-soft">{t(USER_TYPES.find((x) => x.key === activeType)?.description ?? "")}</p>}
                </div>
                {hasFullAccess && (
                  <p className="rounded-lg bg-st-progress/10 px-3 py-2 text-xs text-st-progress">
                    ⚠ {t("„Acces administrativ (tot)” e bifat: angajatul poate face orice, indiferent de celelalte permisiuni.")}
                  </p>
                )}
                <p className="text-[11px] text-ink-soft">{t("Orice permisiune cere și „Vizualizare” din același grup — se bifează automat.")}</p>
                <div className="flex flex-col gap-2.5">
                  {PERMISSION_GROUPS.map((g) => {
                    const keys = g.items.map((i) => i.key as string).filter((k) => k !== "admin");
                    const on = keys.filter((k) => perms.has(k)).length;
                    return (
                      <div key={g.group} className={card}>
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <p className="text-[11px] font-semibold uppercase text-ink-soft">{t(g.group)} <span className="font-normal normal-case">({on}/{keys.length})</span></p>
                          <span className="flex gap-1">
                            <button type="button" className="cursor-pointer text-[11px] font-medium text-brand hover:underline" onClick={() => setGroup(keys, true)}>{t("toate")}</button>
                            <span className="text-[11px] text-ink-soft">·</span>
                            <button type="button" className="cursor-pointer text-[11px] font-medium text-brand hover:underline" onClick={() => setGroup(keys, false)}>{t("niciuna")}</button>
                          </span>
                        </div>
                        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                          {g.items.map((it) => (
                            <Toggle
                              key={it.key}
                              checked={perms.has(it.key)}
                              onChange={(v) => setPerm(it.key, v)}
                              disabled={hasFullAccess && it.key !== "admin"}
                              label={t(it.label)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>

          {/* 3 · Notificări */}
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-ink-soft">3 · {m.users.notificationsLabel}</h3>
            <div className={card}>
              <p className="mb-2 text-[11px] text-ink-soft">
                {isAdminRole
                  ? t("Administratorul primește notificări despre tot ce se întâmplă în aplicație. Poți limita tipurile de evenimente (și sursa, mai jos). Notificările care îl privesc direct vin mereu.")
                  : t("Angajatul primește MEREU, fără nicio bifă, notificările despre sarcinile lui: i s-a dat o sarcină, cineva a comentat sau a schimbat statusul la o sarcină al lui, sarcina lui a întârziat. Bifele de mai jos adaugă notificări despre lucruri în care NU e implicat (ex. orice sarcină sau factură nouă din firmă).")}
              </p>
              <Toggle
                checked={allEvents}
                onChange={(v) => { setTouched(true); setAllEvents(v); }}
                label={isAdminRole ? t("Toate tipurile de evenimente (implicit)") : t("Toate evenimentele")}
                hint={isAdminRole ? t("Include și evenimentele care vor fi adăugate în viitor.") : undefined}
              />
              {!allEvents && (
                <div className="mt-2">
                  <p className="mb-2 rounded-lg bg-brand-soft/40 px-3 py-2 text-[11px] text-ink-soft">
                    {t("Fiecare bifă de mai jos înseamnă: la ORICE sarcină, factură sau proiect din firmă, nu doar la cele ale lui. Ex. „Comentariu nou pe sarcină” = primește comentariile de la toate sarcinile; fără bifă, doar de la sarcinile unde e creator sau asignat.")}
                  </p>
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <button type="button" className={chip} onClick={() => { setTouched(true); setEvents(new Set(ALL_EVENT_KEYS)); }}>{t("Bifează toate")}</button>
                    <button type="button" className={chip} onClick={() => { setTouched(true); setEvents(new Set()); }}>{t("Debifează toate")}</button>
                    <span className="ml-auto text-[11px] text-ink-soft">{eventsLabelAdmin}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {NOTIFY_EVENTS.map((e) => (
                      <Toggle key={e.key} checked={events.has(e.key)} onChange={(v) => { setTouched(true); setEvents((p) => toggleIn(p, e.key, v)); }} label={t(e.label)} />
                    ))}
                  </div>
                  {events.size === 0 && (
                    <p className="mt-2 text-[11px] text-st-progress">
                      {isAdminRole
                        ? t("Niciun tip bifat: administratorul va primi TOATE tipurile (listă goală = toate). Bifează „Toate tipurile” dacă asta vrei.")
                        : t("Nimic bifat: primește doar notificările despre sarcinile lui (asignat, comentarii, întârziere). Nu primește nimic despre sarcinile, facturile sau proiectele altora.")}
                    </p>
                  )}
                </div>
              )}
            </div>

            {isAdminRole && (
              <div className={card}>
                <p className="mb-1 text-xs font-semibold text-ink-soft">{m.users.notifSourceLabel}</p>
                <p className="mb-2 text-[11px] text-ink-soft">{m.users.notifSourceHint}</p>
                <div className="mb-2 flex flex-wrap gap-3">
                  {[
                    { v: "ALL", l: m.users.scopeAll },
                    { v: "TEAMS", l: m.users.scopeTeams },
                    { v: "MEMBERS", l: m.users.scopeMembers },
                  ].map((o) => (
                    <label key={o.v} className="flex cursor-pointer items-center gap-1.5 text-sm">
                      <input type="radio" name="notifyScope" checked={notifyScope === o.v} onChange={() => { setTouched(true); setNotifyScope(o.v); }} className="size-4 accent-[var(--color-brand)]" />
                      {o.l}
                    </label>
                  ))}
                </div>
                {notifyScope === "TEAMS" && <PickList items={teams} selected={notifyTeams} onToggle={(id, on) => { setTouched(true); setNotifyTeams((p) => toggleIn(p, id, on)); }} empty={m.users.noTeams} />}
                {notifyScope === "MEMBERS" && <PickList items={staffOptions} selected={notifyMembers} onToggle={(id, on) => { setTouched(true); setNotifyMembers((p) => toggleIn(p, id, on)); }} empty={m.users.noStaff} />}
                {((notifyScope === "TEAMS" && notifyTeams.size === 0) || (notifyScope === "MEMBERS" && notifyMembers.size === 0)) && (
                  <p className="mt-2 text-[11px] text-st-progress">{t("Nimic ales: nu va primi nicio notificare de administrator. Alege măcar o echipă / persoană sau revino la „Toate”.")}</p>
                )}
              </div>
            )}
          </section>

          {/* 4 · Vizibilitate task-uri */}
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-ink-soft">4 · {m.users.taskViewLabel}</h3>
            <div className={card}>
              <p className="mb-2 text-[11px] text-ink-soft">{m.users.taskViewHint}</p>
              <div className="mb-2 grid gap-1.5 sm:grid-cols-3">
                <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm ${viewMode === "ALL" ? "border-brand bg-brand-soft/40" : "border-[var(--color-line)]"}`}>
                  <input type="radio" name="viewScope" checked={viewMode === "ALL"} onChange={() => { setTouched(true); setViewTouched(true); setViewMode("ALL"); }} className="mt-0.5 size-4 accent-[var(--color-brand)]" />
                  <span>{m.users.taskViewAllLabel}</span>
                </label>
                <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm ${viewMode === "OWN" ? "border-brand bg-brand-soft/40" : "border-[var(--color-line)]"}`}>
                  <input type="radio" name="viewScope" checked={viewMode === "OWN"} onChange={() => { setTouched(true); setViewTouched(true); setViewMode("OWN"); }} className="mt-0.5 size-4 accent-[var(--color-brand)]" />
                  <span>
                    {t("Vede doar ale lui")} <span className="rounded bg-brand/10 px-1 py-px text-[10px] font-semibold text-brand">{t("implicit")}</span>
                    <span className="block text-[11px] text-ink-soft">{t("Doar sarcinile create de el sau asignate lui")}</span>
                  </span>
                </label>
                <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm ${viewMode === "CUSTOM" ? "border-brand bg-brand-soft/40" : "border-[var(--color-line)]"}`}>
                  <input type="radio" name="viewScope" checked={viewMode === "CUSTOM"} onChange={() => { setTouched(true); setViewTouched(true); setViewMode("CUSTOM"); }} className="mt-0.5 size-4 accent-[var(--color-brand)]" />
                  <span>{t("Doar anumite echipe / persoane")}<span className="block text-[11px] text-ink-soft">{t("+ sarcinile lui (create sau asignate lui), mereu vizibile")}</span></span>
                </label>
              </div>
              {viewMode === "CUSTOM" && (
                <div className="flex flex-col gap-3">
                  <div>
                    <p className="mb-1 text-[11px] font-semibold uppercase text-ink-soft">{m.users.taskViewTeamsLabel} ({viewTeams.size})</p>
                    <PickList items={teams} selected={viewTeams} onToggle={(id, on) => { setTouched(true); setViewTeams((p) => toggleIn(p, id, on)); }} empty={m.users.noTeams} />
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] font-semibold uppercase text-ink-soft">{m.users.taskViewMembersLabel} ({viewMembers.size})</p>
                    <PickList items={staffOptions} selected={viewMembers} onToggle={(id, on) => { setTouched(true); setViewMembers((p) => toggleIn(p, id, on)); }} empty={m.users.noStaff} />
                  </div>
                  {viewTeams.size === 0 && viewMembers.size === 0 && (
                    <p className="text-[11px] text-st-progress">{t("Nimic ales: va vedea doar sarcinile create de el sau asignate lui.")}</p>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-2 border-t border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-3">
          {error && <p role="alert" className="rounded-lg bg-st-cancelled/10 px-3 py-2 text-sm text-st-cancelled">{t(error)}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={requestClose} disabled={pending} className="tap h-11 cursor-pointer rounded-xl border border-[var(--color-line)] px-5 text-sm font-medium hover:bg-[var(--color-surface-2)] disabled:opacity-60">
              {m.common.cancel}
            </button>
            <button type="submit" disabled={pending} className="tap h-11 flex-1 cursor-pointer rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
              {pending ? m.common.saving : m.common.save}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
