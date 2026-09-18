# Changelog — HayDev LeadOS

Public product history. Internal development logs live outside the source
repository (kept privately by the maintaining team).

## 0.19.2 — Production Security & Release Hardening

Security and release-engineering round. No new product features.

### Security (P0)

- **Tenant guards** — central server-side validation of every foreign ID
  (member/lead/source/pipeline/stage/tag/custom field) before any write;
  foreign IDs are indistinguishable from missing ones (404).
- **Membership source of truth** — authorization uses
  `OrganizationMember(status=ACTIVE)` exclusively; `User.organizationId` /
  `User.role` remain cache pointers. Assignments, notifications, automations
  and deliveries re-validate recipients through the same path.
- **Public ingestion lockdown** — `POST /api/v1/leads/ingest` accepts only a
  strict `ExternalLeadPayload` (no force/ownerId/stageId/sourceId/priority/
  tags/meta/…), authenticates via per-source hashed bearer credentials
  (`lsrc_…`, SHA-256 stored, one-time reveal, rotation, disable), resolves
  the organization server-side, logs redacted field names only, and applies
  a durable DB-backed per-source rate limit.
- **Meta routing invariant** — one Meta Page → one organization, enforced by
  a DB unique; deterministic `resolveMetaPageRoute`; forged payload org ids
  ignored.
- **Deployment safety** — production Caddy config is a fixed proxy (no
  user-controlled ports); the preview runtime DB is never packaged into
  production builds; production boot fails fast without `DATABASE_URL`.

### Database & release engineering

- Runtime DB untracked; demo is fully reproducible from source
  (`prisma/migrations/0_init` + deterministic seed incl. the Meta demo).
- `db:migrate:deploy` for production; `db push` demoted to dev-only.
- `verify` script + GitHub Actions CI (install → prisma gates → migrations →
  tests → typecheck → lint → build), no continue-on-error.
- Unused dependencies removed (next-auth, z-ai-web-dev-sdk, next-intl).
- `SECURITY.md`, `Caddyfile.production` / `Caddyfile.dev`, `.env.example`.

## 0.19.1 — Meta Lead Ads (v0.19 hardening)

- Graph API v26.0 default; explicit 503 when OAuth is unconfigured.
- `claimedAt`-based stale worker reclaim; `Lead(organizationId, externalId)`
  index; `LEAD_INGESTED` i18n; `.env` untracked, `.env.example` introduced.

## 0.19.0 — Meta Lead Ads Integration

- Full connector: OAuth, page subscription, durable webhook events with
  signature verification, worker-side Graph fetch, field mapping, canonical
  `ingestLead()` → `LEAD_INGESTED` → SLA/automation/notification downstream,
  crash recovery, replay idempotency, demo provider (zero network).

## 0.17.0 — Production Auth (multi-tenant)

- DB-validated sessions, OrganizationMember roles, invite flow, audit log,
  per-user settings, demo/production mode separation.

## 0.16.0 — Worker Infrastructure & Delivery Layer

- Production scheduler, worker leases + durable runs, automation retries
  with action-level idempotency, email/Telegram/webhook deliveries with
  SSRF validation, centralized error taxonomy.

## 0.15.0 — Automation Engine

- WHEN → IF → THEN rules as a second consumer of the domain event store;
  whitelisted actions; loop protection; dry-run; execution history.

## 0.14.0 — Event Engine & Notification Center

- Durable domain events, notification projection with per-user preferences,
  resolution service, notification center UI.

## ≤ 0.13 — Core CRM

- Leads, pipeline, tasks, inbox, SLA layers (first response / follow-up /
  stage inactivity), analytics, team, settings, i18n (hy/ru/en).
