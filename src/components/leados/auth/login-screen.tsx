"use client";

// LOGIN / BOOTSTRAP / PASSWORD-RESET / INVITE screens (v0.17 spec 61–62,
// 67–68, 25). Rendered by the app shell whenever the session query returns
// 401 (production mode); demo mode keeps its implicit demo session.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sparkles, Loader2, LogIn, KeyRound, UserPlus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/lib/leados/locale";
import {
  useLogin,
  useDemoLogin,
  useForgotPassword,
  useResetPassword,
  useBootstrap,
  useAcceptInvite,
} from "@/hooks/leados/use-api";

// ---------------------------------------------------------------------------
// Login screen (email + password, demo shortcut when enabled, first-run
// bootstrap when no real account exists yet)
// ---------------------------------------------------------------------------

export function LoginScreen({ presetToken }: { presetToken?: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-4 bg-background">
      <div className="flex flex-col items-center gap-2">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold text-xl">H</span>
        <h1 className="text-2xl font-bold tracking-tight">HayDev LeadOS</h1>
        <p className="text-xs text-muted-foreground">EVERY LEAD has an owner. NOTHING gets lost.</p>
      </div>
      {presetToken ? <ResetCard token={presetToken} /> : <LoginCard />}
      <p className="text-[11px] text-muted-foreground">© HayDev · LeadOS v0.17</p>
    </div>
  );
}

function LoginCard() {
  const { t } = useLocale();
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [config, setConfig] = useState<{ demoMode: boolean; bootstrapOpen: boolean } | null>(null);

  // Server config probe (GET /auth/bootstrap) — no side effects. Decides
  // whether the demo shortcut renders and whether the FIRST-RUN bootstrap
  // (account creation) is still open.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/auth/bootstrap")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!cancelled && body) setConfig({ demoMode: Boolean(body.demoMode), bootstrapOpen: Boolean(body.bootstrapOpen) });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const onLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    login.mutate(
      { email, password },
      {
        onSuccess: () => toast.success(t("auth.login.success")),
        onError: (err) => toast.error(err.message),
      }
    );
  };

  if (mode === "forgot") return <ForgotCard />;

  // FIRST RUN: no real account exists yet → set up the owner account
  // (organization + OWNER + password), one time only.
  if (config?.bootstrapOpen) {
    return <BootstrapCard />;
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-lg">{t("auth.login.title")}</CardTitle>
        <CardDescription>{t("auth.login.hint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={onLogin} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="login-email">{t("auth.email")}</Label>
            <Input id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.am" autoComplete="email" required />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="login-pass">{t("auth.password")}</Label>
              <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground underline" onClick={() => setMode("forgot")}>
                {t("auth.forgot.link")}
              </button>
            </div>
            <Input id="login-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </div>
          <Button type="submit" className="w-full" disabled={login.isPending}>
            {login.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <LogIn className="h-4 w-4 mr-2" />}
            {t("auth.login.submit")}
          </Button>
        </form>

        {config?.demoMode && <DemoLoginSection />}
      </CardContent>
    </Card>
  );
}

function BootstrapCard() {
  const { t } = useLocale();
  const bootstrap = useBootstrap();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [orgName, setOrgName] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const mismatch = password2.length > 0 && password2 !== password;
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShieldCheck className="h-4 w-4 text-primary" /> {t("auth.bootstrap.title")}
        </CardTitle>
        <CardDescription>{t("auth.bootstrap.hint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!email || !password || !orgName || mismatch) return;
            bootstrap.mutate(
              { email, password, name: name || undefined, organizationName: orgName },
              {
                onSuccess: () => toast.success(t("auth.bootstrap.success")),
                onError: (err) => toast.error(err.message),
              }
            );
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="bs-name">{t("auth.name")}</Label>
            <Input id="bs-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Aram Hayrapetyan" autoComplete="name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bs-email">{t("auth.email")}</Label>
            <Input id="bs-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.am" autoComplete="email" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bs-org">{t("auth.bootstrap.org")}</Label>
            <Input id="bs-org" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="HayDev" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bs-pass">{t("auth.password")}</Label>
            <Input id="bs-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required minLength={8} />
            <p className="text-[11px] text-muted-foreground">{t("auth.password.hint")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bs-pass2">{t("auth.confirmPassword")}</Label>
            <Input id="bs-pass2" type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" required minLength={8} />
            {mismatch && <p className="text-[11px] text-destructive">{t("auth.password.mismatch")}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={bootstrap.isPending || mismatch}>
            {bootstrap.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <UserPlus className="h-4 w-4 mr-2" />}
            {t("auth.bootstrap.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function DemoLoginSection() {
  const { t } = useLocale();
  const demoLogin = useDemoLogin();
  return (
    <div className="pt-1 border-t">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={demoLogin.isPending}
        onClick={() =>
          demoLogin.mutate(undefined, {
            onSuccess: () => toast.success(t("auth.demo.success")),
            onError: (err) => toast.error(err.message),
          })
        }
      >
        {demoLogin.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
        {t("auth.demo.submit")}
      </Button>
      <p className="mt-1.5 text-[11px] text-muted-foreground text-center">{t("auth.demo.hint")}</p>
    </div>
  );
}

function ForgotCard() {
  const { t } = useLocale();
  const forgot = useForgotPassword();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg"><KeyRound className="h-4 w-4 text-primary" /> {t("auth.forgot.title")}</CardTitle>
        <CardDescription>{t("auth.forgot.hint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {sent ? (
          <Alert>
            <AlertDescription>{t("auth.forgot.sent")}</AlertDescription>
          </Alert>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              forgot.mutate(email, { onSuccess: () => setSent(true), onError: (err) => toast.error(err.message) });
            }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="forgot-email">{t("auth.email")}</Label>
              <Input id="forgot-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            <Button type="submit" className="w-full" disabled={forgot.isPending}>
              {forgot.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("auth.forgot.submit")}
            </Button>
          </form>
        )}
        <BackToLogin />
      </CardContent>
    </Card>
  );
}

function ResetCard({ token }: { token: string }) {
  const { t } = useLocale();
  const reset = useResetPassword();
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg"><KeyRound className="h-4 w-4 text-primary" /> {t("auth.reset.title")}</CardTitle>
        <CardDescription>{t("auth.reset.hint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {done ? (
          <Alert>
            <AlertDescription>{t("auth.reset.done")}</AlertDescription>
          </Alert>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              reset.mutate(
                { token, password },
                {
                  onSuccess: () => setDone(true),
                  onError: (err) => toast.error(err.message),
                }
              );
            }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="reset-pass">{t("auth.newPassword")}</Label>
              <Input id="reset-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
              <p className="text-[11px] text-muted-foreground">{t("auth.password.hint")}</p>
            </div>
            <Button type="submit" className="w-full" disabled={reset.isPending || !token}>
              {reset.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("auth.reset.submit")}
            </Button>
            {!token && <p className="text-[11px] text-destructive">{t("auth.reset.noToken")}</p>}
          </form>
        )}
        <BackToLogin />
      </CardContent>
    </Card>
  );
}

function BackToLogin() {
  const { t } = useLocale();
  return (
    <a href="#/dashboard" className="block text-center text-[11px] text-muted-foreground hover:text-foreground underline">
      {t("auth.backToLogin")}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Invite acceptance screen (#/invite/<token>)
// ---------------------------------------------------------------------------

export function InviteScreen({ token }: { token: string }) {
  const { t } = useLocale();
  const accept = useAcceptInvite();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-4 bg-background">
      <div className="flex items-center gap-2.5">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">H</span>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-bold tracking-tight">HayDev LeadOS</span>
          <span className="text-[11px] text-muted-foreground">{t("auth.invite.brandLine")}</span>
        </div>
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">{t("auth.invite.title")}</CardTitle>
          <CardDescription>{t("auth.invite.hint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {done ? (
            <Alert>
              <AlertDescription>{t("auth.invite.done")}</AlertDescription>
            </Alert>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                accept.mutate(
                  { token, name: name || undefined, password: password || undefined },
                  {
                    onSuccess: (r) => {
                      setDone(true);
                      if (r.alreadyMember) toast.success(t("auth.invite.alreadyMember"));
                      else toast.success(t("auth.invite.done"));
                      setTimeout(() => {
                        window.location.hash = "#/dashboard";
                        window.location.reload();
                      }, 1200);
                    },
                    onError: (err) => setError(err.message),
                  }
                );
              }}
              className="space-y-3"
            >
              <div className="space-y-1.5">
                <Label htmlFor="inv-name">{t("auth.name")}</Label>
                <Input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Anna Sargsyan" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inv-pass">{t("auth.password")}</Label>
                <Input id="inv-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
                <p className="text-[11px] text-muted-foreground">{t("auth.invite.passwordHint")}</p>
              </div>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" className="w-full" disabled={accept.isPending || !token}>
                {accept.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t("auth.invite.submit")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
