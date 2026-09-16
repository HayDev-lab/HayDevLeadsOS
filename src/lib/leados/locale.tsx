"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { DICT, type DictKey } from "@/lib/leados/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/leados/constants";

const LOCALE_COOKIE = "leados_locale";

interface LocaleCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<LocaleCtx | null>(null);

export function LocaleProvider({ initialLocale, children }: { initialLocale?: Locale; children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? DEFAULT_LOCALE);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    } catch {}
  }, []);

  const t = useCallback(
    (key: DictKey, vars?: Record<string, string | number>) => {
      const table = DICT[locale] ?? DICT[DEFAULT_LOCALE];
      let s: string = (table as Record<string, string>)[key] ?? (DICT[DEFAULT_LOCALE] as Record<string, string>)[key] ?? key;
      if (vars) for (const k of Object.keys(vars)) s = s.replace(`{${k}}`, String(vars[k]));
      return s;
    },
    [locale]
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLocale(): LocaleCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useLocale must be used within LocaleProvider");
  return c;
}

export function useT() {
  return useLocale().t;
}
