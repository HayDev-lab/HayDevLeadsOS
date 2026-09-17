"use client";

import { useEffect, useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Moon, Sun, Languages, Search, Bell, User as UserIcon, Check, ChevronDown, Command } from "lucide-react";
import { useLocale } from "@/lib/leados/locale";
import { useSearch, useSession, useSwitchUser } from "@/hooks/leados/use-api";
import { cn } from "@/lib/utils";
import { useHashRoute } from "@/lib/leados/hash-route";
import { LeadAvatar } from "./primitives";
import { NotificationsBell as NotificationsBellV14 } from "./notifications/notifications-bell";

/** v0.14 Event Engine bell — popover (desktop) / drawer (mobile) + unread badge. */
export const NotificationsBell = NotificationsBellV14;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="h-8 w-8"
    >
      {mounted ? theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </Button>
  );
}

export function LangSwitcher() {
  const { locale, setLocale } = useLocale();
  const labels: Record<string, string> = { hy: "ՀՅ", ru: "RU", en: "EN" };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 h-8 px-2">
          <Languages className="h-4 w-4" />
          <span className="text-xs font-semibold">{labels[locale]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Language</DropdownMenuLabel>
        {(["hy", "ru", "en"] as const).map((l) => (
          <DropdownMenuItem key={l} onClick={() => setLocale(l)} className="justify-between">
            <span>{l === "hy" ? "Հայերեն" : l === "ru" ? "Русский" : "English"}</span>
            {locale === l && <Check className="h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function UserSwitcher() {
  const { data } = useSession();
  const switchUser = useSwitchUser();
  const user = data?.session?.user;
  if (!user) return <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full"><UserIcon className="h-4 w-4" /></Button>;
  const roleLabel: Record<string, string> = { OWNER: "Owner", ADMIN: "Admin", MANAGER: "Manager", SALES_MANAGER: "Sales", VIEWER: "Viewer" };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-lg pl-1 pr-2 py-1 hover:bg-accent transition">
          <LeadAvatar first={user.name} color={user.avatarColor} size={28} />
          <span className="hidden md:flex flex-col items-start leading-tight">
            <span className="text-xs font-semibold truncate max-w-[120px]">{user.name}</span>
            <span className="text-[10px] text-muted-foreground">{roleLabel[user.role] ?? user.role}</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground hidden md:block" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{user.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Switch user (demo)</DropdownMenuLabel>
        {data?.users?.map((u) => (
          <DropdownMenuItem key={u.id} onClick={() => switchUser.mutate(u.id)} className="justify-between gap-2">
            <span className="flex items-center gap-2">
              <LeadAvatar first={u.name} color={u.avatarColor} size={22} />
              <span className="text-xs">{u.name}</span>
            </span>
            {u.id === user.id && <Check className="h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SearchTrigger() {
  const [, navigate] = useHashRoute();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useSearch(q);

  // open with cmd/ctrl+k
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") { setOpen(false); setQ(""); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  const rows = results.data?.rows ?? [];
  const max = Math.min(8, rows.length);

  const onPick = (id?: string) => {
    if (id) navigate("lead", { id });
    setOpen(false);
    setQ("");
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="hidden sm:flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted transition w-[220px]"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Search leads…</span>
        <span className="ml-auto inline-flex items-center gap-0.5 text-[10px] font-medium text-muted-foreground/80 border rounded px-1 py-px">
          <Command className="h-2.5 w-2.5" />K
        </span>
      </button>
      <Button variant="ghost" size="icon" className="h-8 w-8 sm:hidden" onClick={() => setOpen(true)}>
        <Search className="h-4 w-4" />
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onClick={() => { setOpen(false); setQ(""); }}>
          <div className="w-full max-w-xl rounded-xl border bg-background shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => { setQ(e.target.value); setIdx(0); }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(max - 1, i + 1)); }
                  if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
                  if (e.key === "Enter") { const r = rows[idx]; onPick(r?.id); }
                }}
                placeholder="Search by name, company, phone, email…"
                className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <span className="text-[10px] text-muted-foreground border rounded px-1 py-px">ESC</span>
            </div>
            <div className="max-h-80 overflow-y-auto p-1">
              {q.trim().length < 2 && <div className="p-6 text-center text-xs text-muted-foreground">Type at least 2 characters</div>}
              {q.trim().length >= 2 && rows.length === 0 && <div className="p-6 text-center text-xs text-muted-foreground">No leads found</div>}
              {rows.slice(0, 8).map((r, i) => (
                <button
                  key={r.id}
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => onPick(r.id)}
                  className={cn(
                    "w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition",
                    i === idx ? "bg-accent" : "hover:bg-accent/60"
                  )}
                >
                  <LeadAvatar first={r.firstName} last={r.lastName} color={r.owner?.avatarColor} size={28} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{[r.firstName, r.lastName].filter(Boolean).join(" ") || "Unknown"}</div>
                    <div className="text-xs text-muted-foreground truncate">{[r.company, r.email, r.phone].filter(Boolean).join(" · ")}</div>
                  </div>
                  {r.stage && <span className="text-xs text-muted-foreground">{r.stage.name}</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

