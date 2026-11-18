"use client";

import { useCallback, useMemo, useState } from "react";

export type Opt = { id: string; name: string };

export const NO_OPTS: Opt[] = [];

/**
 * Lista de opțiuni (proiecte / clienți) a unei pagini: vine de pe server, dar un element creat chiar acum din formular (client nou, proiect nou) se adaugă IMEDIAT în ea,
 * fără să aștepte reîmprospătarea paginii. Când serverul trimite și el elementul (după `router.refresh()`), duplicatul dispare singur.
 * Întoarce lista îmbogățită și funcția de adăugare (stabilă).
 */
export function useOptionList(initial: Opt[]): [Opt[], (o: Opt) => void] {
  const [extra, setExtra] = useState<Opt[]>([]);
  const list = useMemo(() => {
    if (extra.length === 0) return initial;
    const have = new Set(initial.map((o) => o.id));
    const add = extra.filter((o) => !have.has(o.id));
    return add.length ? [...add, ...initial] : initial;
  }, [initial, extra]);
  const add = useCallback((o: Opt) => setExtra((e) => (e.some((x) => x.id === o.id) ? e : [o, ...e])), []);
  return [list, add];
}
