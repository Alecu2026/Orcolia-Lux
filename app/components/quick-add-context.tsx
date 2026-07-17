"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import type { CategoryLite, QuickDefaults, QuickPrefill } from "./types";
import QuickAddDialog from "./QuickAddDialog";

type Ctx = { open: (prefill?: QuickPrefill) => void };
const QuickAddCtx = createContext<Ctx | null>(null);

export function useQuickAdd(): Ctx {
  const ctx = useContext(QuickAddCtx);
  if (!ctx) throw new Error("useQuickAdd în afara provider-ului");
  return ctx;
}

export function QuickAddProvider({
  categories,
  defaults,
  children,
}: {
  categories: CategoryLite[];
  defaults: QuickDefaults;
  children: ReactNode;
}) {
  const [state, setState] = useState<{ open: boolean; prefill?: QuickPrefill; key: number }>({
    open: false,
    key: 0,
  });

  const open = useCallback((prefill?: QuickPrefill) => {
    setState((s) => ({ open: true, prefill, key: s.key + 1 }));
  }, []);

  const close = useCallback(() => {
    setState((s) => ({ ...s, open: false }));
  }, []);

  return (
    <QuickAddCtx.Provider value={{ open }}>
      {children}
      {state.open && (
        <QuickAddDialog
          key={state.key}
          categories={categories}
          defaults={defaults}
          prefill={state.prefill}
          onClose={close}
        />
      )}
    </QuickAddCtx.Provider>
  );
}
