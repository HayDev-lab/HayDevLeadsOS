"use client";

// TEAM MANAGEMENT TAB (v0.17 spec 34–36, 65–66): members + pending invites.
// Mutations (invite / role change / remove / resend / revoke) are visible
// only with MEMBER_MANAGE permission — the server enforces it anyway.

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, UserPlus, Send, Trash2, Copy, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  useMembers,
  useInviteMember,
  useChangeMemberRole,
  useRemoveMember,
  useResendInvite,
  useRevokeInvite,
} from "@/hooks/leados/use-api";
import { useLocale } from "@/lib/leados/locale";
import { LeadAvatar, formatDate } from "@/components/leados/primitives";

const ROLE_BADGE: Record<string, string> = {
  OWNER: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  ADMIN: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  MEMBER: "bg-muted text-foreground",
  VIEWER: "bg-muted text-muted-foreground",
};

export function TeamTab() {
  const { t } = useLocale();
  const members = useMembers();
  const inviteMember = useInviteMember();
  const changeRole = useChangeMemberRole();
  const removeMember = useRemoveMember();
  const resendInvite = useResendInvite();
  const revokeInvite = useRevokeInvite();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("MEMBER");
  const [inviteResult, setInviteResult] = useState<{ url: string; emailed: boolean } | null>(null);

  const canManage = members.data?.canManage ?? false;
  const isOwner = members.data?.myRole === "OWNER";

  const onInvite = () => {
    if (!inviteEmail) return;
    inviteMember.mutate(
      { email: inviteEmail, role: inviteRole },
      {
        onSuccess: (r) => {
          setInviteResult({ url: r.inviteUrl, emailed: r.emailed });
          setInviteEmail("");
          members.refetch();
        },
        onError: (e) => toast.error(e.message),
      }
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">{t("team.members.title")}</CardTitle>
            <CardDescription>{t("team.members.hint")}</CardDescription>
          </div>
          {canManage && (
            <Button size="sm" onClick={() => { setInviteResult(null); setInviteOpen(true); }}>
              <UserPlus className="h-4 w-4 mr-1.5" />
              {t("team.invite.button")}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {members.isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />)}
            </div>
          ) : (
            <div className="divide-y rounded-lg border overflow-x-auto">
              {(members.data?.members ?? []).map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3 px-3 py-2.5 min-w-[560px] sm:min-w-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <LeadAvatar first={m.name} color={m.avatarColor} size={30} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate">{m.name}</span>
                        {m.isSelf && <span className="text-[10px] text-muted-foreground">({t("team.you")})</span>}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">{m.email}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="hidden sm:inline text-[11px] text-muted-foreground">
                      {t("team.joined")} {formatDate(m.joinedAt)}
                    </span>
                    {canManage && !m.isSelf && m.role !== "OWNER" ? (
                      <Select value={m.role} onValueChange={(role) => changeRole.mutate({ id: m.id, role }, {
                        onSuccess: () => { toast.success(t("team.role.changed")); members.refetch(); },
                        onError: (e) => toast.error(e.message),
                      })}>
                        <SelectTrigger className="h-7 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ADMIN">Admin</SelectItem>
                          <SelectItem value="MEMBER">Member</SelectItem>
                          <SelectItem value="VIEWER">Viewer</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${ROLE_BADGE[m.role] ?? ROLE_BADGE.MEMBER}`}>
                        {m.role}
                      </span>
                    )}
                    {canManage && !m.isSelf && m.role !== "OWNER" && (
                      <Button
                        size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                        aria-label={t("team.remove")}
                        onClick={() => {
                          if (confirm(t("team.removeConfirm", { name: m.name }))) {
                            removeMember.mutate(m.id, {
                              onSuccess: () => { toast.success(t("team.removed")); members.refetch(); },
                              onError: (e) => toast.error(e.message),
                            });
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {canManage && m.isSelf && m.role === "OWNER" && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><ShieldAlert className="h-3 w-3" /> {t("team.lastOwnerNote")}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {canManage && (members.data?.invites?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("team.invites.title")}</CardTitle>
            <CardDescription>{t("team.invites.hint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y rounded-lg border overflow-x-auto">
              {members.data?.invites.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between gap-3 px-3 py-2.5 min-w-[560px] sm:min-w-0">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{inv.email}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {t("team.role")}: {inv.role} · {t("team.expires")} {formatDate(inv.expiresAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button size="sm" variant="outline" className="h-7" onClick={() => {
                      resendInvite.mutate(inv.id, {
                        onSuccess: () => { toast.success(t("team.invite.resent")); members.refetch(); },
                        onError: (e) => toast.error(e.message),
                      });
                    }}>
                      <Send className="h-3 w-3 mr-1" /> {t("team.invite.resendBtn")}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => {
                      revokeInvite.mutate(inv.id, {
                        onSuccess: () => { toast.success(t("team.invite.revoked")); members.refetch(); },
                        onError: (e) => toast.error(e.message),
                      });
                    }}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Invite dialog (spec 66): email + role → link to share */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("team.invite.dialogTitle")}</DialogTitle>
            <DialogDescription>{t("team.invite.dialogHint")}</DialogDescription>
          </DialogHeader>
          {inviteResult ? (
            <div className="space-y-3">
              <div className="rounded-lg border bg-muted/40 p-3">
                <div className="text-[11px] text-muted-foreground mb-1">{t("team.invite.linkLabel")}</div>
                <div className="font-mono text-[11px] break-all">{inviteResult.url}</div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard?.writeText(inviteResult.url);
                    toast.success(t("common.copied"));
                  }}
                >
                  <Copy className="h-3.5 w-3.5 mr-1.5" /> {t("team.invite.copy")}
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  {inviteResult.emailed ? t("team.invite.emailed") : t("team.invite.shareManually")}
                </span>
              </div>
              <Button size="sm" onClick={() => setInviteOpen(false)}>{t("common.done")}</Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="inv-email">{t("auth.email")}</Label>
                <Input id="inv-email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="teammate@company.am" />
              </div>
              <div className="space-y-1.5">
                <Label>{t("team.role")}</Label>
                <Select value={inviteRole} onValueChange={setInviteRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MEMBER">Member</SelectItem>
                    <SelectItem value="VIEWER">Viewer</SelectItem>
                    {isOwner && <SelectItem value="ADMIN">Admin</SelectItem>}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">{t("team.invite.roleHint")}</p>
              </div>
              <Button size="sm" className="w-full" disabled={inviteMember.isPending || !inviteEmail} onClick={onInvite}>
                {inviteMember.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
                {t("team.invite.send")}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
