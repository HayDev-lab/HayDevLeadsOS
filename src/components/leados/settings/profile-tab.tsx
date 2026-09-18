"use client";

// PERSONAL PROFILE TAB (v0.17 spec 47, 48–50): personal settings any user
// may edit for THEMSELVES — name, locale (drives delivery rendering),
// timezone, password change. Organization-level settings live in other tabs.

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Save, KeyRound, Loader2, MonitorSmartphone } from "lucide-react";
import { toast } from "sonner";
import { api, useSession, useAuthMe, useUpdateProfile, useChangePassword } from "@/hooks/leados/use-api";
import { useLocale } from "@/lib/leados/locale";
import { formatDate } from "@/components/leados/primitives";

const TIMEZONES = [
  "Asia/Yerevan",
  "Europe/Moscow",
  "Europe/Berlin",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Dubai",
  "Asia/Tbilisi",
];

export function ProfileTab() {
  const { t, locale, setLocale } = useLocale();
  const session = useSession();
  const me = useAuthMe();
  const updateProfile = useUpdateProfile();
  const changePassword = useChangePassword();

  const [name, setName] = useState("");
  const [tz, setTz] = useState("Asia/Yerevan");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");
  const user = session.data?.session?.user;

  // Sync the form when the loaded user changes — React-docs "adjust state
  // during render" pattern (no setState inside an effect).
  const [lastUserId, setLastUserId] = useState<string | null>(null);
  if (user && user.id !== lastUserId) {
    setLastUserId(user.id);
    setName(user.name);
    setTz(user.timezone || "Asia/Yerevan");
  }

  const mismatch = newPassword2.length > 0 && newPassword2 !== newPassword;

  return (
    <div className="space-y-4 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("profile.title")}</CardTitle>
          <CardDescription>{t("profile.hint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pf-name">{t("auth.name")}</Label>
            <Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-email">{t("auth.email")}</Label>
            <Input id="pf-email" value={user?.email ?? ""} disabled />
            <p className="text-[11px] text-muted-foreground">{t("profile.emailImmutable")}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("profile.locale")}</Label>
              <Select
                value={locale}
                onValueChange={(v) => {
                  setLocale(v as "hy" | "ru" | "en");
                  updateProfile.mutate({ locale: v });
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hy">Հայերեն</SelectItem>
                  <SelectItem value="ru">Русский</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">{t("profile.localeHint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label>{t("profile.timezone")}</Label>
              <Select value={tz} onValueChange={setTz}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((z) => (
                    <SelectItem key={z} value={z}>{z}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            size="sm"
            disabled={updateProfile.isPending || !name}
            onClick={() =>
              updateProfile.mutate(
                { name, timezone: tz },
                { onSuccess: () => toast.success(t("common.saved")), onError: (e) => toast.error(e.message) }
              )
            }
          >
            {updateProfile.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
            {t("common.save")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("profile.password.title")}</CardTitle>
          <CardDescription>{t("profile.password.hint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pf-cur">{t("profile.password.current")}</Label>
            <Input id="pf-cur" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
            <p className="text-[11px] text-muted-foreground">{t("profile.password.currentHint")}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pf-new">{t("auth.newPassword")}</Label>
              <Input id="pf-new" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-new2">{t("auth.confirmPassword")}</Label>
              <Input id="pf-new2" type="password" value={newPassword2} onChange={(e) => setNewPassword2(e.target.value)} autoComplete="new-password" />
              {mismatch && <p className="text-[11px] text-destructive">{t("auth.password.mismatch")}</p>}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={changePassword.isPending || !newPassword || mismatch || newPassword.length < 8}
            onClick={() =>
              changePassword.mutate(
                { currentPassword, newPassword },
                {
                  onSuccess: (r) => {
                    toast.success(t("profile.password.changed", { count: r.otherSessionsRevoked }));
                    setCurrentPassword("");
                    setNewPassword("");
                    setNewPassword2("");
                  },
                  onError: (e) => toast.error(e.message),
                }
              )
            }
          >
            {changePassword.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <KeyRound className="h-4 w-4 mr-1.5" />}
            {t("profile.password.submit")}
          </Button>
        </CardContent>
      </Card>

      {me.data?.sessions && me.data.sessions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MonitorSmartphone className="h-4 w-4" /> {t("profile.sessions.title")}
            </CardTitle>
            <CardDescription>{t("profile.sessions.hint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y rounded-lg border">
              {me.data.sessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {s.current && <Badge className="mr-1.5" variant="secondary">{t("profile.sessions.current")}</Badge>}
                      {s.ip ?? "—"}
                    </div>
                    <div className="text-muted-foreground truncate">{s.userAgent ?? "—"}</div>
                  </div>
                  <div className="text-right text-muted-foreground shrink-0">
                    <div>{formatDate(s.lastSeenAt)}</div>
                    <div>{t("profile.sessions.expires")}: {formatDate(s.expiresAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
