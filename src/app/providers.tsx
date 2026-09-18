"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { LocaleProvider } from "@/lib/leados/locale";
import { useState, type ReactNode } from "react";

export function Providers({ initialLocale, nonce, children }: { initialLocale?: "hy" | "ru" | "en"; nonce?: string; children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );
  return (
    // v0.20 §13: nonce stamps next-themes' inline no-FOUC bootstrap script so
    // it passes the production nonce-CSP (the proxy generates it per request).
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange nonce={nonce}>
      <QueryClientProvider client={client}>
        <LocaleProvider initialLocale={initialLocale}>
          {children}
          <Toaster position="bottom-right" richColors closeButton />
        </LocaleProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
