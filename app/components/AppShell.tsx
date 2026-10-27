"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/actions/auth";
import { ToastProvider } from "./toast";
import CreateMenu from "./CreateMenu";
import VoiceTaskButton from "./VoiceTaskButton";
import LanguageSwitcher from "./LanguageSwitcher";
import IncomingCallPopup from "./IncomingCallPopup";
import { I18nProvider, useMessages, useT } from "@/lib/i18n/context";
import type { Messages, Locale } from "@/lib/i18n";

/**
 * Navigare „optimistă": la click, elementul apăsat devine activ și titlul se schimbă pe loc (nu după ce vine răspunsul serverului), iar sus apare
 * o bară de progres. `from` = ruta de pe care s-a plecat; când ruta se schimbă, starea devine nevalidă singură (fără efecte).
 */
type Pending = { href: string; from: string } | null;
const NavPending = createContext<{ pending: Pending; go: (href: string, from: string) => void }>({ pending: null, go: () => {} });

/** Link de meniu: prefetch ușor în fundal (până la scheletul paginii) și prefetch COMPLET la intenție (mouse deasupra / atingere), ca la click conținutul să fie deja adus. */
function NavLink({ href, className, children, onClick }: { href: string; className: string; children: ReactNode; onClick?: () => void }) {
  const [intent, setIntent] = useState(false);
  const path = usePathname();
  const { go } = useContext(NavPending);
  return (
    <Link
      href={href}
      prefetch={intent ? true : null}
      onMouseEnter={() => setIntent(true)}
      onTouchStart={() => setIntent(true)}
      onFocus={() => setIntent(true)}
      onClick={() => {
        countHit(href);
        go(href, path);
        onClick?.();
      }}
      className={className}
    >
      {children}
    </Link>
  );
}

type NavItem = { href: string; labelKey: keyof Messages["nav"]; icon: ReactNode; perm?: string };

const NAV: NavItem[] = [
  { href: "/dashboard",        labelKey: "dashboard",  icon: gridIcon(),      perm: "dashboard.view" },
  { href: "/tasks",            labelKey: "tasks",       icon: checklistIcon(), perm: "tasks.view" },
  { href: "/tickets",          labelKey: "tickets",     icon: ticketIcon(),    perm: "tickets.view" },
  { href: "/appointments",     labelKey: "appointments", icon: apptIcon(),      perm: "appointments.view" },
  { href: "/projects",         labelKey: "projects",    icon: folderIcon(),    perm: "projects.view" },
  { href: "/kanban",           labelKey: "kanban",      icon: kanbanIcon(),    perm: "kanban.view" },
  { href: "/calendar",         labelKey: "calendar",    icon: calIcon(),       perm: "calendar.view" },
  { href: "/clients",          labelKey: "clients",     icon: usersIcon(),     perm: "clients.view" },
  { href: "/platitori",        labelKey: "payers",      icon: invoiceIcon(),   perm: "payers.view" },
  { href: "/notificari-platitori", labelKey: "payerNotify", icon: bellIcon(),  perm: "payers.view" },
  { href: "/contoare",         labelKey: "meters",     icon: meterIcon(),     perm: "payers.view" },
  { href: "/pbx",              labelKey: "pbx",         icon: phoneIcon(),     perm: "pbx.view" },
  { href: "/invoices",         labelKey: "invoices",    icon: invoiceIcon(),   perm: "invoices.view" },
  { href: "/users",            labelKey: "users",       icon: userIcon(),      perm: "users.manage" },
  { href: "/team",             labelKey: "team",        icon: usersIcon(),     perm: "teams.view" },
  { href: "/harta",            labelKey: "map",         icon: mapIcon(),       perm: "map.view" },
  { href: "/admin/audit-logs", labelKey: "auditLogs",   icon: shieldIcon(),    perm: "audit.view" },
  { href: "/telegram",         labelKey: "telegram",    icon: sendIcon() },
  { href: "/settings",         labelKey: "settings",    icon: gearIcon() },
];

/**
 * Încălzire: după ce pagina curentă s-a liniștit, aducem în avans (pe rând, cu pauză) paginile principale din meniu — conținutul lor complet, nu doar scheletul.
 * Valabil 60 s în browser (vezi staleTimes); la click pe una din ele pagina apare instant. Nu rulează pe date mobile economisite / conexiuni lente.
 */
const HITS_KEY = "nav-hits";
function readHits(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(HITS_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}
function countHit(href: string) {
  try {
    const h = readHits();
    h[href] = (h[href] ?? 0) + 1;
    localStorage.setItem(HITS_KEY, JSON.stringify(h));
  } catch {}
}

function NavWarmup({ hrefs }: { hrefs: string[] }) {
  const path = usePathname();
  const key = hrefs.join(",");
  const [count, setCount] = useState(0);
  const [list, setList] = useState<string[]>([]);
  useEffect(() => {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (conn?.saveData || (conn?.effectiveType && /^(slow-2g|2g|3g)$/.test(conn.effectiveType))) return;
    // Paginile folosite cel mai des (numărate din meniu, pe acest dispozitiv) primele; la egalitate, ordinea din meniu.
    const hits = readHits();
    const ranked = key
      .split(",")
      .filter((h) => h && h !== path && !path.startsWith(`${h}/`))
      .map((h, idx) => ({ h, idx }))
      .sort((x, y) => (hits[y.h] ?? 0) - (hits[x.h] ?? 0) || x.idx - y.idx)
      .slice(0, 6)
      .map((x) => x.h);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setList(ranked);
    setCount(0);
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      if (document.visibilityState === "visible") setCount(++i);
      if (i < ranked.length) timer = setTimeout(next, 600);
    };
    timer = setTimeout(next, 2500);
    return () => clearTimeout(timer);
  }, [key, path]);
  // Link-uri invizibile cu prefetch complet: Next aduce conținutul paginii când link-ul „apare" pe ecran (1 px, transparent, fără interacțiune).
  return (
    <>
      {list.slice(0, count).map((h) => (
        <Link key={h} href={h} prefetch aria-hidden tabIndex={-1} style={{ position: "fixed", left: 0, top: 0, width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />
      ))}
    </>
  );
}

function visibleNav(items: NavItem[], perms?: Record<string, boolean>): NavItem[] {
  return items.filter((n) => !n.perm || perms?.[n.perm] !== false);
}

function NavList({
  onNavigate,
  perms,
  items = NAV,
  appointmentsLabel,
}: {
  onNavigate?: () => void;
  perms?: Record<string, boolean>;
  items?: NavItem[];
  appointmentsLabel?: string;
}) {
  const realPath = usePathname();
  const { pending } = useContext(NavPending);
  const path = pending && pending.from === realPath ? pending.href : realPath;
  const m = useMessages();
  return (
    <nav className="flex flex-col gap-1">
      {visibleNav(items, perms).map((item) => {
        const active = path === item.href || path.startsWith(`${item.href}/`);
        const label = m.nav[item.labelKey];
        return (
          <NavLink
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`tap flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium ${
              active
                ? "bg-brand text-white"
                : "text-ink-soft hover:bg-[var(--color-surface-2)] hover:text-ink"
            }`}
          >
            <span className="grid size-5 place-items-center">{item.icon}</span>
            {label}
          </NavLink>
        );
      })}
    </nav>
  );
}

function ThemeToggle() {
  const m = useMessages();
  return (
    <button
      type="button"
      onClick={() => {
        const el = document.documentElement;
        const dark = el.classList.toggle("dark");
        localStorage.setItem("theme", dark ? "dark" : "light");
      }}
      className="tap grid size-11 place-items-center rounded-xl bg-[var(--color-surface-2)] text-ink hover:bg-brand-soft"
      title={m.theme.toggle}
      aria-label={m.theme.toggle}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
      </svg>
    </button>
  );
}

export default function AppShell({
  userName,
  demo = false,
  perms,
  unread = 0,
  appointmentsLabel,
  messages,
  locale,
  children,
}: {
  userName: string;
  demo?: boolean;
  perms?: Record<string, boolean>;
  unread?: number;
  appointmentsLabel?: string;
  messages: Messages;
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <I18nProvider messages={messages} locale={locale}>
      <AppShellInner
        userName={userName}
        demo={demo}
        perms={perms}
        unread={unread}
        appointmentsLabel={appointmentsLabel}
      >
        {children}
      </AppShellInner>
    </I18nProvider>
  );
}

function AppShellInner({
  userName,
  demo = false,
  perms,
  unread = 0,
  appointmentsLabel,
  children,
}: {
  userName: string;
  demo?: boolean;
  perms?: Record<string, boolean>;
  unread?: number;
  appointmentsLabel?: string;
  children: ReactNode;
}) {
  const [drawer, setDrawer] = useState(false);
  const realPath = usePathname();
  const [pending, setPending] = useState<Pending>(null);
  // Navigarea s-a terminat (ruta reală s-a schimbat): „pending” nu mai are rost. Fără asta rămânea setat și, când ajungeai din nou pe pagina
  // de plecare pe alt drum (un link din tabel, „înapoi”), antetul și meniul arătau vechea destinație (ex. „PBX”) peste conținutul altei pagini.
  const [lastPath, setLastPath] = useState(realPath);
  if (realPath !== lastPath) {
    setLastPath(realPath);
    setPending(null);
  }
  const path = pending && pending.from === realPath ? pending.href : realPath;
  const m = useMessages();

  // La navigare (mai ales din meniul mobil), poziția de scroll a paginii anterioare rămâne —
  // dacă erai scrollat jos pe o pagină lungă, ajungi pe pagina nouă tot scrollat jos, ceea ce
  // pare "blocat" (nu mai poți da scroll) dacă pagina nouă are mai puțin conținut sau se
  // încarcă progresiv. Resetăm explicit la fiecare schimbare de rută.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [realPath]);
  const current = NAV.find((n) => path.startsWith(n.href))
    ? m.nav[NAV.find((n) => path.startsWith(n.href))!.labelKey]
    : m.nav.dashboard;

  return (
    <ToastProvider>
      <NavPending.Provider value={{ pending, go: (href, from) => (href === from ? setPending(null) : setPending({ href, from })) }}>
      {pending && pending.from === realPath && <div className="nav-progress" aria-hidden />}
      <NavWarmup hrefs={visibleNav(NAV, perms).map((n) => n.href)} />
      <div className="lg:grid lg:grid-cols-[260px_1fr]">
        {/* Sidebar desktop */}
        <aside className="sticky top-0 hidden h-dvh flex-col border-r border-[var(--color-line)] bg-[var(--color-surface)] p-4 lg:flex">
          <Brand label={appointmentsLabel} />
          <div className="mt-6 flex-1">
            <NavList perms={perms} items={NAV} appointmentsLabel={appointmentsLabel} />
          </div>
          <Account userName={userName} />
        </aside>

        {/* Drawer mobil */}
        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
            <aside className="absolute left-0 top-0 flex h-full w-72 flex-col overflow-y-auto bg-[var(--color-surface)] p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
              <Brand label={appointmentsLabel} />
              <div className="mt-6 flex-1">
                <NavList onNavigate={() => setDrawer(false)} perms={perms} items={NAV} appointmentsLabel={appointmentsLabel} />
              </div>
              <Account userName={userName} />
            </aside>
          </div>
        )}

        <div className="flex min-h-dvh min-w-0 flex-col">
          {/* Header */}
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-app)]/80 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
            <button
              onClick={() => setDrawer(true)}
              className="tap grid size-10 place-items-center rounded-xl bg-[var(--color-surface-2)] lg:hidden"
              aria-label={m.menu}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <h1 className="text-lg font-bold lg:text-xl">{current}</h1>
            <div className="ml-auto flex items-center gap-2">
              <LanguageSwitcher />
              {(perms?.["tasks.create"] !== false || perms?.["projects.create"] !== false || perms?.["clients.create"] !== false) && <VoiceTaskButton />}
              <Link
                href="/notificari"
                className="tap relative grid size-11 place-items-center rounded-xl bg-[var(--color-surface-2)] text-ink hover:bg-brand-soft"
                aria-label={m.notifications.title}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                </svg>
                {unread > 0 && (
                  <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-st-cancelled px-1 text-[10px] font-bold text-white">
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </Link>
              <ThemeToggle />
            </div>
          </header>

          {demo && (
            <div className="border-b border-amber-300/40 bg-amber-100 px-4 py-2 text-center text-xs font-medium text-amber-900 dark:bg-amber-500/15 dark:text-amber-300">
              {m.demo}
            </div>
          )}
          <main className="flex-1 px-4 pb-[calc(9.5rem+env(safe-area-inset-bottom))] pt-5 lg:px-8 lg:pb-10">{children}</main>
        </div>
      </div>

      <CreateMenu perms={perms} />

      {/* Popup „Apel primit" (PBX) — doar pentru cine poate vedea clienții */}
      {perms?.["pbx.view"] !== false && <IncomingCallPopup canEdit={perms?.["pbx.manage"] !== false} canTask={perms?.["tasks.create"] !== false} canClient={perms?.["clients.create"] !== false} />}

      {/* Bottom nav mobil */}
      <BottomNav perms={perms} appointmentsLabel={appointmentsLabel} />
      </NavPending.Provider>
    </ToastProvider>
  );
}

function BottomNav({ perms, appointmentsLabel }: { perms?: Record<string, boolean>; appointmentsLabel?: string }) {
  const realPath = usePathname();
  const { pending } = useContext(NavPending);
  const path = pending && pending.from === realPath ? pending.href : realPath;
  const m = useMessages();
  const items = visibleNav(NAV, perms).slice(0, 5);
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 flex items-stretch border-t border-[var(--color-line)] bg-[var(--color-surface)] pb-[env(safe-area-inset-bottom)] lg:hidden">
      {items.map((item) => {
        const active = path.startsWith(item.href);
        const label = m.nav[item.labelKey];
        return (
          <NavLink
            key={item.href}
            href={item.href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] ${
              active ? "text-brand" : "text-ink-soft"
            }`}
          >
            <span className="grid size-5 place-items-center">{item.icon}</span>
            {label}
          </NavLink>
        );
      })}
    </nav>
  );
}

function Brand({ label = "Programări" }: { label?: string }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2.5 px-1">
      <div className="grid size-9 place-items-center rounded-xl bg-brand text-white">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
          <path d="M3 9h18M8 2.5v4M16 2.5v4" />
        </svg>
      </div>
      <span className="text-base font-bold">{t(label)}</span>
    </div>
  );
}

function Account({ userName }: { userName: string }) {
  const m = useMessages();
  return (
    <div className="mt-3 border-t border-[var(--color-line)] pt-3">
      <div className="mb-2 flex items-center gap-2 px-1">
        <div className="grid size-8 place-items-center rounded-full bg-brand-soft text-xs font-bold text-brand-strong">
          {userName.slice(0, 1).toUpperCase()}
        </div>
        <span className="truncate text-sm font-medium">{userName}</span>
      </div>
      <form action={logout}>
        <button className="tap w-full rounded-lg px-3 py-2 text-left text-sm text-ink-soft hover:bg-[var(--color-surface-2)]">
          {m.auth.logout}
        </button>
      </form>
    </div>
  );
}

/* ---- iconuri inline ---- */
function gridIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>;
}
function listIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>;
}
function calIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/></svg>;
}
function apptIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/><circle cx="15.5" cy="15.5" r="3.5"/><path d="M15.5 14v1.5l1 1"/></svg>;
}
function kanbanIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 3v18M12 3v12M19 3v8"/></svg>;
}
function shieldIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 5 6v6c0 4 3 6.5 7 9 4-2.5 7-5 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>;
}
function usersIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 6a3 3 0 0 1 0 6M18.5 20a5 5 0 0 0-2.5-4"/></svg>;
}
function userIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>;
}
function checklistIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6h12M9 12h12M9 18h12M3.5 6 4.5 7 6 5M3.5 12l1 1L6 11M3.5 18l1 1L6 17"/></svg>;
}
function mapIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>;
}
function ticketIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 9a1 1 0 0 1 1-1h18a1 1 0 0 1 1 1v2a2 2 0 0 0 0 4v2a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-2a2 2 0 0 0 0-4Z"/><path d="M9 3v3M9 18v3M15 3v3M15 18v3"/></svg>;
}
function folderIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>;
}
function invoiceIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2h9l3 3v15l-2.5-1.5L13 20l-2.5-1.5L8 20l-2.5-1.5L6 20V2Z"/><path d="M9 7h6M9 11h6M9 15h4"/></svg>;
}
function phoneIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/></svg>;
}
function meterIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l3.5-5"/><path d="M3 20h18"/></svg>;
}
function bellIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>;
}
function sendIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 3 11 13M22 3l-7 18-4-8-8-4 19-6Z"/></svg>;
}
function gearIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.2A1.6 1.6 0 0 0 6.6 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4 13.4H4a2 2 0 0 1 0-4h.2A1.6 1.6 0 0 0 5 6.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3 1.6 1.6 0 0 0 1-1.5V2a2 2 0 0 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H22a2 2 0 0 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1Z"/></svg>;
}
