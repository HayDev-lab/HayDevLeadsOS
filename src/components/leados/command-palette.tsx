"use client";

// HAYDEV LEADOS — COMMAND PALETTE (v0.19).
//
// A single ⌘K surface for everything:
//   • lead search (server-side, same /search API as before)
//   • view navigation (all 9 sidebar views + notifications)
//   • quick actions (new lead, toggle dark mode)
//   • language switching (hy/ru/en)
//
// Replaces the old lead-only SearchTrigger. Static groups are filtered
// client-side (shouldFilter=false + manual match) so server-returned leads
// are never hidden by cmdk's local fuzzy filter.

import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  LayoutDashboard, Users, KanbanSquare, CheckSquare, Settings, Bell, Inbox as InboxIcon,
  BarChart3, UserCircle, Zap, Plus, Moon, Languages, Search, Command as CommandIcon, Loader2, CornerDownLeft, History,
} from "lucide-react";
import { useLocale } from "@/lib/leados/locale";
import { useHashRoute } from "@/lib/leados/hash-route";
import { useSearch } from "@/hooks/leados/use-api";
import { LeadAvatar } from "./primitives";
import { getRecentLeads, type RecentLeadEntry } from "@/lib/leados/recent-leads";

const PALETTE_NAV = [
  { view: "dashboard", icon: LayoutDashboard, key: "nav.dashboard" as const },
  { view: "leads", icon: Users, key: "nav.leads" as const },
  { view: "pipeline", icon: KanbanSquare, key: "nav.pipeline" as const },
  { view: "tasks", icon: CheckSquare, key: "nav.tasks" as const },
  { view: "inbox", icon: InboxIcon, key: "nav.inbox" as const },
  { view: "automations", icon: Zap, key: "nav.automations" as const },
  { view: "analytics", icon: BarChart3, key: "nav.analytics" as const },
  { view: "team", icon: UserCircle, key: "nav.team" as const },
  { view: "settings", icon: Settings, key: "nav.settings" as const },
];

const LANGS = [
  { code: "hy", label: "Հայերեն", kw: "hy armenian hayeren" },
  { code: "ru", label: "Русский", kw: "ru russian" },
  { code: "en", label: "English", kw: "en english" },
] as const;

export function CommandPalette() {
  const { t, locale, setLocale } = useLocale();
  const { theme, setTheme } = useTheme();
  const [, navigate] = useHashRoute();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const search = useSearch(query.trim().length >= 2 ? query : "");

  // RECENT LEADS (v0.20): derived from localStorage whenever the palette
  // OPENS (open false→true re-runs the memo) — fresh history per session,
  // no effect/state dance, and it stays empty while closed.
  const recent = useMemo<RecentLeadEntry[]>(() => (open ? getRecentLeads() : []), [open]);

  // External openers (sidebar hint button) fire this event.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("leados:open-palette", onOpen);
    return () => window.removeEventListener("leados:open-palette", onOpen);
  }, []);

  // ⌘K / Ctrl+K toggles the palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const q = query.trim().toLowerCase();
  const match = (...fields: string[]) => q === "" || fields.some((f) => f.toLowerCase().includes(q));

  const recentItems = recent.filter((r) =>
    match(
      [r.firstName, r.lastName].filter(Boolean).join(" "),
      r.company ?? "",
      r.phone ?? "",
      r.stageName ?? "",
      "recent history"
    )
  );
  const goItems = PALETTE_NAV.filter((n) => match(t(n.key), n.view));
  const showNotifications = match(t("notif.view_all"), "notifications bell");
  const showNewLead = match(t("palette.new_lead"), "new lead create");
  const showTheme = match(t("palette.toggle_theme"), "theme dark light mode");
  const langItems = LANGS.filter((l) => match(l.label, l.kw));

  const leadRows = (search.data?.rows ?? []).slice(0, 6);
  const searchingLeads = q.length >= 2;
  const hasLeads = searchingLeads && leadRows.length > 0;
  const hasAny =
    hasLeads || recentItems.length > 0 || goItems.length > 0 || showNotifications || showNewLead || showTheme || langItems.length > 0;

  const go = (view: string, params?: Record<string, string>) => {
    close();
    navigate(view, params);
  };

  const newLead = () => {
    close();
    navigate("leads");
    // LeadsView listens for this event and opens the (controlled) lead dialog.
    setTimeout(() => window.dispatchEvent(new CustomEvent("leados:new-lead")), 150);
  };

  const toggleTheme = () => {
    close();
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return (
    <>
      {/* header trigger (matches the old SearchTrigger look) */}
      <button
        onClick={() => setOpen(true)}
        aria-label={t("palette.open")}
        className="hidden sm:flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:border-border/80 hover:shadow-sm transition w-[220px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <Search className="h-3.5 w-3.5" />
        <span>{t("palette.placeholder")}</span>
        <span className="ml-auto inline-flex items-center gap-0.5 text-[10px] font-medium text-muted-foreground/80 border rounded px-1 py-px">
          <CommandIcon className="h-2.5 w-2.5" />K
        </span>
      </button>
      <button
        onClick={() => setOpen(true)}
        aria-label={t("palette.open")}
        className="sm:hidden inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent transition"
      >
        <Search className="h-4 w-4" />
      </button>

      <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : close())}>
        <DialogHeader className="sr-only">
          <DialogTitle>{t("palette.open")}</DialogTitle>
          <DialogDescription>{t("palette.placeholder")}</DialogDescription>
        </DialogHeader>
        <DialogContent className="overflow-hidden p-0 sm:max-w-lg top-[12vh] translate-y-0 gap-0">
          <Command shouldFilter={false} className="[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group]]:px-2 [&_[cmdk-group]:not([hidden])~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]_svg]:h-4 [&_[cmdk-input-wrapper]_svg]:w-4 [&_[cmdk-input]]:h-11 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2">
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder={t("palette.placeholder")}
              className="text-sm"
            />
            {searchingLeads && search.isFetching && (
              <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-muted-foreground border-b">
                <Loader2 className="h-3 w-3 animate-spin" /> {t("palette.searching")}
              </div>
            )}
            <CommandList className="max-h-[380px]">
              {!hasAny && (
                <div className="py-8 text-center space-y-1">
                  <Search className="h-5 w-5 text-muted-foreground/50 mx-auto" />
                  <p className="text-sm text-muted-foreground">{searchingLeads && search.isFetching ? t("palette.searching") : t("palette.no_results")}</p>
                  {!searchingLeads && <p className="text-[11px] text-muted-foreground/70">{t("palette.no_results_hint")}</p>}
                </div>
              )}

              {/* leads (server search) */}
              {hasLeads && (
                <CommandGroup heading={t("palette.group.leads")}>
                  {leadRows.map((r: any) => (
                    <CommandItem
                      key={r.id}
                      value={`lead-${r.id}`}
                      onSelect={() => go("lead", { id: r.id })}
                      className="py-2.5"
                    >
                      <LeadAvatar first={r.firstName} last={r.lastName} color={r.owner?.avatarColor} size={26} />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">
                          {[r.firstName, r.lastName].filter(Boolean).join(" ") || "Unknown"}
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {[r.company, r.phone, r.email].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      {r.stage && (
                        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {r.stage.name}
                        </span>
                      )}
                      <CornerDownLeft className="h-3 w-3 text-muted-foreground/50" />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {/* recently viewed (localStorage) */}
              {recentItems.length > 0 && (
                <>
                  {hasLeads && <CommandSeparator />}
                  <CommandGroup heading={t("palette.group.recent")}>
                    {recentItems.map((r) => (
                      <CommandItem key={r.id} value={`recent-${r.id}`} onSelect={() => go("lead", { id: r.id })} className="py-2.5">
                        <LeadAvatar first={r.firstName} last={r.lastName} color={r.avatarColor} size={26} />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">
                            {[r.firstName, r.lastName].filter(Boolean).join(" ") || "Unknown"}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {[r.company, r.phone].filter(Boolean).join(" · ") || "—"}
                          </div>
                        </div>
                        {r.stageName && (
                          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {r.stageName}
                          </span>
                        )}
                        <History className="h-3 w-3 text-muted-foreground/40" />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}

              {/* navigation */}
              {(goItems.length > 0 || showNotifications) && (
                <CommandGroup heading={t("palette.group.go")}>
                  {goItems.map((n) => {
                    const Icon = n.icon;
                    return (
                      <CommandItem key={n.view} value={`go-${n.view}`} onSelect={() => go(n.view)}>
                        <Icon className="h-4 w-4" />
                        {t(n.key)}
                      </CommandItem>
                    );
                  })}
                  {showNotifications && (
                    <CommandItem value="go-notifications" onSelect={() => go("notifications")}>
                      <Bell className="h-4 w-4" />
                      {t("notif.view_all")}
                    </CommandItem>
                  )}
                </CommandGroup>
              )}

              {/* actions */}
              {(showNewLead || showTheme) && (
                <CommandGroup heading={t("palette.group.actions")}>
                  {showNewLead && (
                    <CommandItem value="action-new-lead" onSelect={newLead}>
                      <Plus className="h-4 w-4" />
                      {t("palette.new_lead")}
                    </CommandItem>
                  )}
                  {showTheme && (
                    <CommandItem value="action-theme" onSelect={toggleTheme}>
                      <Moon className="h-4 w-4" />
                      {t("palette.toggle_theme")}
                    </CommandItem>
                  )}
                </CommandGroup>
              )}

              {/* language */}
              {langItems.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading={t("palette.group.language")}>
                    {langItems.map((l) => (
                      <CommandItem
                        key={l.code}
                        value={`lang-${l.code}`}
                        onSelect={() => {
                          if (l.code !== locale) setLocale(l.code);
                          close();
                        }}
                      >
                        <Languages className="h-4 w-4" />
                        {l.label}
                        {l.code === locale && (
                          <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-primary">{l.code}</span>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>

            {/* footer hints */}
            <div className="border-t px-3 py-2.5 flex items-center justify-between text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd><Kbd>↓</Kbd>
                <span className="mx-0.5">{t("palette.footer.hint")}</span>
              </span>
              <span className="hidden sm:flex items-center gap-1">
                <CommandIcon className="h-2.5 w-2.5" />K
              </span>
            </div>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded border bg-muted px-1 font-sans text-[9px] font-medium text-muted-foreground">{children}</kbd>;
}
