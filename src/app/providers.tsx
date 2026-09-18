"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { LocaleProvider } from "@/lib/leados/locale";
import { useState, type ReactNode } from "react";

export function Providers({ initialLocale, children }: { initialLocale?: "hy" | "ru" | "en"; children: ReactNode }) {
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
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <LocaleProvider initialLocale={initialLocale}>
          {children}
          <Toaster position="bottom-right" richColors closeButton />
        </LocaleProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
