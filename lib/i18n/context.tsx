"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Messages, Locale } from "./index";
import { makeT, type TFn } from "./t";

type I18nCtx = { messages: Messages; locale: Locale };

const I18nContext = createContext<I18nCtx | null>(null);

export function I18nProvider({
  messages,
  locale,
  children,
}: {
  messages: Messages;
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <I18nContext.Provider value={{ messages, locale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nCtx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}

export function useMessages(): Messages {
  return useI18n().messages;
}

export function useLocale(): Locale {
  return useI18n().locale;
}

/** Traducere pentru componentele de client: `const t = useT(); t("Caută")` (vezi lib/i18n/t.ts). */
export function useT(): TFn {
  const locale = useLocale();
  return useMemo(() => makeT(locale), [locale]);
}
