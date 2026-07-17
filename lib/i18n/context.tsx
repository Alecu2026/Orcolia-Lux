"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Messages, Locale } from "./index";

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
