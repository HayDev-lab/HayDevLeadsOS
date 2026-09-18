# Security Policy — HayDev LeadOS

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.19.x (main) | ✅ active development |
| < 0.19 | ❌ not supported |

## Reporting a Vulnerability

**Do not report security issues in public GitHub issues, discussions, or
pull requests.**

1. Use GitHub's **private vulnerability reporting** for this repository
   (Security tab → "Report a vulnerability"). This is the preferred channel.
2. If private reporting is unavailable to you, open a regular issue that
   contains **no exploit details** and states "security issue — please
   provide a private channel"; maintainers will respond with one.

Please include:

- affected component/route and how you reached it;
- a minimal reproduction or proof of concept;
- your assessment of impact;
- a contact for follow-ups.

We will acknowledge reports promptly and keep reporters updated on the
remediation timeline. Coordinated disclosure: please wait for a fix release
before publishing details.

## What we consider security issues

- Cross-tenant data access or leakage (organizations are isolated by
  server-side membership checks — see `src/lib/leados/tenant-guard.ts`).
- Authentication/session bypass, source-credential forgery
  (`src/lib/leados/source-token.ts`), or webhook signature bypass.
- Injection, XSS, CSRF, SSRF, or unsafe redirects.
- Secret exposure: never send secrets, tokens, or database dumps in a
  report — redact them; note their location instead.

## Hardening baseline (v0.19.2)

Tenant guards on every foreign ID · public ingestion limited to a strict
payload + per-source hashed credentials + redacted logging · Meta webhook
routing deterministic (one page → one organization) · production proxy fixed
(no dynamic port pivots) · runtime databases never versioned · Prisma
migrations instead of lossy pushes · CI gates on every PR.

## Hardening baseline (v0.19.3)

Stage business logic keyed on stable semantic codes (display names are
presentational only) · production CSP is nonce-based with `strict-dynamic`
(no `unsafe-eval` / script `unsafe-inline`) · generic `db:push
--accept-data-loss` removed (dev-only `db:dev:push` remains) · Bun pinned
in CI (deterministic toolchain) · packaged demo is seed-only (no runtime
database copies in artifacts).

## Content-Security-Policy (v0.19.3)

Production:

- `script-src 'self' 'nonce-<per-request>' 'strict-dynamic'` — no
  `unsafe-eval`, no script `unsafe-inline`.
- `style-src 'self' 'unsafe-inline'` — **documented residual**: React
  inline `style` attributes and framework-injected `<style>` blocks (e.g.
  chart theming) have no nonce support. Accepted risk: styles are
  same-origin-generated; browser E2E verifies zero CSP violations.
- `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'self'`,
  `base-uri 'self'`, `form-action 'self'`.

Development keeps `unsafe-inline` + `unsafe-eval` for scripts (React
Refresh HMR requires them) — never shipped to production.

The edge proxy (Caddyfile.production) never sets a CSP header: the app is
the single CSP source of truth (avoids double-CSP intersection). Edge and
app send identical X-Frame-Options / Referrer-Policy / Permissions-Policy /
X-Content-Type-Options values; the edge adds HSTS (preload) and hides the
Server header.
