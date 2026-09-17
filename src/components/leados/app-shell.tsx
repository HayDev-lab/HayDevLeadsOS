"use client";

import { useEffect, useRef, useState } from "react";
import { useHashRoute } from "@/lib/leados/hash-route";
import { useLocale } from "@/lib/leados/locale";
import { useLostDetector, useSession, useSeed, useRunWorkers } from "@/hooks/leados/use-api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { LayoutDashboard, Users, KanbanSquare, CheckSquare, Settings, Menu, Sparkles, AlertTriangle, Database, Inbox as InboxIcon, BarChart3, UserCircle, Zap } from "lucide-react";
import { LangSwitcher, NotificationsBell, SearchTrigger, ThemeToggle, UserSwitcher } from "./header-controls";
import { DemoBadge } from "./primitives";
import { toast } from "sonner";
import { DashboardView } from "./dashboard-view";
import { LeadsView } from "./leads-view";
import { LeadDetailView } from "./lead-detail-view";
import { PipelineView } from "./pipeline-view";
import { TasksView } from "./tasks-view";
import { SettingsView } from "./settings-view";
import { InboxView } from "./inbox/inbox-view";
import { AnalyticsView } from "./analytics/analytics-view";
import { TeamView } from "./team/team-view";
import { NotificationsView } from "./notifications/notifications-view";
import { AutomationsView } from "./automations/automations-view";
import { LoginScreen, InviteScreen } from "./auth/login-screen";
import { useInboxStats } from "@/hooks/leados/use-api";

const NAV = [
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

/**
 * CLIENT TICK (v0.16 spec 32) — DEV/DEMO FALLBACK ONLY. Production runs
 * the in-process scheduler started at server boot (src/instrumentation.ts),
 * so worker correctness never depends on an open browser. The tick is OFF
 * unless NEXT_PUBLIC_DEMO_WORKER_TICK=true (set in the demo environment;
 * a real deployment simply leaves it unset).
 */
function useWorkersTick() {
  const runWorkers = useRunWorkers();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    if (process.env.NEXT_PUBLIC_DEMO_WORKER_TICK !== "true") return;
    started.current = true;
    const run = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      runWorkers.mutate(undefined, {
        onError: () => {
          /* silent — the scheduler owns production; this is only the demo fallback (spec 82) */
        },
      });
    };
    run();
    const id = setInterval(run, 5 * 60_000);
    return () => clearInterval(id);
  }, []);
}

export function LeadOSApp() {
  const [route, navigate] = useHashRoute();
  const { t } = useLocale();
  const session = useSession();
  const lost = useLostDetector();
  const inboxStats = useInboxStats();
  const seed = useSeed();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useWorkersTick();

  useEffect(() => {
    // auto-seed on very first load if there is no org (DEMO MODE ONLY —
    // production must never auto-seed from a browser).
    const status = (session.error as { status?: number } | null)?.status;
    if (session.isError && status !== 401 && !session.isFetching && !seed.isPending && process.env.NEXT_PUBLIC_LEADOS_DEMO_UI !== "false") {
      seed.mutate(undefined, {
        onSuccess: (r) => {
          if (r.seeded) {
            toast.success("Demo data loaded");
            session.refetch();
          }
        },
      });
    }
  }, [session.isError, session.isFetching, session.error, seed]);

  // HYDRATION-SAFE MOUNT GATE: the active view lives in the URL HASH, which
  // the server never sees — so the server always renders the dashboard shell
  // while a client loading #/notifications (or any hash route) would render a
  // different tree (React hydration error + full client re-render). We render
  // a neutral skeleton until mount, exactly like the theme toggle does.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <div className="flex h-14 items-center gap-2 px-3 md:px-5" />
        </header>
        <div className="flex flex-1 min-h-0">
          <aside className="hidden md:flex w-60 shrink-0 flex-col border-r bg-card/30" />
        </div>
      </div>
    );
  }

  const org = session.data?.session?.organization;
  // v0.17 AUTH GATE (spec 61): 401 → login screen (production mode).
  const authError = (session.error as { status?: number } | null)?.status === 401;
  // v0.17 invite/reset deep links work WITHOUT a session (spec 38).
  if (route.view === "invite" && route.params.id) {
    return <InviteScreen token={route.params.id} />;
  }
  if (authError && route.view !== "reset-password") {
    return <LoginScreen />;
  }
  const needsSeed = session.isError && !session.data && !authError;

  const attentionCount = lost.data?.leadsNeedingAttention ?? 0;
  const inboxUnassigned = inboxStats.data?.unassigned ?? 0;

  if (needsSeed) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="rounded-full bg-primary/10 p-4">
          <Database className="h-7 w-7 text-primary" />
        </div>
        <h1 className="text-xl font-semibold">HayDev LeadOS</h1>
        <p className="text-sm text-muted-foreground max-w-md">Initializing the workspace with demo data…</p>
        <Button onClick={() => seed.mutate()} disabled={seed.isPending}>
          <Sparkles className="h-4 w-4 mr-2" />
          {seed.isPending ? "Loading…" : "Load demo data"}
        </Button>
      </div>
    );
  }

  // Hash-route views beyond the sidebar NAV (notifications = bell → "View all").
  const EXTRA_VIEWS = ["notifications", "lead", "reset-password"];
  const currentView =
    route.view === "lead"
      ? "lead"
      : route.view === "reset-password"
      ? "reset-password"
      : NAV.some((n) => n.view === route.view) || EXTRA_VIEWS.includes(route.view)
      ? route.view
      : "dashboard";
  const renderView = () => {
    switch (currentView) {
      case "leads":
        return <LeadsView />;
      case "lead":
        return <LeadDetailView leadId={route.params.id ?? null} />;
      case "pipeline":
        return <PipelineView />;
      case "tasks":
        return <TasksView />;
      case "inbox":
        return <InboxView />;
      case "analytics":
        return <AnalyticsView />;
      case "team":
        return <TeamView />;
      case "notifications":
        return <NotificationsView />;
      case "automations":
        return <AutomationsView />;
      case "reset-password":
        return <LoginScreen presetToken={route.params.token ?? ""} />;
      case "settings":
        return <SettingsView initialTab={route.params.tab} />;
      default:
        return <DashboardView />;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* top header */}
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="flex h-14 items-center gap-2 px-3 md:px-5">
          <div className="md:hidden">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8"><Menu className="h-5 w-5" /></Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0">
                <SidebarBrand org={org} />
                <NavList currentView={currentView} attentionCount={attentionCount} inboxUnassigned={inboxUnassigned} onNavigate={() => setMobileOpen(false)} />
              </SheetContent>
            </Sheet>
          </div>
          <div className="flex items-center gap-2 md:hidden">
            <BrandMark />
            <span className="text-sm font-bold tracking-tight">LeadOS</span>
          </div>
          <div className="flex-1" />
          <SearchTrigger />
          <NotificationsBell />
          <LangSwitcher />
          <ThemeToggle />
          <UserSwitcher />
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* sidebar (desktop) */}
        <aside className="hidden md:flex w-60 shrink-0 flex-col border-r bg-card/30">
          <SidebarBrand org={org} />
          <NavList currentView={currentView} attentionCount={attentionCount} inboxUnassigned={inboxUnassigned} />
          <div className="mt-auto p-3">
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">EVERY LEAD</span> has an owner. <span className="font-semibold text-foreground">NOTHING</span> gets lost.
              </p>
            </div>
          </div>
        </aside>

        {/* main */}
        <main className="flex-1 min-w-0 overflow-x-hidden">
          <div key={currentView} className="leados-fade-in">
            {renderView()}
          </div>
        </main>
      </div>

      {/* sticky footer */}
      <footer className="mt-auto border-t bg-card/30">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 md:px-6 py-3 text-xs text-muted-foreground">
          <span>{t("footer.rights")}</span>
          <div className="flex items-center gap-3">
            <DemoBadge />
            {org && <span className="hidden sm:inline">{org.name} · {org.currency} · {org.timezone}</span>}
          </div>
        </div>
      </footer>
    </div>
  );
}

function NavList({ currentView, attentionCount, inboxUnassigned, onNavigate }: { currentView: string; attentionCount: number; inboxUnassigned: number; onNavigate?: () => void }) {
  const { t } = useLocale();
  const [, navigate] = useHashRoute();
  return (
    <nav className="flex flex-col gap-1 px-3 py-2">
      {NAV.map((n) => {
        const active = currentView === n.view || (n.view === "leads" && currentView === "lead");
        const Icon = n.icon;
        const badge = n.view === "dashboard" ? attentionCount : n.view === "inbox" ? inboxUnassigned : 0;
        return (
          <button
            key={n.view}
            onClick={() => { navigate(n.view); onNavigate?.(); }}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition relative",
              active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="font-medium">{t(n.key)}</span>
            {badge > 0 && (
              <span className={cn("ml-auto inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold", active ? "bg-primary-foreground/20 text-primary-foreground" : n.view === "inbox" ? "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300")}>
                {n.view === "inbox" ? null : <AlertTriangle className="h-2.5 w-2.5" />}{badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

function BrandMark() {
  return (
    <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">H</span>
  );
}

function SidebarBrand({ org }: { org?: { name: string; slug: string; currency: string } | null }) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-4">
      <BrandMark />
      <div className="flex flex-col leading-tight">
        <span className="text-sm font-bold tracking-tight">HayDev LeadOS</span>
        <span className="text-[11px] text-muted-foreground truncate max-w-[160px]">{org?.name ?? "…"}</span>
      </div>
    </div>
  );
}
