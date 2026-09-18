import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "./providers";
import { cookies, headers } from "next/headers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HAYDEV LeadOS — Lead Management",
  description: "Every lead has an owner. Every lead has a next action. Nothing gets lost. — HayDev LeadOS",
  // v0.20 §32 repair: local same-origin icon — the previous external CDN URL
  // was silently blocked by the production CSP (img-src 'self').
  icons: { icon: "/logo.svg" },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const initialLocale = (cookieStore.get("leados_locale")?.value as "hy" | "ru" | "en" | undefined) ?? "hy";
  // v0.20 §13: per-request nonce from the security proxy — passed to
  // next-themes so its inline no-FOUC script passes the production CSP.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang={initialLocale} suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}>
        <Providers initialLocale={initialLocale} nonce={nonce}>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
