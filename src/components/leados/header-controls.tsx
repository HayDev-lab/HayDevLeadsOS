"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Moon, Sun, Languages, User as UserIcon, Check, ChevronDown, LogOut } from "lucide-react";
import { useLocale } from "@/lib/leados/locale";
import { useSession, useSwitchUser, useAuthMe, useSwitchOrg, useLogout } from "@/hooks/leados/use-api";
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
  const { t } = useLocale();
  const { data } = useSession();
  const switchUser = useSwitchUser();
  const me = useAuthMe();
  const switchOrg = useSwitchOrg();
  const logout = useLogout();
  const [, navigate] = useHashRoute();
  const user = data?.session?.user;
  if (!user) return <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full"><UserIcon className="h-4 w-4" /></Button>;
  const roleLabel: Record<string, string> = { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member", VIEWER: "Viewer" };
  const memberships = me.data?.memberships ?? [];
  const switchable = memberships.filter((m) => !m.active);
  const isDemo = data?.session?.demo ?? false;
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
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{user.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("settings", { tab: "profile" })} className="gap-2">
          <UserIcon className="h-3.5 w-3.5" /> {t("usermenu.profile")}
        </DropdownMenuItem>
        {switchable.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">{t("usermenu.switchOrg")}</DropdownMenuLabel>
            {switchable.map((m) => (
              <DropdownMenuItem key={m.organizationId} onClick={() => switchOrg.mutate(m.organizationId)} className="justify-between gap-2">
                <span className="flex items-center gap-2 text-xs">{m.organization.name}{m.organization.isDemo ? " (demo)" : ""}</span>
                <span className="text-[10px] text-muted-foreground">{roleLabel[m.role] ?? m.role}</span>
              </DropdownMenuItem>
            ))}
          </>
        )}
        {isDemo && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">{t("usermenu.switchUser")}</DropdownMenuLabel>
            {data?.users?.map((u) => (
              <DropdownMenuItem key={u.id} onClick={() => switchUser.mutate(u.id)} className="justify-between gap-2">
                <span className="flex items-center gap-2">
                  <LeadAvatar first={u.name} color={u.avatarColor} size={22} />
                  <span className="text-xs">{u.name}</span>
                </span>
                {u.id === user.id && <Check className="h-3.5 w-3.5" />}
              </DropdownMenuItem>
            ))}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => logout.mutate(false)} className="gap-2">
          <LogOut className="h-3.5 w-3.5" /> {t("usermenu.logout")}
        </DropdownMenuItem>
        {!isDemo && (
          <DropdownMenuItem onClick={() => logout.mutate(true)} className="gap-2">
            <LogOut className="h-3.5 w-3.5" /> {t("usermenu.logoutAll")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
