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
