"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { ReadingDto, MeterLocationDto } from "@/lib/meter-readings";
import type { IssueDto } from "@/lib/meter-issues";
import { idbGet, idbSet } from "./usePayerDataset";
import { cacheScope } from "@/lib/cache-scope";

/**
 * Coada citirilor făcute FĂRĂ internet. O citire se salvează întâi pe telefon (IndexedDB, cu poza ei) și pleacă la server când există conexiune:
 * la evenimentul „online”, la revenirea în aplicație, la 20 de secunde cât mai sunt citiri în așteptare și la „Trimite acum”.
 * Serverul e idempotent (aceeași citire trimisă de două ori nu se dublează), deci o trimitere întreruptă se poate repeta liniștit.
 */

export type QueueItem = {
  /** id generat pe telefon (identitatea citirii în coadă) */
  cid: string;
  meterId: string;
  contor: string;
  /** abonatul, pentru afișare în lista cozii */
  name: string;
  /** indexul citit; gol = doar o neregulă raportată (ex. contor inaccesibil) */
  value: number | null;
  /** neregula găsită la contor (cod, vezi lib/meter-issues.ts) și observațiile */
  issueKind: string | null;
  issueNote: string | null;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  /** adresa scrisă din teren (contor fără adresă în 1C) */
  address: string | null;
  /** momentul real al citirii (ms) */
  readAt: number;
  /** utilizatorul a confirmat deja avertismentele (index mai mic / salt mare) */
  confirmed: boolean;
  photo: Blob | null;
  photoName: string | null;
  /** wait = în așteptare; error = respinsă de server (nu se mai încearcă singură) */
  state: "wait" | "error";
  error: string | null;
  tries: number;
  /** contul (id utilizator) în care a fost făcută citirea: se trimite doar din acel cont — nu din altul (simulare de login, alt utilizator pe același telefon) */
  uid?: string;
};

type Snap = { items: QueueItem[]; syncing: boolean; online: boolean; loaded: boolean };
export type SyncResult = { reading: ReadingDto | null; location: MeterLocationDto | null; issue?: IssueDto | null };

const KEY = "field-queue-v1";
const SYNC_EVERY_MS = 20_000;

let items: QueueItem[] = [];
let snap: Snap = { items, syncing: false, online: true, loaded: false };
let syncing = false;
let loaded = false;
let started = false;
/** Citirile altor conturi din același browser: rămân neatinse în baza locală până revine acel cont. */
let others: QueueItem[] = [];
let loadedScope: string | null = null;
let ready: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();
const syncedCbs = new Set<(item: QueueItem, res: SyncResult) => void>();

function emit() {
  snap = { items, syncing, online: typeof navigator === "undefined" ? true : navigator.onLine, loaded };
  listeners.forEach((l) => l());
}

async function persist() {
  await ready;
  await idbSet(KEY, [...others, ...items], false);
}

/** Citește coada contului curent; citirile vechi (fără cont) trec la contul curent, cele ale altor conturi rămân deoparte. */
function load() {
  const scope = cacheScope();
  loadedScope = scope;
  items = [];
  others = [];
  loaded = false;
  emit();
  ready = idbGet<QueueItem[]>(KEY, false).then((stored) => {
    if (loadedScope !== scope) return; // între timp s-a schimbat contul
    if (Array.isArray(stored) && stored.length) {
      const mine = stored.filter((s) => !s.uid || s.uid === scope).map((s) => (s.uid ? s : { ...s, uid: scope }));
      others = stored.filter((s) => s.uid && s.uid !== scope);
      // citirile adăugate între timp (înainte să se termine citirea) se păstrează și ele
      const have = new Set(items.map((i) => i.cid));
      items = [...mine.filter((s) => !have.has(s.cid)), ...items];
    }
    loaded = true;
    emit();
    void syncNow();
  });
}

/** Contul s-a schimbat de când a fost citită coada (ex. simulare de login, alt utilizator pe același telefon): o reîncarcă pentru contul curent. */
function ensureScope() {
  if (started && loadedScope !== cacheScope()) load();
}

/** Pornește coada (o singură dată): citește ce a rămas din sesiunea trecută și ascultă conexiunea. */
function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  load();
  window.addEventListener("online", () => {
    emit();
    void syncNow();
  });
  window.addEventListener("offline", emit);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncNow();
  });
  setInterval(() => {
    if (items.some((i) => i.state === "wait")) void syncNow();
  }, SYNC_EVERY_MS);
}

export function onQueueSynced(cb: (item: QueueItem, res: SyncResult) => void): () => void {
  syncedCbs.add(cb);
  return () => syncedCbs.delete(cb);
}

/** Pune o citire în coadă (se salvează pe telefon) și încearcă să o trimită dacă există conexiune. */
export async function enqueueReading(item: Omit<QueueItem, "cid" | "state" | "error" | "tries" | "readAt">): Promise<QueueItem> {
  start();
  ensureScope();
  // momentul citirii = acum, pe ceasul telefonului (serverul acceptă maxim 40 de zile în urmă)
  const full: QueueItem = { ...item, readAt: Date.now(), cid: crypto.randomUUID(), state: "wait", error: null, tries: 0, uid: cacheScope() };
  // aceeași citire corectată înainte de trimitere: o singură intrare pe contor (cea mai nouă); indexul și neregula se păstrează una pe cealaltă
  const old = items.find((i) => i.meterId === full.meterId);
  if (old) {
    if (full.value == null && old.value != null) Object.assign(full, { value: old.value, lat: old.lat, lng: old.lng, accuracy: old.accuracy, address: old.address, readAt: old.readAt, confirmed: old.confirmed, photo: old.photo, photoName: old.photoName });
    if (!full.issueKind && old.issueKind) Object.assign(full, { issueKind: old.issueKind, issueNote: old.issueNote });
  }
  items = [...items.filter((i) => i.meterId !== full.meterId), full];
  emit();
  await persist();
  if (navigator.onLine) void syncNow();
  return full;
}

export async function removeQueued(cid: string) {
  ensureScope();
  items = items.filter((i) => i.cid !== cid);
  emit();
  await persist();
}

/** O citire respinsă se poate retrimite (ex. după ce s-a corectat ceva). */
export async function retryQueued(cid: string) {
  ensureScope();
  items = items.map((i) => (i.cid === cid ? { ...i, state: "wait", error: null } : i));
  emit();
  await persist();
  void syncNow();
}

export async function syncNow(): Promise<void> {
  ensureScope();
  if (syncing || typeof navigator === "undefined" || !navigator.onLine) return;
  if (!items.some((i) => i.state === "wait")) return;
  syncing = true;
  emit();
  try {
    for (const it of [...items]) {
      if (it.state !== "wait") continue;
      const fd = new FormData();
      fd.set("meterId", it.meterId);
      if (it.value != null) fd.set("value", String(it.value));
      if (it.issueKind) {
        fd.set("issueKind", it.issueKind);
        if (it.issueNote) fd.set("issueNote", it.issueNote);
      }
      fd.set("readAt", String(it.readAt));
      if (it.lat != null && it.lng != null) {
        fd.set("lat", String(it.lat));
        fd.set("lng", String(it.lng));
        if (it.accuracy != null) fd.set("accuracy", String(it.accuracy));
      }
      if (it.address) fd.set("address", it.address);
      if (it.confirmed) fd.set("confirmed", "1");
      if (it.photo) fd.set("photo", it.photo, it.photoName ?? "poza.jpg");
      let res: Response;
      try {
        res = await fetch("/api/contoare/teren/sync", { method: "POST", body: fd, signal: AbortSignal.timeout(90_000) });
      } catch {
        break; // fără conexiune reală: rămân toate în așteptare, se reia mai târziu
      }
      if (res.status === 401 || res.status === 403) {
        // sesiunea a expirat: citirile rămân pe telefon până se reautentifică
        items = items.map((i) => (i.cid === it.cid ? { ...i, tries: i.tries + 1, error: "Autentifică-te din nou ca să se poată trimite." } : i));
        emit();
        await persist();
        break;
      }
      if (res.status >= 500 || res.status === 408 || res.status === 429) {
        items = items.map((i) => (i.cid === it.cid ? { ...i, tries: i.tries + 1 } : i));
        emit();
        await persist();
        break;
      }
      const j = (await res.json().catch(() => null)) as { ok: boolean; error?: string; reading?: ReadingDto | null; location?: MeterLocationDto | null; photoError?: string | null; issue?: IssueDto | null; issueError?: string | null; issueOnly?: boolean } | null;
      if (j?.ok && j.issueOnly) {
        items = items.filter((i) => i.cid !== it.cid);
        emit();
        await persist();
        syncedCbs.forEach((cb) => cb(it, { reading: null, location: null, issue: j.issue ?? null }));
      } else if (j?.ok && j.reading && j.location) {
        // dacă poza n-a putut fi încărcată, citirea e salvată; poza rămâne în coadă ca să se mai încerce (fără a repeta citirea)
        if ((it.photo && j.photoError && !j.reading.photoUrl) || j.issueError) {
          items = items.map((i) => (i.cid === it.cid ? { ...i, tries: i.tries + 1, state: i.tries + 1 >= 5 ? "error" : "wait", error: j.issueError ? `Citirea e salvată, dar neregula nu: ${j.issueError}` : `Citirea e salvată, dar poza nu: ${j.photoError}` } : i));
          emit();
          await persist();
          syncedCbs.forEach((cb) => cb({ ...it, photo: null }, { reading: j.reading!, location: j.location!, issue: j.issue ?? null }));
          continue;
        }
        items = items.filter((i) => i.cid !== it.cid);
        emit();
        await persist();
        syncedCbs.forEach((cb) => cb(it, { reading: j.reading!, location: j.location!, issue: j.issue ?? null }));
      } else {
        items = items.map((i) => (i.cid === it.cid ? { ...i, state: "error", error: j?.error ?? `Respinsă de server (${res.status}).`, tries: i.tries + 1 } : i));
        emit();
        await persist();
      }
    }
  } finally {
    syncing = false;
    emit();
  }
}

function getSnap() {
  return snap;
}
const SERVER_SNAP: Snap = { items: [], syncing: false, online: true, loaded: false };

/** Starea cozii (pentru interfață): citiri în așteptare / respinse, conexiune, sincronizare în curs. */
export function useFieldQueue(): Snap {
  useEffect(() => {
    start();
    emit();
  }, []);
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getSnap,
    () => SERVER_SNAP,
  );
}
