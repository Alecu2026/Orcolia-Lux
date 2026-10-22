"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CHAT_MAX_BODY, CHAT_POLL_MS, type ChatMessage, type ChatSender, type ChatState } from "@/lib/ticket-chat-shared";

const TZ = "Europe/Chisinau";
const GROUP_GAP_MS = 5 * 60_000;

type Pending = { tempId: string; body: string; createdAt: string; failed: boolean };

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("ro-RO", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: TZ });
function dayLabel(iso: string): string {
  const k = dayKey(iso);
  if (k === dayKey(new Date().toISOString())) return "Azi";
  if (k === dayKey(new Date(Date.now() - 86_400_000).toISOString())) return "Ieri";
  return new Date(iso).toLocaleDateString("ro-RO", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" });
}

/** Linkurile din text devin clicabile; restul rămâne text (React îl escapează). */
function linkify(text: string, own: boolean): ReactNode[] {
  return text.split(/(https?:\/\/[^\s<]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" className={`break-all underline ${own ? "text-white" : "text-brand-strong"}`}>{part}</a>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

function mergeMessages(prev: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return prev;
  const byId = new Map(prev.map((m) => [m.id, m]));
  let changed = false;
  for (const m of incoming) if (!byId.has(m.id)) { byId.set(m.id, m); changed = true; }
  if (!changed) return prev;
  return [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
}

/**
 * Conversația unui tichet, ca un chat (baloane, grupare pe zile, „Văzut"). Folosită și de client (în portal) și de operatori (în pagina
 * tichetului). Mesajele noi se aduc la câteva secunde cât fila e vizibilă; un mesaj trimis apare imediat, înainte de confirmarea serverului.
 */
export default function TicketChat({
  ticketId,
  viewer,
  ownName = "",
  introMessage,
  heightClass = "h-[min(32rem,70dvh)]",
}: {
  ticketId: string;
  viewer: "staff" | "client";
  /** Opțional: dacă lipsește, se ia de la server. */
  ownName?: string;
  /** Descrierea tichetului, arătată ca primul mesaj al clientului (nu e în baza de mesaje). */
  introMessage?: { body: string; createdAt: string; authorName: string } | null;
  heightClass?: string;
}) {
  const own: ChatSender = viewer === "client" ? "CLIENT" : "STAFF";
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [meta, setMeta] = useState<Pick<ChatState, "status" | "canWrite" | "writeBlockedReason" | "peerReadAt" | "viewerName"> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [newBelow, setNewBelow] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastAtRef = useRef<string | null>(null);
  const stickRef = useRef(true);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const tempSeq = useRef(0);

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setNewBelow(0);
  }, []);

  const applyState = useCallback((st: ChatState, replace: boolean) => {
    setMeta({ status: st.status, canWrite: st.canWrite, writeBlockedReason: st.writeBlockedReason, peerReadAt: st.peerReadAt, viewerName: st.viewerName });
    setLoadError(null);
    if (st.messages.length > 0) {
      const last = st.messages[st.messages.length - 1].createdAt;
      if (!lastAtRef.current || last > lastAtRef.current) lastAtRef.current = last;
    }
    // mesaje venite de la cealaltă parte cât derulezi mai sus → „mesaje noi"
    const fresh = st.messages.filter((m) => !seenIdsRef.current.has(m.id));
    st.messages.forEach((m) => seenIdsRef.current.add(m.id));
    if (!replace && !stickRef.current) {
      const fromPeer = fresh.filter((m) => m.sender !== own).length;
      if (fromPeer) setNewBelow((n) => n + fromPeer);
    }
    setMessages((prev) => (replace ? mergeMessages([], st.messages) : mergeMessages(prev, st.messages)));
    // mesajul trimis de noi, ajuns între timp prin interogare, nu mai trebuie arătat și ca „în curs"
    setPending((p) => p.filter((x) => !st.messages.some((m) => m.sender === own && m.body === x.body && m.createdAt >= new Date(Date.parse(x.createdAt) - 5000).toISOString())));
  }, [own]);

  const poll = useCallback(async (first: boolean, signal?: AbortSignal) => {
    const since = !first && lastAtRef.current ? `&since=${encodeURIComponent(lastAtRef.current)}` : "";
    const res = await fetch(`/api/tickets/${ticketId}/chat?as=${viewer}${since}&mark=1`, { cache: "no-store", signal });
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(j?.error ?? `Eroare ${res.status}`);
    }
    applyState((await res.json()) as ChatState, first);
  }, [ticketId, viewer, applyState]);

  // Încărcarea inițială + interogarea periodică (doar cât fila e vizibilă)
  useEffect(() => {
    const ctl = new AbortController();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async (first = false) => {
      if (stopped) return;
      if (document.visibilityState === "visible") {
        try {
          await poll(first, ctl.signal);
        } catch (e) {
          if (!stopped && first) setLoadError(e instanceof Error ? e.message : "Nu am putut încărca conversația.");
        }
      }
      if (!stopped) timer = setTimeout(() => void tick(), CHAT_POLL_MS);
    };
    void tick(true);
    const onVisible = () => {
      if (document.visibilityState !== "visible" || stopped) return;
      clearTimeout(timer);
      void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      ctl.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll]);

  // Derulează la capăt când vin mesaje, dacă erai deja jos (sau ai scris tu)
  useEffect(() => {
    if (stickRef.current) scrollToBottom();
  }, [messages, pending, meta, scrollToBottom]);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickRef.current = near;
    if (near) setNewBelow(0);
  }

  async function sendBody(body: string, tempId: string) {
    try {
      const res = await fetch(`/api/tickets/${ticketId}/chat?as=${viewer}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const j = (await res.json().catch(() => null)) as { message?: ChatMessage; error?: string } | null;
      if (!res.ok || !j?.message) throw new Error(j?.error ?? `Eroare ${res.status}`);
      seenIdsRef.current.add(j.message.id);
      if (!lastAtRef.current || j.message.createdAt > lastAtRef.current) lastAtRef.current = j.message.createdAt;
      setMessages((prev) => mergeMessages(prev, [j.message!]));
      setPending((p) => p.filter((x) => x.tempId !== tempId));
    } catch {
      setPending((p) => p.map((x) => (x.tempId === tempId ? { ...x, failed: true } : x)));
    }
  }

  function send() {
    const body = draft.trim();
    if (!body || !meta?.canWrite) return;
    const tempId = `tmp-${++tempSeq.current}`;
    stickRef.current = true;
    setPending((p) => [...p, { tempId, body, createdAt: new Date().toISOString(), failed: false }]);
    setDraft("");
    requestAnimationFrame(() => { if (inputRef.current) inputRef.current.style.height = "auto"; });
    void sendBody(body, tempId);
  }

  function retry(p: Pending) {
    setPending((list) => list.map((x) => (x.tempId === p.tempId ? { ...x, failed: false } : x)));
    void sendBody(p.body, p.tempId);
  }

  const me = ownName || meta?.viewerName || "";

  // Lista afișată: descrierea tichetului (primul mesaj al clientului) + mesajele + cele în curs de trimitere
  const items = useMemo(() => {
    const out: { key: string; sender: ChatSender; authorName: string; body: string; createdAt: string; pending?: Pending }[] = [];
    if (introMessage) out.push({ key: "intro", sender: "CLIENT", authorName: introMessage.authorName, body: introMessage.body, createdAt: introMessage.createdAt });
    for (const m of messages) out.push({ key: m.id, sender: m.sender, authorName: m.authorName, body: m.body, createdAt: m.createdAt });
    for (const p of pending) out.push({ key: p.tempId, sender: own, authorName: me, body: p.body, createdAt: p.createdAt, pending: p });
    return out;
  }, [introMessage, messages, pending, own, me]);

  const lastOwnKey = [...items].reverse().find((x) => x.sender === own && !x.pending)?.key;
  const seen = (iso: string) => !!meta?.peerReadAt && meta.peerReadAt >= iso;

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)]">
      <div className="relative">
        <div ref={listRef} onScroll={onScroll} className={`${heightClass} overflow-y-auto overscroll-contain px-3 py-3`}>
          {!meta && !loadError && <p className="py-10 text-center text-sm text-ink-soft">Se încarcă conversația…</p>}
          {loadError && <p className="py-10 text-center text-sm text-st-cancelled">{loadError}</p>}
          {meta && items.length === 0 && <p className="py-10 text-center text-sm text-ink-soft">Încă nu e niciun mesaj. Scrie primul mesaj mai jos.</p>}

          {items.map((it, i) => {
            const prev = items[i - 1];
            const next = items[i + 1];
            const mine = it.sender === own;
            const newDay = !prev || dayKey(prev.createdAt) !== dayKey(it.createdAt);
            const startsGroup = newDay || prev.sender !== it.sender || Date.parse(it.createdAt) - Date.parse(prev.createdAt) > GROUP_GAP_MS || prev.authorName !== it.authorName;
            const endsGroup = !next || dayKey(next.createdAt) !== dayKey(it.createdAt) || next.sender !== it.sender || Date.parse(next.createdAt) - Date.parse(it.createdAt) > GROUP_GAP_MS || next.authorName !== it.authorName;
            // numele operatorului când nu ești tu (sau când sunt mai mulți operatori)
            const showName = startsGroup && it.sender === "STAFF" && it.authorName !== me;
            return (
              <Fragment key={it.key}>
                {newDay && (
                  <div className="my-3 text-center text-[11px] font-medium text-ink-soft">{dayLabel(it.createdAt)}</div>
                )}
                <div className={`flex flex-col ${mine ? "items-end" : "items-start"} ${startsGroup ? "mt-2" : "mt-0.5"}`}>
                  {showName && <span className="mb-0.5 px-1 text-[11px] text-ink-soft">{it.authorName}</span>}
                  <div
                    className={`max-w-[82%] whitespace-pre-wrap break-words px-3.5 py-2 text-[14px] leading-snug ${
                      mine
                        ? `bg-brand text-white ${startsGroup ? "rounded-t-2xl" : "rounded-t-md"} ${endsGroup ? "rounded-b-2xl rounded-br-md" : "rounded-b-md"} rounded-l-2xl`
                        : `bg-[var(--color-surface-2)] text-ink ${startsGroup ? "rounded-t-2xl" : "rounded-t-md"} ${endsGroup ? "rounded-b-2xl rounded-bl-md" : "rounded-b-md"} rounded-r-2xl`
                    } ${it.pending ? "opacity-70" : ""} ${it.pending?.failed ? "ring-2 ring-st-cancelled" : ""}`}
                  >
                    {linkify(it.body, mine)}
                  </div>
                  {endsGroup && (
                    <span className="mt-0.5 flex items-center gap-1.5 px-1 text-[10px] text-ink-soft">
                      {it.pending ? (
                        it.pending.failed ? (
                          <>
                            <span className="text-st-cancelled">Netrimis</span>
                            <button type="button" onClick={() => retry(it.pending!)} className="cursor-pointer font-semibold text-brand underline">Reîncearcă</button>
                          </>
                        ) : "Se trimite…"
                      ) : (
                        <>
                          {fmtTime(it.createdAt)}
                          {mine && it.key === lastOwnKey && it.key !== "intro" && (
                            <span className={seen(it.createdAt) ? "font-semibold text-brand" : ""}>{seen(it.createdAt) ? "· ✓✓ Văzut" : "· ✓ Trimis"}</span>
                          )}
                        </>
                      )}
                    </span>
                  )}
                </div>
              </Fragment>
            );
          })}
        </div>
        {newBelow > 0 && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 cursor-pointer rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white shadow-lg"
          >
            ↓ {newBelow} {newBelow === 1 ? "mesaj nou" : "mesaje noi"}
          </button>
        )}
      </div>

      {meta?.status === "DONE" && viewer === "client" && meta.canWrite && (
        <p className="border-t border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-1.5 text-center text-[11px] text-ink-soft">Tichet finalizat. Dacă scrii un mesaj, se redeschide.</p>
      )}

      {meta && !meta.canWrite ? (
        <p className="border-t border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-3 text-center text-xs text-ink-soft">{meta.writeBlockedReason ?? "Nu poți scrie aici."}</p>
      ) : (
        <form
          onSubmit={(e) => { e.preventDefault(); send(); }}
          className="flex items-end gap-2 border-t border-[var(--color-line)] p-2"
        >
          <textarea
            ref={inputRef}
            value={draft}
            rows={1}
            maxLength={CHAT_MAX_BODY}
            onChange={(e) => {
              setDraft(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 132)}px`;
            }}
            onKeyDown={(e) => {
              // Enter trimite pe calculator; pe telefon Enter rămâne rând nou (se trimite din buton)
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Scrie un mesaj…"
            disabled={!meta}
            className="max-h-[132px] min-h-10 flex-1 resize-none rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3.5 py-2 text-[14px] outline-none focus:border-brand"
          />
          <button
            type="submit"
            disabled={!draft.trim() || !meta}
            aria-label="Trimite"
            className="tap grid size-10 shrink-0 cursor-pointer place-items-center rounded-full bg-brand text-lg text-white hover:bg-brand-strong disabled:cursor-default disabled:opacity-40"
          >
            ➤
          </button>
        </form>
      )}
    </div>
  );
}
