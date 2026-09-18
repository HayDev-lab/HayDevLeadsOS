"use client";

// NOTIFICATION CENTER — full view (spec Section 35).
// Server-paginated (never loads the whole history), filterable:
// All / Unread / Critical / Resolved. Cards deep-link to the lead/task.

import { useState } from "react";
import { Bell, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/lib/leados/locale";
import { useHashRoute } from "@/lib/leados/hash-route";
import { cn } from "@/lib/utils";
import {
  useNotificationsList,
  useDeliveries,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useReconcileEvents,
} from "@/hooks/leados/use-api";
import { parseDeepLink, NotificationCard } from "./notification-card";

const FILTERS = ["all", "unread", "critical", "resolved"] as const;
type Filter = (typeof FILTERS)[number];

export function NotificationsView() {
  const { t } = useLocale();
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch, isFetching } = useNotificationsList(filter, page, 20);
  // v0.16 (spec 62): map deliveries to their notifications for channel chips.
  const deliveries = useDeliveries();
  const deliveriesByNotification = new Map<string, { channel: string; status: string }[]>();
  for (const d of deliveries.data?.rows ?? []) {
    if (!d.notificationId) continue;
    const list = deliveriesByNotification.get(d.notificationId) ?? [];
    list.push({ channel: d.channel, status: d.status });
    deliveriesByNotification.set(d.notificationId, list);
  }
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const reconcile = useReconcileEvents();
  const [, navigate] = useHashRoute();

  const rows = data?.rows ?? [];
  const unread = data?.unread ?? 0;
  const pages = data?.pages ?? 1;
  const total = data?.total ?? 0;

  const filterLabel = (f: Filter) =>
    f === "all"
      ? t("notif.filter.all")
      : f === "unread"
      ? t("notif.filter.unread")
      : f === "critical"
      ? t("notif.filter.critical")
      : t("notif.filter.resolved");

  const handleOpen = (n: (typeof rows)[number]) => {
    if (!n.readAt) markRead.mutate(n.id);
    const link = parseDeepLink(n.deepLink);
    if (link) navigate(link.view, { ...(link.id ? { id: link.id } : {}), ...link.params });
  };

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      {/* header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t("notif.title")}</h1>
          <p className="text-xs text-muted-foreground">
            {unread > 0 ? `${unread} ${t("notif.unread").toLowerCase()} · ${total}` : `${total}`}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={t("common.retry")}
            onClick={() => reconcile.mutate(undefined, { onSuccess: () => refetch() })}
            disabled={reconcile.isPending}
            title={t("notif.settings.events_log")}
          >
            <RefreshCw className={cn("h-4 w-4", reconcile.isPending && "animate-spin")} />
          </Button>
          {unread > 0 && (
            <Button variant="outline" size="sm" onClick={() => markAll.mutate()} disabled={markAll.isPending}>
              {t("notif.mark_all_read")}
            </Button>
          )}
        </div>
      </div>

      {/* filters */}
      <div className="mt-4 flex flex-wrap gap-1.5" role="tablist" aria-label={t("notif.title")}>
        {FILTERS.map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            onClick={() => {
              setFilter(f);
              setPage(1);
            }}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition",
              filter === f
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {filterLabel(f)}
            {f === "unread" && unread > 0 && <span className="ml-1.5 font-semibold">{unread}</span>}
          </button>
        ))}
      </div>

      {/* list */}
      <div className="mt-4 space-y-2">
        {isLoading && (
          <>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-start gap-2.5 rounded-lg border p-3">
                <Skeleton className="h-7 w-7 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-2.5 w-full" />
                  <Skeleton className="h-2.5 w-1/3" />
                </div>
              </div>
            ))}
          </>
        )}
        {isError && (
          <div className="flex flex-col items-center gap-2 rounded-lg border p-8 text-center">
            <p className="text-sm text-muted-foreground">{t("notif.error")}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              {t("notif.retry")}
            </Button>
          </div>
        )}
        {!isLoading && !isError && rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-lg border p-10 text-center">
            <Bell className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm font-semibold">{t("notif.empty_title")}</p>
            <p className="text-xs text-muted-foreground">{t("notif.empty_desc")}</p>
          </div>
        )}
        {!isLoading &&
          !isError &&
          rows.map((n) => (
            <NotificationCard
              key={n.id}
              n={n}
              t={t}
              onOpen={handleOpen}
              deliveries={deliveriesByNotification.get(n.id) ?? []}
            />
          ))}
      </div>

      {/* pagination */}
      {!isLoading && !isError && total > 20 && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {page} / {pages}
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={page <= 1 || isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={page >= pages || isFetching}
              onClick={() => setPage((p) => p + 1)}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      {!isLoading && !isError && total === 0 && (
        <p className="mt-4 text-center text-xs text-muted-foreground">{t("notif.end_of_list")}</p>
      )}
    </div>
  );
}
