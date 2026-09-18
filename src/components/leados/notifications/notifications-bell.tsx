"use client";

// NOTIFICATION CENTER — bell (spec Sections 33–34, 76–82).
// Desktop: compact popover with the last 8 notifications + "View all".
// Mobile (390×844): full-width sheet/drawer — never a tiny desktop popover.
// The badge shows the SERVER-side unread count (1–99, then "99+").

import { useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLocale } from "@/lib/leados/locale";
import { useHashRoute } from "@/lib/leados/hash-route";
import {
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  type NotificationRow,
} from "@/hooks/leados/use-api";
import { parseDeepLink, NotificationCard } from "./notification-card";

function openNotification(n: NotificationRow, markRead: (id: string) => void, navigate: ReturnType<typeof useHashRoute>[1]) {
  // Click = mark read + navigate (Section 37). Navigation failure must not
  // un-read the notification.
  if (!n.readAt) markRead(n.id);
  const link = parseDeepLink(n.deepLink);
  if (link) {
    navigate(link.view, { ...(link.id ? { id: link.id } : {}), ...link.params });
  }
}

export function NotificationsBell() {
  const { t } = useLocale();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError, refetch } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const [, navigate] = useHashRoute();

  const unread = data?.unread ?? 0;
  const badge = unread > 99 ? "99+" : unread > 0 ? String(unread) : null;
  const rows = data?.rows ?? [];

  const handleOpen = (n: NotificationRow) => {
    openNotification(n, (id) => markRead.mutate(id), navigate);
    setOpen(false);
  };

  const header = (
    <div className="flex items-center justify-between gap-2 px-1">
      <span className="text-sm font-semibold">{t("notif.title")}</span>
      <div className="flex items-center gap-2">
        {unread > 0 && (
          <button
            onClick={() => markAll.mutate()}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
          >
            <CheckCheck className="h-3 w-3" />
            {t("notif.mark_all_read")}
          </button>
        )}
        <button
          onClick={() => {
            setOpen(false);
            navigate("notifications");
          }}
          className="text-[11px] font-medium text-muted-foreground hover:text-foreground hover:underline"
        >
          {t("notif.view_all")}
        </button>
      </div>
    </div>
  );

  const body = (
    <div className="max-h-[70vh] overflow-y-auto">
      {isLoading && (
        <div className="space-y-2 p-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-start gap-2.5 p-2.5">
              <Skeleton className="h-7 w-7 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-2.5 w-full" />
                <Skeleton className="h-2.5 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}
      {isError && (
        <div className="flex flex-col items-center gap-2 p-6 text-center">
          <p className="text-xs text-muted-foreground">{t("notif.error")}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            {t("notif.retry")}
          </Button>
        </div>
      )}
      {!isLoading && !isError && rows.length === 0 && (
        <div className="flex flex-col items-center gap-1.5 p-8 text-center">
          <Bell className="h-6 w-6 text-muted-foreground/30" />
          <p className="text-sm font-medium">{t("notif.empty_title")}</p>
          <p className="text-xs text-muted-foreground">{t("notif.empty_desc")}</p>
        </div>
      )}
      {!isLoading &&
        !isError &&
        rows.length > 0 && (
          <div className="space-y-1.5 p-2">
            {rows.map((n) => (
              <NotificationCard key={n.id} n={n} t={t} onOpen={handleOpen} compact />
            ))}
          </div>
        )}
    </div>
  );

  const bellButton = (
    <Button variant="ghost" size="icon" className="relative h-8 w-8" aria-label={t("notif.title")}>
      <Bell className="h-4 w-4" />
      {badge && (
        <span className="absolute top-0.5 right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none text-white">
          {badge}
        </span>
      )}
    </Button>
  );

  if (isMobile) {
    return (
      <>
        <button
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent"
          aria-label={t("notif.title")}
          onClick={() => setOpen(true)}
        >
          <Bell className="h-4 w-4" />
          {badge && (
            <span className="absolute top-0.5 right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none text-white">
              {badge}
            </span>
          )}
        </button>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
            <SheetHeader className="p-3 pb-1">
              <SheetTitle className="text-left">{header}</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto pb-4">{body}</div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{bellButton}</PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-2">
        {header}
        <div className="mt-1">{body}</div>
      </PopoverContent>
    </Popover>
  );
}
