"use client";

import { useEffect, useRef } from "react";

/**
 * Rulează `handler` O SINGURĂ DATĂ pentru fiecare rezultat nou al unei acțiuni de formular (`useActionState`): notificarea de succes, `router.refresh()` etc.
 *
 * De ce nu un `useEffect` obișnuit cu `[state, router, toast, m…]` în dependențe: după `router.refresh()` aplicația primește din nou mesajele traduse și
 * alte obiecte de la server (cu altă identitate), deci dependențele se schimbă, efectul rulează iar cu aceeași stare „ok”, afișează iar notificarea și face iar
 * `router.refresh()` — un ciclu fără sfârșit („Categorie adăugată” la nesfârșit). Aici contează doar identitatea stării: fiecare trimitere a formularului
 * produce o stare nouă, iar una deja tratată nu se mai tratează.
 */
export function useOnActionResult<S extends object | undefined | null>(state: S, handler: (state: NonNullable<S>) => void): void {
  const latest = useRef(handler);
  const handled = useRef<S | null>(null);
  useEffect(() => {
    latest.current = handler; // ultima versiune a funcției (cu valorile curente din componentă), fără să re-declanșeze tratarea
  });
  useEffect(() => {
    if (!state || handled.current === state) return;
    handled.current = state;
    latest.current(state as NonNullable<S>);
  }, [state]);
}
