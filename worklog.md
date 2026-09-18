# HAYDEV LEADOS — Worklog

## Project Status (initial inspection)
- Fresh Next.js 16.1.3 (Turbopack) scaffold. No existing HayDev modules code in repo.
- Stack: Prisma + SQLite (db/custom.db), full shadcn/ui (New York, neutral), @dnd-kit, recharts, framer-motion, sonner, next-intl, next-themes, next-auth, zod, tanstack query/table.
- Existing Prisma schema = scaffold (User + Post). Will be REPLACED with LeadOS schema (safe — no production data).
- Dev server running on :3000, clean.
- `next.config.ts` has `typescript.ignoreBuildErrors: true`, `reactStrictMode: false`.

## Architecture decision
LeadOS is built as the core product on this project (not a separate repo). Since no existing HayDev ERP/Business Audit code exists in-repo, I will:
- Build LeadOS core (orgs, users, leads, pipeline, activities, tasks, notes, tags, events, scoring, lost detector, duplicate detection, follow-up engine, attribution, inbox abstraction).
- Implement Business Audit as an **ingestion endpoint** that accepts audit payloads and creates/enriches leads (architecture-ready; mock UI preview embedded in Lead Detail).
- Implement ERP/CRM as an **adapter interface** + local mock implementation (sync status tracked, not fake production claim).
- Implement event publishing architecture (IntegrationEvent table + publisher) for future Automation Engine / Owner AI.
- i18n: AM/RU/EN via lightweight dictionary (next-intl is available but for a single-route app a typed dictionary is lighter and avoids route-group config complexity).
- Multi-tenant: organization_id on all tenant-scoped entities. Default org + demo users seeded.
- Auth: a demo session context (org + user) for the MVP — server-side org isolation enforced on every query. Role field on users prepared (OWNER/ADMIN/MANAGER/SALES_MANAGER/VIEWER).

## Phases
1. [DONE] Inspect existing project.
2. [IN PROGRESS] Prisma schema for LeadOS + db:push.
3. [TODO] lib business logic (normalize, scoring, lost-detector, followup, duplicate, audit-ingest, erp-adapter, events, i18n, seed, csv, attribution).
4. [TODO] API routes (v1): leads, pipeline/kanban, tasks, activities, notes, dashboard, lost-detector, business-audit, import, export, sources, tags, users, notifications, settings, search, erp-sync.
5. [TODO] App shell (sidebar, header, theme toggle, lang switcher, sticky footer) + i18n providers + dashboard page.
6. [TODO] UI screens: dashboard, leads list, lead detail, pipeline kanban, tasks, settings.
7. [TODO] Seed demo data.
8. [TODO] Browser QA + repair loops + final report.

---
Task ID: 1
Agent: main
Task: Inspect existing project structure and plan LeadOS architecture.

Work Log:
- Read package.json, prisma/schema.prisma, src/app/layout.tsx, page.tsx, globals.css, tailwind.config.ts, tsconfig.json, next.config.ts, Caddyfile, .env, examples/websocket, src tree.
- Confirmed: fresh scaffold, no existing HayDev modules, safe to build LeadOS as core product.

Stage Summary:
- Stack confirmed: Next.js 16 + Prisma/SQLite + shadcn/ui + dnd-kit + recharts + next-intl + next-themes.
- Decided LeadOS architecture: multi-tenant via organization_id, adapter-based ERP/Business-Audit ingestion, event publishing, AM/RU/EN i18n dictionary.
- Next: build Prisma schema.

---
Task ID: 2
Agent: main
Task: Build Prisma schema + lib business logic + API layer for LeadOS.

Work Log:
- Created full Prisma schema (org, users, leads, sources, pipeline/stages, tags, activities, tasks, notes, lead_events, business_audit, integration_sync, integration_event, incoming_message, source_attribution, lost_reason, notification, custom_field, scoring_config, setting, lost_lead_flag, lead_score_component). Multi-tenant via organization_id, soft-delete via archivedAt, indexes on hot paths.
- db:push OK. SQLite, enums as String.
- lib/leados: constants, normalize, i18n (AM/RU/EN typed dict), context (server session + org isolation + role auth), api helpers, scoring (explainable, configurable), lost-detector (deterministic), followup, duplicate, events (publish + IntegrationEvent), erp-adapter (interface + local mock), audit-ingest (Business Audit → lead), attribution + csv, seed (demo data ~30 fictional leads), lead-service (create/update/stage/assign/archive/merge), lead-score-service (recalc), lost-detector-service (run+persist flags), dashboard-service (metrics + recent + attention + activity stream).
- API v1 routes: seed, session, dashboard, lost-detector, leads (list/create), leads/ingest (public), leads/[id] (get/patch/archive), stage, assign, merge, score, duplicate, activities, tasks, notes, events, audit, erp-sync; pipeline, pipeline/kanban; tasks (+[id]); sources; tags; users; notifications; settings; search; business-audit; import (CSV); export (CSV); erp-sync.
- TypeScript: lib + api clean (no errors).

Stage Summary:
- Backend complete: schema, deterministic business logic (scoring, lost detector, follow-up, duplicate detection), adapter-based ERP + event publishing, Business Audit ingestion, public lead ingestion with rate-limit, CSV import/export, multi-tenant isolation enforced via getSession() on every route.
- Next: client UI (providers, i18n, hash-router, app shell, dashboard, leads list/detail, kanban, tasks, settings) + seed + browser QA.

---
Task ID: 3
Agent: main
Task: Build LeadOS client UI (providers, i18n, hash-router, app shell, dashboard, leads list, lead detail, kanban, tasks, settings, dialogs) + seed + browser QA + repair loops.

Work Log:
- Client foundation: providers.tsx (ThemeProvider, QueryClientProvider, LocaleProvider, sonner Toaster), locale.tsx (typed AM/RU/EN context + cookie persistence), hash-route.ts (view router via location.hash — only `/` route used, all views are hash segments), use-api.ts (React Query hooks for all resources + mutations with cache invalidation).
- UI primitives (primitives.tsx): timeAgo/formatDate/formatMoney, ScoreBadge, PriorityBadge, StageBadge, StatusPill, LeadAvatar, OwnerChip, SourceBadge (icons by source type), AttentionBadge, MiniBar, EmptyState, DemoBadge, TagChip.
- App shell (app-shell.tsx): sticky header (search/cmd-k, notifications bell, lang switcher, theme toggle, user switcher), desktop sidebar + mobile Sheet drawer, sticky footer (mt-auto), auto-seed on first load, attention count badge on dashboard nav. Nested components extracted to module level (lint fix).
- Dashboard view: 8 metric cards (new/unassigned/overdue/qualified/meetings/proposals/won/lost), attention banner, by-source + by-stage MiniBar charts, requires-attention list (lost detector flags), recent leads, overdue tasks, activity timeline.
- Leads list: search, filters (source/owner/stage/priority/overdue/unassigned), sortable table with pagination, bulk archive, CSV export button, import dialog, new-lead dialog with duplicate detection + merge/open/create-anyway.
- Lead detail: header (name/company/source/status/priority/score/owner + actions: call/message/email/edit/erp-sync/recalc-score/quote-disabled/archive), contact info, Business Audit summary (6 scores bars), deterministic AI summary (no fake AI), tabs (activity/notes/tasks/events), right panel (next action, open tasks, owner select, score explanation with +/- reasons, potential value, ERP sync status), stage changer (8 stages), duplicate banner with merge.
- Pipeline Kanban: 8 columns, dnd-kit drag & drop (useSetLeadStage mutation), cards with avatar/score/priority/value/unassigned warning, drag overlay, est value totals.
- Tasks view: active/overdue/done filters, inline create, toggle done, delete.
- Settings view: tabs for org, users, pipeline/stages, sources, tags, scoring rules (editable), Audit Ingest (live tester), ERP/Events reference.
- import-dialog, lead-form-dialog (with duplicate handling), audit-ingest-dialog.
- Reduced Prisma log noise (query→error/warn). Fixed: kanban route missing file, canMutate import location, events.ts JSON casts, seed.ts array types, validate() async→sync, hook order in EventsTab, set-state-in-effect lint, nested components, duplicate-detection-no-silent-create.

Browser QA (agent-browser):
- Dashboard 1440×900: renders all metrics, attention (26 leads), recent leads, activity stream. No console errors.
- Leads list: filters, table, pagination all working.
- Lead detail: stage change (Qualified) works — button becomes active/disabled, no errors.
- Pipeline Kanban: all 8 columns render with cards.
- Settings → Audit Ingest: ingested a test audit → lead count 30→31 (verified via API).
- Mobile 390×844: sidebar collapses to drawer, filters/table scroll horizontally, nav works.
- Desktop 1920×1080: clean, no errors.

Integration tests (curl):
- Duplicate detection: POST /leads with existing phone → created:false, lead:null, duplicate matches returned. With force:true → creates anyway.
- Public ingestion: POST /leads/ingest with x-org-slug header → lead created + attribution recorded.
- ERP sync on a WON lead → SYNCED with externalRefId ERP-XXXX.
- Security: lead of other org / non-existent → 404 {"error":"lead"} (org isolation enforced server-side via getSession on every query).
- Lost detector run: 26 leads needing attention, byReason breakdown (unassigned/no_contact/overdue_followup/no_activity/meeting_no_next/proposal_no_followup).

Stage Summary:
- LeadOS is a complete, coherent, production-shaped lead management layer. Every API route enforces org isolation via getSession(); role checks (canMutate) on mutations; deterministic business logic (scoring, lost detector, follow-up, duplicate detection); adapter-based ERP (local-mock, clearly labeled, no fake production claims); event publishing architecture (LeadEvent audit + IntegrationEvent for Automation Engine); Business Audit ingestion; public lead ingestion with rate-limit + attribution; CSV import/export; soft-delete; AM/RU/EN i18n; dark/light theme; responsive (desktop/tablet/mobile); sticky footer.
- Quality gates: TypeScript PASS (only pre-existing skills/ error remains, unrelated), lint PASS, browser QA PASS on 1920×1080 / 1440×900 / 1024×768-class / 390×844, persistence works (SQLite seeded, 30 demo leads + audit + tasks + flags), no runtime/hydration errors in console.
- Final verdict: VERIFIED_80_PERCENT_PRODUCT_READY (see report below).

---
HAYDEV LEADOS IMPLEMENTATION REPORT

Architecture
- Module of HayDev ecosystem on Next.js 16 + Prisma/SQLite + shadcn/ui. Multi-tenant via organization_id. Single `/` route; all views are hash segments (`#dashboard`, `#leads`, `#lead/<id>`, `#pipeline`, `#tasks`, `#settings`). Adapter-based integration (ERP, Business Audit, events) — no hard coupling.

Database
- 26 Prisma models: Organization, User, LeadSource, Pipeline, PipelineStage, Tag, LeadTag, Lead, LeadScoreComponent, LostLeadFlag, Activity, Task, Note, LeadEvent, BusinessAudit, IntegrationSync, IntegrationEvent, IncomingMessage, WebhookLog, SourceAttribution, LostReason, Notification, CustomField, CustomFieldValue, ScoringConfig, Setting. Indexes on org_id, created_at, owner_id, stage_id, normalized phone/email, next_action_at, source_id. Soft delete via archivedAt on leads. db:push applied.

Lead Workflow
- SOURCE (source/attribution) → LEAD (normalized phone/email) → duplicate check (no silent create) → QUALIFICATION (scoring) → ASSIGNMENT (owner) → FOLLOW-UP (next_action_at + suggestions) → PIPELINE (8 stages, kanban drag&drop) → CONVERSION (WON/LOST with reasons) → ERP sync (adapter) + IntegrationEvent published.

Business Audit Integration
- POST /api/v1/business-audit accepts a completed audit payload → creates/updates lead → attaches audit (6 scores + automation map + recommendations + report summary) → recomputes score → publishes audit.completed. Lead Detail shows the audit summary with score bars. Verified end-to-end (lead 31 created from audit payload).

ERP/CRM Integration
- ErpAdapter interface + LocalErpAdapter (local-mock, generates ERP-XXXX refs, records IntegrationSync). NOT a production connection — clearly labeled. Sync status tracked per lead (PENDING/SYNCED/FAILED/RETRY). Swap in a real provider by implementing the interface.

Lost Lead Detector
- Deterministic rule engine (NOT AI). Flags: unassigned, no_contact (new lead > 24h no contact), overdue_followup, no_activity (>48h in open stage), proposal_no_followup, meeting_no_next. Persisted as LostLeadFlag with severity (info/warning/critical). Dashboard attention list + leads list overdue filter. Run via POST /lost-detector.

Lead Scoring
- Explainable, configurable per org (ScoringConfig). 0–100, LOW/MEDIUM/HIGH. Components persisted with signed deltas (e.g. "+25 Business Audit completed", "+15 High automation potential"). Recalc on demand. No random values.

Dashboard
- Metric cards (8), attention banner + list, by-source + by-stage distribution, recent leads, overdue tasks, activity stream. Auto-refresh (30s/60s). Attention count in sidebar nav.

Mobile
- Verified 390×844: hamburger drawer nav, horizontally-scrollable table, full lead detail, filters. Desktop/tablet optimized; mobile allows view/call/message/stage change/note/task.

Security
- Server-side org isolation via getSession() on every route (orgId scoped; lead-not-in-org → 404). Role checks (canMutate — viewers can't mutate). Public ingestion resolved by x-org-slug header + in-memory rate limit + WebhookLog. No secrets in repo (.env has only DATABASE_URL). Input validation via zod. No raw SQL (Prisma parameterized).

Tests
- TypeScript PASS (lib + api + components clean). lint PASS. No unit/integration test files written (per "do not write test code" rule) — verified via curl integration checks + browser QA instead.

Browser QA
- Viewports verified: 1440×900, 1920×1080, 390×844. Screens: dashboard, lead list, lead detail, kanban, settings, mobile lead detail. No console errors / hydration errors after fixes.

Changed Files (substantial)
- prisma/schema.prisma (full LeadOS schema)
- src/lib/db.ts, src/lib/leados/* (constants, normalize, i18n, context, api, scoring, lost-detector, lost-detector-service, followup, duplicate, events, erp-adapter, audit-ingest, attribution, seed, lead-service, lead-score-service, dashboard-service, locale.tsx, hash-route.ts)
- src/lib/schemas/lead.ts
- src/hooks/leados/use-api.ts
- src/app/api/v1/** (30 route files)
- src/components/leados/* (app-shell, header-controls, primitives, dashboard-view, leads-view, lead-detail-view, pipeline-view, tasks-view, settings-view, lead-form-dialog, import-dialog)
- src/app/layout.tsx, src/app/providers.tsx, src/app/page.tsx

Remaining 20% (consciously deferred)
- Full pipeline/stage CRUD admin UI (currently seeded + editable scoring; pipeline config via DB).
- Custom fields CRUD UI + per-lead custom field editor (schema + values table ready; UI not built).
- Real ERP/CRM provider adapter (interface + local-mock in place).
- QuoteFlow / Automation Engine / Owner AI (integration points only — events published, button feature-flagged).
- Email/Telegram/WhatsApp notification delivery (in-app + architecture ready; channels not wired).
- Saved filters / advanced bulk actions beyond archive.
- Inbox UI for IncomingMessage (model + API ready; UI not built).
- Full analytics/BI view (dashboard metrics present; deep analytics deferred).
- Real auth (NextAuth) — demo session context with cookie-based user switching; org isolation enforced; production auth swap-in point ready.

Risks (real)
- Demo auth is cookie-based user switching (not NextAuth) — acceptable for first-client onboarding behind a controlled deployment; swap to NextAuth before public exposure.
- SQLite — fine for first client / single-org; migrate to Postgres for many concurrent tenants.
- Lost detector runs on-demand + on dashboard refresh (not a background job) — for large volumes, move to a scheduled worker.
- Prisma Json fields stored as TEXT on SQLite — fine for current scale.

FINAL VERDICT: VERIFIED_80_PERCENT_PRODUCT_READY
- First client can be onboarded WITHOUT rewriting core: create org + users (seed), configure pipeline (DB/seed), import leads (CSV), connect site (public ingest endpoint), start work — all present and verified.

---
Task ID: 4
Agent: main (cron round 1)
Task: QA current state + add Inbox, Analytics, Custom Fields features + styling polish.

QA Assessment:
- Dashboard, leads list, lead detail, kanban, tasks, settings — all render without console errors (1440×900, 1920×1080, 390×844 mobile, dark mode).
- Lost detector shows 26 leads needing attention. Duplicate detection, public ingestion, ERP sync all verified via curl.
- No bugs found in current state — proceed to new features.

Work completed this round:
1. Inbox UI (NEW):
   - lib/leados/inbox-service.ts: listMessages, getInboxStats, groupByConversation
   - API: /api/v1/inbox (GET list/stats, POST ingest), /api/v1/inbox/[id] (GET, PATCH link-to-lead, POST create-lead-from-message)
   - Hooks: useInbox, useInboxStats, useLinkMessage, useCreateLeadFromMessage
   - inbox-view.tsx: 3-pane layout (conversation list + message thread + reply stub), source filter chips (instagram/whatsapp/telegram/facebook/email/website with counts), unlinked filter, link-to-lead search, create-lead-from-message, framer-motion message entrance
   - Seed extended with 15 realistic incoming messages (5 channels, 6 linked + 4 unlinked conversations)
   - Nav badge for inbox unassigned count

2. Analytics view (NEW):
   - lib/leados/analytics-service.ts: totalLeads, won/lost/archived, conversionRate, avgResponseHours, winsBySource (count+value), lostReasons, 7-day time series, pipeline funnel (per-stage count+value), openPipelineValue, wonValue
   - API: /api/v1/analytics
   - Hook: useAnalytics
   - analytics-view.tsx: 6 KPI cards, recharts LineChart (7-day volume), vertical BarChart funnel, PieChart wins-by-source, lost-reasons progress bars. Deterministic metrics — no fake ROI.

3. Custom Fields (NEW):
   - API: /api/v1/custom-fields (GET, POST), /api/v1/custom-fields/[id] (DELETE, PATCH), /api/v1/custom-fields/[id]/values (GET, POST upsert)
   - Hooks: useCustomFields, useCreateCustomField, useDeleteCustomField, useSetCustomValue
   - settings-view.tsx: new "Custom fields" tab with create form (name/key/type/options) + list with delete. Key validation (snake_case).

4. Styling polish:
   - globals.css: custom scrollbar, focus-visible rings, leados-fade-in animation, leados-lift hover, leados-pulse for urgent badges, dense table hover
   - dashboard-view.tsx: framer-motion staggered entrance for metric cards (delay i*0.03), leados-lift on cards, leados-pulse on critical overdue indicator
   - inbox-view.tsx: framer-motion AnimatePresence for message entrance

5. i18n: added ~30 new keys per locale (hy/ru/en) for inbox, analytics, custom fields.

Verification:
- TypeScript PASS (lib + api + components clean)
- ESLint PASS (0 errors, 0 warnings)
- Dev server unreachable during this round — last log shows compile OK then dashboard 500; server process died and was not auto-restarted by the system. Code verified via tsc+lint; browser QA deferred to next round once server recovers.

Unresolved issues / risks:
- Dev server (port 3000) is currently down and not auto-restarting. Next round: verify server recovery, then run full browser QA on new Inbox/Analytics/Custom-Fields views (dark mode + mobile 390×844), and fix any visual/runtime issues found.
- Inbox reply composer is disabled (outbound adapter not connected) — by design, architecture-only as documented.
- Custom-field per-lead editor UI inside Lead Detail is the next concrete step (settings CRUD done; per-lead value editing would require a new panel section reading the org's custom fields + per-lead values).

Next-phase priorities:
1. Bring dev server back / verify it auto-restarts; run browser QA on Inbox, Analytics, Custom Fields tabs.
2. Add per-lead custom field editor inside Lead Detail (right panel section).
3. Deeper dark-mode polish on new views (inbox thread, analytics charts).
4. Consider pipeline/stage admin CRUD (currently seeded-only).

---
Task ID: 5
Agent: main (cron round 2)
Task: QA new views (Inbox/Analytics/Custom Fields) + add per-lead custom field editor + pipeline/stage CRUD + saved filters + styling polish.

QA Assessment:
- Dev server was down at start of round (crashed in round 1, not auto-restarted). Manually restarted via `nohup bash .zscripts/dev.sh`.
- All new views verified working: Inbox (4 conversations), Analytics (34 leads, 6% conversion, 1h avg response), Custom Fields (2 fields: Industry, Budget), Pipeline CRUD (8 stages with inline rename + color picker).
- Lead Detail shows Custom Fields panel with Industry/Budget editors.
- Dark mode + mobile (390×844) verified on all new views.
- Stale Turbopack cache error about inbox/route.ts (canMutate import) — file is correct, API works, error is cosmetic only.

Work completed this round:
1. Per-lead Custom Field Editor (NEW):
   - custom-fields-panel.tsx: renders org's custom fields as editable inputs (text/number/select/bool/date) with debounced auto-save (400ms)
   - Integrated into Lead Detail (after AI Summary card)
   - Lead GET API now includes customValues with field definitions
   - Key-based remount on value change (no useEffect sync needed)

2. Pipeline/Stage Admin CRUD (NEW):
   - API: /api/v1/pipeline/stages (GET, POST), /api/v1/pipeline/stages/[id] (PATCH, DELETE)
   - Hooks: useCreateStage, useUpdateStage, useDeleteStage
   - Settings → Pipeline tab: inline rename (blur to save), color picker per stage, add new stage (name + type + color), delete (blocked if leads are in the stage)
   - Changes reflect immediately in Kanban via cache invalidation

3. Saved Filters (NEW):
   - use-saved-filters.ts: localStorage-based hook (add/remove, no backend needed)
   - Leads list: saved filter chips bar appears when filters are active; "Save current" prompt with name input; click chip to apply; hover to delete
   - Persists across sessions per browser

4. Styling Polish:
   - Dashboard: framer-motion animated attention banner with leados-pulse icon, staggered metric card entrance (delay i*0.03)
   - App shell: leados-fade-in page transition on view change (key=currentView)
   - Pipeline CRUD: color swatches, inline edit borders, smooth transitions
   - All new views: consistent dark-mode styling, custom scrollbar, focus-visible rings

5. Inbox data: added 4 test incoming messages via API (instagram/telegram/whatsapp/facebook) — all unlinked, ready for link-to-lead testing.

Verification:
- TypeScript PASS (lib + api + components clean)
- ESLint PASS (0 errors, 0 warnings)
- Browser QA PASS: dashboard, leads, lead detail (with custom fields), inbox (4 conversations), analytics (charts render), settings (pipeline CRUD, custom fields CRUD), dark mode, mobile 390×844
- API checks: analytics (34 leads, 6% conversion), inbox (4 messages, 4 unassigned), custom-fields (2 fields)

Unresolved issues / risks:
- Dev server requires manual restart (nohup bash .zscripts/dev.sh) — system auto-restart not working. Next round: verify if server stays up.
- Stale Turbopack cache error about inbox route (cosmetic, doesn't affect functionality).
- Inbox reply composer still disabled (outbound adapter not connected — by design).

Next-phase priorities:
1. Verify dev server stability across rounds.
2. Notification channel adapters (email/Telegram/WhatsApp delivery — architecture ready, channels not wired).
3. Real auth (NextAuth) — demo session context works but needs production auth.
4. Deeper analytics: response time distribution, source ROI, team performance.
5. Saved filters sync to backend (currently localStorage only).

---
Task ID: 6
Agent: main (cron round 3)
Task: QA + add Team Performance view, Source ROI analytics, enhanced CSV export, styling polish.

QA Assessment:
- Dev server stable (HTTP 200) — survived from round 2's manual restart.
- All views verified: dashboard, leads, lead detail, inbox (4 conversations), analytics, pipeline kanban, tasks, settings. No console errors.
- Dark mode + mobile (390×844) verified on all views.

Work completed this round:
1. Team Performance view (NEW — #team):
   - lib/leados/team-service.ts: per-user metrics (totalAssigned, active, won, lost, conversionRate, overdueTasks, openTasks, avgResponseHours, wonValue, pipelineValue)
   - API: /api/v1/team
   - Hook: useTeamPerformance
   - team-view.tsx: team KPI row (6 cards), recharts BarChart (won vs active per user), user cards grid with avatar + metrics + response time + overdue + won/pipeline value, framer-motion staggered entrance
   - Nav entry "Team" added

2. Source ROI analytics (NEW):
   - analytics-service.ts extended: sourceRoi[] with per-source (type, name, count, won, lost, value, conversion)
   - analytics-view.tsx: Source ROI table with source icons, color-coded conversion badges, won value per source — for ad spend decisions
   - 11 sources tracked (Website, Business Audit, Instagram, Referral, Google Ads, etc.)

3. Enhanced CSV export (NEW):
   - Export now includes utmSource, utmCampaign (attribution) columns
   - Custom field values appended as cf_<key> columns (text/number/bool/date)
   - take: 2000 leads, includes attributions + customValues

4. Styling polish:
   - globals.css: skeleton shimmer animation (leados-skeleton), chart text color vars (recharts), dialog backdrop blur, tab indicator transition, tabular-nums utility
   - Dark mode charts: recharts text uses var(--muted-foreground) for proper dark contrast
   - Team view: leados-lift hover on user cards, motion staggered entrance

5. i18n: added nav.team key (HY: Թիմ, RU: Команда, EN: Team)

Verification:
- TypeScript PASS (lib + api + components clean)
- ESLint PASS (0 errors, 0 warnings)
- Browser QA PASS: team view (4 users, chart renders), analytics with Source ROI table (11 sources), dark mode, mobile 390×844
- API checks: team (4 users — David 13 assigned/1 won, Narek 13/1, Aram 0/0, Lilit 0/0), sourceRoi (11 entries — Website 9 leads/1 won/11%, Business Audit 5/1/20%)
- CSV export verified: includes utmSource, utmCampaign columns

Unresolved issues / risks:
- Dev server requires manual restart if it crashes (system auto-restart not reliable). Currently stable from round 2's nohup restart.
- Inbox reply composer still disabled (outbound adapter not connected — by design).
- Real auth (NextAuth) still deferred — demo session works with org isolation.

Next-phase priorities:
1. Notification channel adapters (email/Telegram/WhatsApp delivery).
2. Real auth (NextAuth) for production.
3. Saved filters sync to backend (currently localStorage).
4. Deeper analytics: response time distribution, trend over time.
5. Pipeline stage reordering (drag to reorder positions).

---
Task ID: 7
Agent: main (cron round 4)
Task: QA + add bulk lead operations, pipeline stage drag-reorder, activity trend analytics, styling polish.

QA Assessment:
- Dev server stable (HTTP 200). All 8 nav views verified without console errors.
- No bugs found — proceeded to new features.

Work completed this round:
1. Bulk Lead Operations (NEW):
   - API: /api/v1/leads/bulk (POST) — actions: assign, stage, archive, priority
   - Hook: useBulkLeads with full cache invalidation
   - Leads list bulk bar: redesigned with count badge, 3 dropdowns (Assign to / Move to stage / Priority) + Archive button
   - All bulk actions emit activities + events (LEAD_ASSIGNED, STAGE_CHANGED, LEAD_ARCHIVED with bulk:true payload)
   - Server-side org isolation + role check on every bulk action

2. Pipeline Stage Drag Reorder (NEW):
   - settings-view.tsx PipelineTab: dnd-kit SortableContext with verticalListSortingStrategy
   - Drag handle (GripVertical) per stage, visual feedback (shadow + ring on drag)
   - onDragEnd persists new positions via updateStage mutation
   - SortableStage component: color picker, inline rename, type badge, delete button, loading spinner
   - Keyboard accessible (sortableKeyboardCoordinates)

3. Activity Trend Analytics (NEW):
   - analytics-service.ts: trend30 (30-day new leads + won per day), respBuckets (0-1h, 1-4h, 4-24h, 1-3d, 3d+, none)
   - analytics-view.tsx: 30-day heatmap (grid of colored squares with intensity = lead count, green dot for won days), response time distribution (color-coded progress bars per bucket)
   - Legend with less/more gradient

4. Styling Polish:
   - Bulk bar: shadow-sm, count badge in primary circle, responsive flex-wrap
   - Sortable stages: shadow-lg + ring on drag, cursor-grab handle
   - Heatmap: aspect-square cells, color-mix for intensity, tooltip on hover
   - Response distribution: color-coded buckets (green→red gradient by urgency)

Verification:
- TypeScript PASS (lib + api + components clean)
- ESLint PASS (0 errors, 0 warnings)
- Browser QA PASS: analytics with 30-day heatmap + response distribution, pipeline sortable stages (drag handles visible), bulk actions (Assign/Move/Priority dropdowns), dark mode, mobile 390×844
- API checks: trend30 (30 days), respBuckets (0-1h:26, none:8), bulk API (correctly rejects non-org leads with "no-leads-in-org")

Unresolved issues / risks:
- Dev server stable from round 2's manual restart — still not auto-restarting if it crashes.
- Inbox reply composer still disabled (by design).
- Real auth (NextAuth) still deferred.

Next-phase priorities:
1. Notification channel adapters (email/Telegram/WhatsApp delivery).
2. Real auth (NextAuth) for production.
3. Saved filters sync to backend (currently localStorage).
4. Lead assignment round-robin / auto-assignment rules.
5. Webhook outgoing events (for Automation Engine subscribers to consume).

---
Task ID: 8
Agent: main (cron round 5)
Task: QA + add Saved Filters backend sync, Assignment Rules (auto-assignment), Webhook Events viewer.

QA Assessment:
- Dev server stable (HTTP 200). All 8 nav views verified without console errors.
- No bugs found — proceeded to new features.

Work completed this round:
1. Saved Filters Backend Sync (NEW):
   - Prisma model: SavedFilter (organizationId, userId, name, query JSON, isShared, timestamps)
   - API: /api/v1/saved-filters (GET list — own + shared, POST create), /saved-filters/[id] (PATCH, DELETE)
   - Hooks: useSavedFiltersApi, useCreateSavedFilterApi, useDeleteSavedFilterApi
   - use-saved-filters.ts rewritten as hybrid: backend-first with localStorage fallback; merges both sources, dedupes by name+query
   - Filters sync across devices when authenticated; shared filters visible to whole org

2. Lead Auto-Assignment Rules (NEW):
   - Prisma model: AssignmentRule (organizationId, name, sourceId?, sourceType?, priority?, assigneeId, enabled, position)
   - API: /api/v1/assignment-rules (GET, POST), /assignment-rules/[id] (PATCH, DELETE)
   - Hooks: useAssignmentRules, useCreateAssignmentRule, useUpdateAssignmentRule, useDeleteAssignmentRule
   - lead-service.ts: resolveAutoAssignee() — evaluates rules in position order, first match wins, deterministic (NOT AI)
   - Settings → "Assignment Rules" tab: rule list with position badges, source/priority conditions, assignee avatar, enable/disable toggle, delete; add-rule form with source/priority/assignee dropdowns
   - Verified end-to-end: created "Instagram leads" rule → new instagram lead auto-assigned to manager

3. Webhook Outgoing Events Viewer (NEW):
   - API: /api/v1/webhooks/events (GET — list IntegrationEvents with byEvent summary, filterable by event type)
   - Hook: useWebhookEvents
   - Settings → ERP/Events tab: WebhookEventsTab shows recent published events with event-type badges, lead context, published indicator, timestamp; summary counts by event type at top
   - Documents the event architecture for future Automation Engine subscribers

4. Styling Polish:
   - Assignment rules: position number badges, toggle switches, condition badges, avatar inline
   - Webhook events: published dot indicator, monospace event names, summary badges
   - Saved filters: backend filters merge with local, shared filter indicator

Verification:
- TypeScript PASS (lib + api + components clean)
- ESLint PASS (0 errors, 0 warnings)
- Browser QA PASS: assignment rules tab (rule visible, toggle, add form), webhook events tab (events list with summary), saved filters in leads (backend "Urgent leads" filter appears), dark mode, mobile 390×844
- API checks: saved-filters (create+list works), assignment-rules (create works), webhooks/events (5 events: 4 lead.created + 1 audit.completed)
- Auto-assign verified: instagram lead created without owner → automatically assigned to manager per rule

Unresolved issues / risks:
- Dev server crashed once mid-round (needed manual nohup restart). After restart, stable.
- Webhook delivery to external URLs not implemented (events are published to DB; a background worker would poll + deliver in production).
- Real auth (NextAuth) still deferred.

Next-phase priorities:
1. Webhook URL registration + background delivery worker.
2. Real auth (NextAuth) for production.
3. Notification channel adapters (email/Telegram/WhatsApp delivery).
4. Assignment rule drag-reorder (currently position-based via create order).
5. Lead assignment round-robin (distribute evenly among a group, not just first-match).

---
Task ID: 9
Agent: main (cron round 6)
Task: QA + add Webhook URL registration + delivery, Lead restore from archive, archived leads view.

QA Assessment:
- Dev server stable (HTTP 200). All 8 nav views verified without console errors.
- No bugs found — proceeded to new features.

Work completed this round:
1. Webhook URL Registration + Delivery (NEW):
   - Prisma model: WebhookEndpoint (organizationId, name, url, secret, events, enabled, lastDeliveryAt, lastStatus, failCount)
   - API: /api/v1/webhooks/endpoints (GET, POST), /endpoints/[id] (PATCH, DELETE), /endpoints/[id]/test (POST)
   - lib/leados/webhook-delivery.ts: deliverPendingEvents() + testEndpoint() with HMAC-SHA256 signing (X-Leados-Signature header), 10s timeout, fail tracking
   - Hooks: useWebhookEndpoints, useCreateWebhookEndpoint, useDeleteWebhookEndpoint, useTestWebhookEndpoint
   - Settings → ERP/Events tab: WebhookEndpointsTab with endpoint list (status dot, fail count, last delivery), add-endpoint form (name/url/events), Test button per endpoint
   - Verified: created "Test Hook" → httpbin.org/post, test delivery returned HTTP 200

2. Lead Restore from Archive (NEW):
   - lead-service.ts: restoreLead() — unarchives lead, restores status based on stage type (won/lost/open)
   - API: /api/v1/leads/[id]/restore (POST)
   - Hook: useRestoreLead
   - Leads list: "📦 Archived" toggle filter shows archived leads with Restore button per row
   - Verified: archive → status=ARCHIVED, restore → status=NEW (restored correctly)

3. Styling Polish:
   - Webhook endpoints: status dot (emerald=OK, red=FAILED, gray=none), fail count badge, monospace URL, event filter badge
   - Archived leads: dedicated Actions column with Restore button, colSpan adjusts dynamically
   - Archived toggle: distinct zinc styling to differentiate from active filters

Verification:
- TypeScript PASS (lib + api + components clean)
- ESLint PASS (0 errors, 0 warnings)
- Browser QA PASS: webhook endpoints tab (endpoint visible, Test button works), archived leads (toggle + Restore buttons), dark mode, mobile 390×844
- API checks: webhook endpoints (create+list+test all work, test delivery HTTP 200), lead restore (archive→ARCHIVED, restore→NEW)

Unresolved issues / risks:
- Dev server required restart mid-round (Prisma client cache needed refresh after schema change). After restart, stable.
- Webhook delivery is on-demand (test endpoint); background worker for automatic delivery not implemented.
- Real auth (NextAuth) still deferred.

Next-phase priorities:
1. Background webhook delivery worker (cron-like polling of undelivered events).
2. Real auth (NextAuth) for production.
3. Notification channel adapters (email/Telegram/WhatsApp delivery).
4. Kanban quick-view hover card (preview lead without navigation).
5. Lead merge UI improvements (field selection).

---
Task ID: 10
Agent: main (cron round 7)
Task: QA + add Kanban hover preview, Lead merge dialog with field selection, notification center improvements, styling polish.

QA Assessment:
- Dev server stable (HTTP 200). All 8 nav views verified without console errors.
- No bugs found — proceeded to new features.

Work completed this round:
1. Kanban Quick-View Hover Card (NEW):
   - pipeline-view.tsx: HoverCard wrapping each draggable card (400ms open delay, 150ms close)
   - LeadQuickPreview component: fetches full lead via useLead, shows avatar, name, company, priority badge, score, stage, phone/email/source, owner, next action (red if overdue), last contact, summary (2-line clamp), "Open lead" button
   - Lazy-loads lead data only on hover (no upfront cost for kanban rendering)

2. Lead Merge Dialog with Field Selection (NEW):
   - lead-detail-view.tsx: MergeDialog component with field comparison table
   - Side-by-side comparison: Field / This lead (target) / Duplicate (source) / Use source checkbox
   - 9 fields compared (firstName, lastName, company, phone, email, summary, requirements, estimatedValue, priority)
   - Rows with differences highlighted amber; checkboxes disabled for identical or empty source fields
   - Pre-merge: copies selected source fields to target via PATCH, then merges (archives source, moves activities/tasks/notes/events/tags)
   - Count badge shows how many fields will be copied

3. Notification Center Improvements (NEW):
   - header-controls.tsx: NotificationsBell redesigned
   - Unread count badge (number instead of dot, "9+" for >9)
   - "Mark all read" button in dropdown header
   - Per-notification: blue unread dot, title, message, relative timestamp (now/Xm/Xh/Xd)
   - Unread items highlighted with primary/5 background
   - Empty state with Bell icon + message
   - Wider dropdown (w-96), up to 20 items shown

4. Styling Polish:
   - Dashboard header: gradient text (from-foreground to-foreground/70, bg-clip-text)
   - Merge dialog: amber accent for merge action, comparison table with highlighted diff rows
   - Notification badge: min-width pill with bold count

Verification:
- TypeScript PASS (lib + api + components clean)
- ESLint PASS (0 errors, 0 warnings)
- Browser QA PASS: kanban hover preview (shows lead details + Open button), merge dialog (field comparison table with checkboxes), notifications (Mark all read + unread indicators + timestamps), dark mode, mobile 390×844
- Merge dialog verified: created duplicate lead → banner shows → dialog opens with field comparison

Unresolved issues / risks:
- Dev server stable throughout this round (no restart needed).
- Webhook background delivery worker still not implemented (on-demand test only).
- Real auth (NextAuth) still deferred.

Next-phase priorities:
1. Background webhook delivery worker (cron-like polling).
2. Real auth (NextAuth) for production.
3. Notification channel adapters (email/Telegram/WhatsApp delivery).
4. Kanban card quick-actions (inline assign/change-stage without opening lead).
5. Lead activity timeline export (PDF/CSV for client reports).

---
Task ID: 11
Agent: main (cron round 8)
Task: QA + add Lead activity timeline export, Duplicate scanner tool, styling polish.

QA Assessment:
- Dev server stable (HTTP 200). All 8 nav views verified without console errors.
- No bugs found — proceeded to new features.

Work completed this round:
1. Lead Activity Timeline Export (NEW):
   - API: /api/v1/leads/[id]/export-activity (GET) — exports full lead timeline as CSV
   - CSV includes: Lead summary (name, company, contact, status, priority, score, created), Activities (date, type, title, user), Tasks (created, due, status, title, assignee), Notes (date, author, content), Events/audit trail (date, type, user), Business audits (6 scores + summary)
   - Lead Detail header: "Export" button (Download icon) opens CSV download in new tab
   - Filename: leados-<company>-activity-<date>.csv (sanitized)
   - Verified: HTTP 200, Content-Type text/csv, full CSV with all sections

2. Duplicate Lead Scanner (NEW):
   - API: /api/v1/leads/duplicates-scan (GET) — scans all active leads, groups by normalized phone/email
   - Returns groups with matched leads, reason (phone/email), matchValue
   - Hook: useDuplicatesScan
   - duplicates-scanner.tsx: DuplicatesScanner component with dialog
   - Leads list header: "Find duplicates" button with count badge (amber, shows group count)
   - Dialog: shows scanned count, found count, per-group cards with lead comparison
   - Each group: first lead marked "KEEP", others have "Merge into ↑" button
   - Merge action: archives source, moves all related records, navigates to target lead
   - Empty state: emerald checkmark "No duplicates found"
   - Verified: scanned 36 leads, found 1 group, merge button works

3. Styling Polish:
   - Duplicate scanner: amber-themed cards with reason badges, KEEP label in emerald
   - Export button: Download icon, opens in new tab
   - Count badge on Find duplicates button (amber, min-width pill)

Verification:
- TypeScript PASS (lib + api + components clean)
- ESLint PASS (0 errors, 0 warnings)
- Browser QA PASS: duplicates scanner dialog (groups visible, KEEP/Merge buttons), Export button on lead detail, dark mode, mobile 390×844
- API checks: duplicates-scan (1 group, 36 leads scanned), export-activity (HTTP 200, text/csv)

Unresolved issues / risks:
- Dev server stable throughout this round (no restart needed).
- Webhook background delivery worker still not implemented.
- Real auth (NextAuth) still deferred.

Next-phase priorities:
1. Background webhook delivery worker (cron-like polling).
2. Real auth (NextAuth) for production.
3. Notification channel adapters (email/Telegram/WhatsApp delivery).
4. Kanban card quick-actions (inline assign/change-stage without opening lead).
5. Lead batch operations: bulk merge suggestions from duplicate scanner.

---
Task ID: 12
Agent: main (cron round 9)
Task: QA + add Kanban card quick-actions, Lead SLA response time badges, Markdown notes support.

QA Assessment:
- Dev server stable (HTTP 200). All 8 nav views verified without console errors.
- No bugs found — proceeded to new features.

Work completed this round:
1. Kanban Card Quick-Actions (NEW):
   - pipeline-view.tsx: LeadCard now has a 3-dot menu (MoreVertical) that appears on hover
   - Dropdown menu with: Move to stage (all stages with color dots, excludes current), Assign to (all users with avatars, current owner marked), Open lead detail
   - Uses useAssignLead + useSetLeadStage hooks with toast feedback
   - stopPropagation prevents card click navigation when interacting with menu

2. Lead SLA Response Time Badges (NEW):
   - response-sla-badge.tsx: ResponseSlaBadge component
   - Color-coded: emerald (<1h responded), sky (new <1h), amber (1-4h), orange (4-24h), red (>24h or no response)
   - Shows response time from lead creation to first contact, or time waiting if no contact yet
   - Won/Lost/Archived leads don't show SLA
   - Added to: Kanban cards (next to score badge), Leads list table (next to score badge)
   - Thresholds: 1h target, 4h warning, 24h breach (deterministic, configurable)

3. Markdown Notes Support (NEW):
   - lead-detail-view.tsx NotesTab: full markdown editor with toolbar
   - Toolbar: Bold (B), Italic (I), Code (<>), Bullet list (•), Heading (H), Link (🔗)
   - Write/Preview toggle tabs — Preview renders markdown via ReactMarkdown
   - Notes display rendered markdown (prose styling, dark mode support)
   - Textarea uses monospace font for editing
   - insertMd helper: wraps/inserts markdown syntax at cursor position

4. Styling Polish:
   - Kanban cards: group-hover reveals quick-actions menu button (opacity transition)
   - SLA badges: inline-flex with icons (CheckCircle2 for responded, AlertTriangle for breach)
   - Notes: prose styling for rendered markdown, dark:prose-invert for dark mode
   - Toolbar buttons: bordered, hover-accent, active state for Write/Preview tabs

Verification:
- TypeScript PASS (lib + api + components clean)
- ESLint PASS (0 errors, 0 warnings)
- Browser QA PASS: kanban quick-actions menu (stage list + assignee list + open detail), SLA badges in leads list ("new" badge visible), markdown notes toolbar (Bold/List/Heading/Write/Preview), dark mode, mobile 390×844
- Quick-actions verified: menu opens with Move to stage + Assign to + Open lead detail options

Unresolved issues / risks:
- Dev server stable throughout this round (no restart needed).
- Webhook background delivery worker still not implemented.
- Real auth (NextAuth) still deferred.

Next-phase priorities:
1. Background webhook delivery worker (cron-like polling).
2. Real auth (NextAuth) for production.
3. Notification channel adapters (email/Telegram/WhatsApp delivery).
4. SLA configuration in Settings (currently hardcoded thresholds).
5. Lead activity timeline with visual timeline component (not just list).

---
Task ID: 13
Agent: main (cron round 10)
Task: QA + add Visual activity timeline, SLA configuration in Settings, styling polish.

QA Assessment:
- Dev server stable (HTTP 200). All 8 nav views verified without console errors.
- No bugs found — proceeded to new features.

Work completed this round:
1. Visual Activity Timeline Component (NEW):
   - activity-timeline.tsx: ActivityTimeline component with vertical timeline
   - Type-specific icons + colors: CALL (sky/Phone), MESSAGE (violet/MessageSquare), EMAIL (indigo/Mail), MEETING (purple/Calendar), FOLLOW_UP (amber/Bell), NOTE (slate/StickyNote), STAGE_CHANGE (blue/ArrowLeftRight), ASSIGNMENT (emerald/UserPlus), AUDIT_IMPORT (teal/FileText), SYSTEM_EVENT (slate/Zap)
   - Gradient vertical line (from-border via-border to-transparent)
   - Each entry: circular icon node (8x8, colored bg), user name, type badge, timestamp (revealed on hover), title, description
   - Empty state: icon + "No activity yet" + hint
   - Replaced ActivityTab's simple list with ActivityTimeline
   - Quick-log bar improved: emoji-prefixed dropdown labels (📞 Call, 💬 Message, ✉️ Email, etc.), Enter key to submit

2. SLA Configuration in Settings (NEW):
   - sla-config-tab.tsx: SlaConfigTab component
   - 3 configurable thresholds: Target (green, default 1h), Warning (amber, 4h), Breach (red, 24h)
   - Color-coded labels with indicator dots
   - Live preview showing badge colors at each threshold range
   - Saved as Setting row (key: "sla_thresholds", value: JSON) via /api/v1/settings POST
   - Settings API extended: POST now supports key/value upsert for arbitrary settings
   - Settings → "SLA" tab added

3. Styling Polish:
   - Timeline: gradient vertical line, hover reveals timestamp, icon nodes with colored backgrounds
   - SLA config: color-coded threshold inputs with descriptions, live preview badges
   - Activity quick-log: emoji icons in dropdown, border-bottom separator, Enter-to-submit
   - Empty states: centered with icon + message + hint

Verification:
- TypeScript PASS (lib + api + components clean)
- ESLint PASS (0 errors, 0 warnings)
- Browser QA PASS: activity timeline (icons, badges, timestamps visible), SLA config tab (3 thresholds with preview), dark mode, mobile 390×844
- Activity timeline verified: shows "Aram Grigoryan / STAGE CHANGE / 2h ago / Stage changed to Qualified"

Unresolved issues / risks:
- Dev server stable throughout this round (no restart needed).
- SLA thresholds are stored in DB but ResponseSlaBadge still uses hardcoded values — next step: wire badge to config.
- Webhook background delivery worker still not implemented.
- Real auth (NextAuth) still deferred.

Next-phase priorities:
1. Wire ResponseSlaBadge to use configured SLA thresholds from Settings (currently hardcoded).
2. Background webhook delivery worker (cron-like polling).
3. Real auth (NextAuth) for production.
4. Notification channel adapters (email/Telegram/WhatsApp delivery).
5. Enhanced command palette with quick actions (create lead, navigate, search).

---
Task ID: sla-1
Agent: main
Task: Connect FIRST RESPONSE SLA to real leads (inspect phase)

Work Log:
- Moved cloned repo HayDevLeadsOS/* into /home/z/my-project root (env expects project at root; .env DATABASE_URL points to db/custom.db). Preserved GitHub remote.
- bun install, prisma generate + db push OK. Dev server running on :3000.
- INSPECTED: prisma schema (Lead.createdAt idx, Activity idx [leadId,createdAt], Setting org-scoped unique key, no persisted firstResponseAt), constants.ts (ACTIVITY_TYPE, FOLLOWUP), lead-service.ts, leads route (pagination limit<=200, filters, sort allowed list, default createdAt:desc), settings route (POST upsert Setting, NO validation), sla-config-tab.tsx (key "sla_thresholds", format {target,warning,breach} hours, no validation, non-shared preview, dead PATCH org call), response-sla-badge.tsx (HARDCODED 1/4/24h, uses lastContactAt — wrong semantics), leads-view.tsx (SLA badge inside Score column, no sort selector), lead-detail-view.tsx (no SLA), kanban route (no SLA), dashboard-service (no SLA KPI), seed.ts (activities at created+1h for leads with lastContactHoursAgo), use-api.ts (useLogActivity does NOT invalidate leads list), i18n hy/ru/en flat keys.

Stage Summary:
- DEFINED SLA SEMANTICS: FIRST RESPONSE SLA. Qualifying activities = CALL, MESSAGE, EMAIL, MEETING (NOTE does NOT close SLA). States: RESPONDED | TARGET (elapsed<=target) | WARNING (target<elapsed<breach, visual escalation at warning) | BREACH (elapsed>=breach). Matches existing Settings 4-band preview.
- Thresholds: Setting key "sla_thresholds" {target,warning,breach} hours, org-scoped. ONE fallback DEFAULT in lib/sla.ts.
- Architecture: lib/sla.ts PURE engine (client+server+tests); lib/leados/sla-service.ts server-only (loader, grouped activity query, prisma filters, batch attach, breach count). No schema change (dynamic computation, volumes small). SLA sort = 2-phase (light id fetch + grouped activities + JS rank sort + page hydrate). sla filter = server-side prisma where (none-qualifying + createdAt cutoffs).
- UI: sla/sla-badge.tsx (shared, client engine + shared 60s tick + popover details), sla/sla-detail.tsx (lead detail header card), replace response-sla-badge.tsx, leads-view SLA column + SLA filter select + sort select (default SLA Priority), settings validation + shared preview, dashboard slaBreached KPI, useLogActivity invalidates leads/kanban/dashboard.

---
Task ID: sla-2
Agent: main
Task: FIRST RESPONSE SLA — implementation, connection, QA and final verification.

Work Log:
- IMPLEMENTED lib/sla.ts (PURE engine, single source of truth): SLA_KIND.FIRST_RESPONSE, SlaStatus (TARGET|WARNING|BREACH|RESPONDED), SlaThresholds, SlaResult, DEFAULT_SLA_THRESHOLDS (the ONLY fallback), QUALIFYING_ACTIVITY_TYPES (CALL/MESSAGE/EMAIL/MEETING — NOTE/system events excluded), validateSlaThresholds, parseSlaThresholds, computeFirstResponseSla, compareLeadsBySlaPriority, humanizeDuration.
- IMPLEMENTED lib/leados/sla-service.ts (server): getSlaThresholds (1 query + 15s cache + invalidation), getFirstResponseMap (ONE groupBy), attachSlaToLeads, slaFilterWhere (Prisma where fragments for all 4 states), countSlaBreached, sortLeadIdsBySlaPriority (2-phase: light id fetch + groupBy + JS rank + page hydrate).
- CONNECTED Settings API: POST validates sla_thresholds (target<warning<breach, >0, finite) → HTTP 400 with readable errors; GET now returns settings rows (old tab never loaded saved values — fixed).
- CONNECTED Leads API: rows[].sla + response.slaConfig, ?sla=BREACH|WARNING|TARGET|RESPONDED server-side filter (works with pagination+counts), sort=sla:priority default-priority order.
- CONNECTED Lead Detail API (lead.sla + slaConfig), Kanban API (cards sla + slaConfig), Dashboard (metrics.slaBreached — real count), Export API (sla filter + slaStatus/slaElapsed/slaFirstResponse CSV columns).
- UI: components/leados/sla/sla-badge.tsx (shared badge: text+color, click-popover details with Created/Target/Warning/Breach/Elapsed/Breach-in|Breached-by/First-response — touch/keyboard friendly, not hover-only), sla/sla-detail.tsx (compact header card with countdown + thresholds + lead age), use-sla-tick.ts (ONE shared 60s timer via useSyncExternalStore — no per-row timers). DELETED response-sla-badge.tsx (hardcoded 1/4/24, wrong lastContactAt semantics).
- Leads view: dedicated SLA column (old badge was inside Score column), SLA filter select (All/Target/Warning/Breached/Responded), Sort select with SLA Priority DEFAULT (user override preserved — explicit choice wins), breached rows tinted, slaConfig threaded from API.
- SlaConfigTab rebuilt: shared SlaBadge PREVIEW (same component as production — cannot diverge), client validation with inline errors + disabled Save, single POST save, invalidates settings/leads/lead/kanban/dashboard so badges recompute immediately.
- useLogActivity now invalidates leads/kanban/dashboard → qualifying activity flips RESPONDED without manual refresh. useLeads supports sla param; useLead/useKanban/useDashboard types extended.
- i18n: sla.* + common.sort.* keys in hy/ru/en.
- Seed: createdAtMinutesAgo/firstResponseAfterMinutes/responseType/firstNoteAfterMinutes fields; SLA demo coverage — Tigran TARGET(35m), Anna WARNING(2.5h), Irina escalated WARNING(8h), Robert BREACH(48h, has NOTE which must NOT close SLA), responded leads with varied first-response times (25m/45m/55m/130m, EMAIL/MEETING types). Seeds sla_thresholds Setting row.
- tests/sla.test.ts (bun test): 28 tests / 71 assertions — states, qualifying types, settings validation (all invalid cases from requirements), thresholds-drive-states, sort order (D,B,C,A,E dataset), humanization, edge cases (future timestamps, merge artifacts, missing settings).

QA & REPAIR LOOPS:
- LOOP 1 (semantics): verified end-to-end — NOTE on breached Robert did NOT close SLA; MESSAGE → RESPONDED with responseMinutes=2904 (=full age). First-response elapsed freezes after response.
- LOOP 2 (settings): invalid values → 400 (all 4 cases); change 1/4/24→0.5/2/8 → Tigran TARGET→WARNING, Irina WARNING→BREACH, restore → back. Dashboard KPI consistent with filter count (133=133 at 500-lead scale).
- LOOP 3 (sort): Lyudmila (most breached) first in list; API sort verified on 5-lead dataset (D,B,C,A,E order).
- LOOP 4 (filter): server-side on full dataset; UI select test: Tigran/Marina/Irina absent with Breached selected; search+filter combo works; KPI card → #/leads?sla=BREACH with filter pre-applied.
- LOOP 5 (response): MESSAGE on breached lead → RESPONDED instantly (list invalidated).
- LOOP 6 (performance): N+1 impossible by construction (1 settings read + 1 groupBy). Scale test 500 leads: sla:priority 20ms flat, breach filter 24ms, kanban 16ms, dashboard 66ms. Synthetic leads cleaned up after test.
- LOOP 7 (UI): strengthened breached row tint; badges verified readable in light+dark; KPI labels truncate by design.
- LOOP 8 (mobile 390x844): leads list, lead detail (SLA card wraps correctly, red readable), settings validation readable. No critical defects.

Verification: TS 0 errors in src/, ESLint clean, production build PASS, 28/28 unit tests, browser QA (13 screenshots in download/sla-qa/), no console errors.

Stage Summary:
- FIRST RESPONSE SLA fully connected to real leads: Settings → thresholds → engine → Lead List/Detail/Kanban/Dashboard/Export. No hardcoded thresholds in UI. VERIFIED_COMPLETE.

---
Task ID: followup-1
Agent: main
Task: FOLLOW-UP SLA (second independent SLA layer) — inspection + definition

Work Log (INSPECT):
- Schema: Task{leadId?, dueAt?, status TODO/IN_PROGRESS/DONE/CANCELLED, completedAt?, NO type column}; Activity has FOLLOW_UP type (amber Bell in timeline); Lead has legacy nextActionAt/nextActionLabel (auto-suggested by suggestNextAction on stage change/activity — the "blind scheduling" anti-pattern); Setting org-scoped key/value (existing key "sla_thresholds").
- First-response SLA (VERIFIED_COMPLETE, do not touch): lib/sla.ts pure engine; sla-service.ts (thresholds loader + 15s cache, firstResponseMap groupBy, attachSlaToLeads, slaFilterWhere, sortLeadIdsBySlaPriority 2-phase, countSlaBreached); APIs: leads (?sla=, sort=sla:priority), lead detail, kanban, dashboard slaBreached, export; UI: SlaBadge/SlaDetail, leads-view column+filter+sort, settings SlaConfigTab with validation+shared preview; 28 tests in tests/sla.test.ts.
- Tasks API: POST /api/v1/tasks + /api/v1/leads/[id]/tasks (no type), PATCH /api/v1/tasks/[id] (status DONE sets completedAt). TaskCreate schema has no type. Kanban LeadCard shows compact SlaBadge. Dashboard has 9 KPI tiles incl. legacy overdueFollowups (nextActionAt < now — old field-based concept) + overdueTasks list. Leads list has legacy "⏱ Overdue" button (nextActionAt < now) + "Next action" column (nextActionAt).
- Activity POST: updates lastContactAt, auto-suggests nextActionAt if none (legacy). i18n flat keys hy/ru/en. Seed: 30 leads, tasks "Follow up with X" for HIGH/URGENT (untyped), SLA demo coverage.

Stage Summary (DEFINE — approved design):
- SOURCE OF TRUTH: OPTION A task-based. Add Task.type column ("TASK" | "FOLLOW_UP", default "TASK") — minimal non-destructive schema change (db push, safe). Deadline = task.dueAt. Completion = task status DONE + completedAt (Section 10 source of truth). Cycles = one task per follow-up; completed tasks stay as history; new schedule = new task = new cycle.
- nextFollowUpTask = earliest open (TODO/IN_PROGRESS) FOLLOW_UP task by dueAt asc (nulls last); at most ONE open follow-up per lead enforced by service.
- STATES: NOT_REQUIRED | SCHEDULED | DUE_SOON | OVERDUE | COMPLETED. NOT_REQUIRED = (no qualifying first response) OR (status WON/LOST/ARCHIVED) OR (no follow-up task at all). SCHEDULED = open task, dueAt null or > now+warningBeforeHours. DUE_SOON = dueAt in (now, now+warningBeforeHours]. OVERDUE = dueAt <= now. COMPLETED = no open task + a DONE task exists (cycle closed).
- ENGINE: src/lib/sla-followup.ts (pure, imports shared primitives from lib/sla.ts — zero refactor of first-response file). SLA_KIND extended with FOLLOW_UP (additive). computeFollowUpSla({leadStatus, firstResponseAt, task, lastCompleted}, config, now).
- CONFIG: Setting key "followup_sla" = {warningBeforeHours: 4, defaultFollowUpHours: 24, autoCreateAfterFirstResponse: false}. Validation: both > 0, warning < default. Server 400 + client inline errors + disabled save. autoCreate default OFF (Section 15) — when ON, first qualifying activity creates follow-up at +defaultFollowUpHours.
- SERVER: src/lib/leados/followup-sla-service.ts — getFollowUpConfig (cache+invalidate), getFollowUpTaskMap (2 queries per batch: open FU tasks + latest DONE FU task), attachFollowUpToLeads, followUpFilterWhere (SCHEDULED/DUE_SOON/TODAY/OVERDUE/COMPLETED/NONE — includes active-status + has-response conditions for exact engine parity), counts for dashboard, scheduleFollowUp/completeFollowUp/rescheduleFollowUp/cancelFollowUpsForFinalStage.
- WON/LOST: changeStage cancels open FU tasks (status CANCELLED, rows kept) + timeline activity; engine returns NOT_REQUIRED for final/archived leads defensively. Reopened lead: old cycles stay closed, new schedule allowed.
- SORT: first-response sla:priority stays DEFAULT. New option sort=followup:urgency (OVERDUE most-overdue-first → DUE_SOON earliest → SCHEDULED earliest → COMPLETED → NOT_REQUIRED).
- NEW API: POST /api/v1/leads/[id]/followup {dueAt, note?} schedule; PATCH {action: complete|reschedule|cancel, dueAt?, taskId?, note?}.
- TIMELINE: FOLLOW_UP activities with metadata.action SCHEDULED/COMPLETED/RESCHEDULED/CANCELLED + LEAD_EVENT.FOLLOW_UP_* published (webhook-ready).
- LEAD LIST: replace "Next action" column with "Follow-up" (FollowUpBadge + date); replace legacy "⏱ Overdue" button with Follow-up filter select (All/Scheduled/Due today/Due soon/Overdue/No follow-up); add followup:urgency sort option.
- LEAD DETAIL: compact FollowUpBadge in header next to SlaDetail; right panel "Next follow-up" card with Complete/Reschedule/Schedule actions + quick options Tomorrow/+3d/+7d/Custom; ActivityTab quick-log gains optional "then follow up in" select (None/Standard/Tomorrow/+3d/+7d).
- KANBAN: compact FollowUpBadge on cards when DUE_SOON/OVERDUE.
- DASHBOARD: legacy overdueFollowups tile rewired to real engine count (click → ?followUp=OVERDUE); new "Today" work queue card (overdue follow-ups, follow-ups due today, meetings today, tasks due today) with clicks.
- SETTINGS: SLA tab gets a second card "Follow-up SLA" (own key, own validation, shared FollowUpBadge preview, invalidates follow-up surfaces).
- DEMO: seed Leads A(scheduled tomorrow)/B(due in 2h)/C(overdue 5h)/D(completed cycle)/E(no follow-up) + followup_sla Setting + type on existing FU tasks.
- I18N: followup.* keys in hy/ru/en. Timezone: TODAY boundaries computed in org timezone (Asia/Yerevan default), storage UTC, display local.
- TESTS: tests/followup-sla.test.ts (states, multiple cycles, final stages, filter datasets, reschedule, completion, config validation) + 28 first-response tests must stay green.

---
Task ID: followup-2
Agent: main
Task: FOLLOW-UP SLA — implementation, connection, QA and final verification

Work Log:
- MODEL: Task.type column ("TASK" | "FOLLOW_UP", default TASK) + @@index([organizationId,type,status]) via db push (non-destructive). TASK_TYPE + LEAD_EVENT.FOLLOW_UP_* + INTEGRATION_EVENTS.followup.* constants.
- ENGINE (src/lib/sla-followup.ts, PURE — zero changes to lib/sla.ts beyond additive SLA_KIND.FOLLOW_UP): FOLLOWUP_SLA_STATUS (NOT_REQUIRED|SCHEDULED|DUE_SOON|OVERDUE|COMPLETED), FollowUpSlaConfig {warningBeforeHours, defaultFollowUpHours, autoCreateAfterFirstResponse}, DEFAULT_FOLLOWUP_SLA_CONFIG (4/24/OFF — single fallback), validateFollowUpConfig/parseFollowUpConfig (backfills legacy rows), computeFollowUpSla (gating: unresponded + WON/LOST/ARCHIVED → NOT_REQUIRED even with open tasks; dueAt null → SCHEDULED; clamped >= 0), compareLeadsByFollowUpUrgency, followUpQuickDate (standard/tomorrow/+3d/+1w).
- SERVER (src/lib/leados/followup-sla-service.ts): getFollowUpConfig (Setting "followup_sla", 15s cache + invalidation), getFollowUpTaskMap (2 queries per batch: open FU by dueAt asc + latest DONE), attachFollowUpToLeads, followUpFilterWhere (exact engine parity incl. HAS_RESPONSE + ACTIVE_LEAD conditions; NONE variant), followUpTodayFilterWhere (org-timezone day boundaries), countFollowUpsOverdue/DueToday (KPI click == filter count), sortLeadIdsByFollowUpUrgency (2-phase), scheduleFollowUp/completeFollowUp/rescheduleFollowUp/cancelFollowUp/cancelFollowUpsForFinalStage (task status DONE+completedAt = source of truth; FOLLOW_UP timeline activities with metadata.action + previousDueAt trace; LEAD_EVENT publishing).
- APIs: leads ?followUp=SCHEDULED|DUE_SOON|TODAY|OVERDUE|COMPLETED|NONE + sort=followup:urgency + rows[].followUp + followUpConfig; lead detail + followUpConfig; kanban cards; NEW /api/v1/leads/[id]/followup POST schedule (dup → 400) + PATCH complete|reschedule|cancel; settings POST validates followup_sla (warning<default, >0 → 400); activities POST auto-create policy (default OFF, first qualifying response only, no dup); changeStage → cancels open FU on won/lost; tasks APIs accept type; export ?followUp= filter + followUpStatus/DueAt/OverdueMinutes/CompletedAt columns; dashboard metrics.followUpsDueToday/tasksDueToday/meetingsToday + overdueFollowups rewired to engine.
- UI: sla/followup-badge.tsx (shared badge + popover, dueDayLabel "Today · HH:MM"/"Tomorrow", shared 60s tick), sla/followup-detail.tsx (right-panel card + schedule/reschedule dialog: quick presets + custom datetime + note, Complete/Reschedule/Cancel), leads-view Follow-up column (replaced legacy Next action), Follow-up filter select (replaced legacy ⏱ overdue button), followup:urgency sort option, lead-detail header FollowUpBadge + ActivityTab "then follow-up" select (Section 11, optional), kanban compact onlyUrgent indicator, dashboard Today work-queue card + rewired overdue tile → ?followUp=OVERDUE, settings Follow-up SLA card (warning/default/auto-create switch + shared-badge preview + inline errors + disabled save).
- i18n: 50 followup.* keys × hy/ru/en. Seed: followup_sla Setting row, FU demo coverage Marina +26h SCHEDULED / Elena +2h DUE_SOON / Dmitry -5h OVERDUE / Vardan COMPLETED cycle / no-follow-up leads; generic HIGH/URGENT FU tasks typed FOLLOW_UP (open stages only).
- Tests: tests/followup-sla.test.ts — 31 tests (states, boundaries, gating, cycles, config validation, quick options, sort E,B,C,A,D,F, completion/reschedule semantics, filter dataset B+E, first-response non-regression). 59/59 total PASS (28 old + 31 new).

QA & REPAIR LOOPS:
- LOOP 1 (semantics): two SLA layers coexist — test "responded lead carries BOTH layers (SLA RESPONDED + FU OVERDUE)" PASS; UI shows separate SLA column + Follow-up column; settings has two separate cards.
- LOOP 2 (overdue): Lead List shows Overdue · 5h; Dashboard overdue tile = 3 = filter count (KPI click == filter verified); UI filter select → exactly 3 rows (Sergey/Gagik/Dmitry).
- LOOP 3 (complete): Complete in Lead Detail → COMPLETED without refresh (react-query invalidation); dashboard KPI 3→2 live.
- LOOP 4 (reschedule): Overdue → Tomorrow → SCHEDULED; reschedule → +1 week; timeline retains RESCHEDULED event with previousDueAt.
- LOOP 5 (final stage): Karine → Won → engine NOT_REQUIRED, open FU tasks CANCELLED (rows kept, 0 open).
- LOOP 6 (multiple cycles): complete → schedule new → independent cycle; earliest-open-task-wins test.
- LOOP 7 (performance @500 leads): followup:urgency 54ms, followUp=OVERDUE 75ms, combined 85ms, kanban 151ms, dashboard 27ms. No N+1 by construction (2 task queries + 1 groupBy per batch, 1 config read with cache). Synthetic data cleaned.
- LOOP 8 (mobile 390×844): leads/detail/schedule dialog/Complete/custom datetime picker (native)/timeline verified. Fixed: none needed beyond dialog (submit blocked empty date correctly).
- LOOP 9 (UX): "Today · My work queue" card answers "what do I do today" (overdue FU / due today FU / meetings / tasks, each clickable).
- REPAIRS: (1) dev server had stale Prisma client after db push → restart fixed PrismaClientValidationError; (2) followup-badge HMR "Bell is not defined" + "humanizeDuration doesn't exist" — stale dev cache artifacts (file + served chunk correct, fresh browser session = 0 page errors); (3) export ignored followUp param → added filter + 4 columns; (4) Accidentally-removed Unassigned button restored; (5) ESLint react-hooks/preserve-manual-memoization → dropped useMemo for direct compute (cheap).
- Settings critical test: warning 4→0.5h flips Elena DUE_SOON→SCHEDULED→DUE_SOON (recompute + cache invalidation). Server 400s verified (0/24, 30/24).
- E2E demo experience (spec §42): open Lead C → Overdue 5h → Complete → cycle closed → Schedule Tomorrow → SCHEDULED → Reschedule → timeline event. All in browser.

Verification: TS PASS, ESLint PASS (0 warnings), production build PASS, 59/59 unit tests, 24 QA screenshots in download/followup-qa/, page errors 0 / console errors 0 in fresh session.

Stage Summary:
- FOLLOW-UP SLA delivered as an independent second SLA layer: Task-based source of truth (Task.type=FOLLOW_UP, dueAt deadline, DONE=completion), own Setting key with validation, own engine (sla-followup.ts) separate from the untouched first-response engine, repeating cycles, Schedule/Complete/Reschedule/Cancel flows, Lead List/Detail/Kanban/Dashboard/Export surfaces, server-side filters incl. org-timezone TODAY, RU/HY/EN. First-response SLA regression green (28/28). VERIFIED_COMPLETE.

---
Task ID: stage-1
Agent: main
Task: STAGE INACTIVITY (third SLA layer) — INSPECT + DEFINE

Work Log (INSPECT findings):
- Lead model has NO stageChangedAt/stageEnteredAt → OPTION C required (add nullable stageEnteredAt + backfill: last STAGE_CHANGE activity ?? createdAt, never updatedAt).
- PipelineStage HAS type ("open"|"won"|"lost") + isWon/isLost → final-stage detection is architectural (Section 9 satisfied).
- changeStage (lead-service.ts): NO same-stage guard (Proposal→Proposal runs full path incl. STAGE_CHANGE activity); lead update split across 2 sequential db.lead.update calls; creates ACTIVITY_TYPE.STAGE_CHANGE with metadata {from,to,stageName} + LEAD_EVENT (STAGE_CHANGED/LEAD_WON/LEAD_LOST/LEAD_QUALIFIED); on final stage cancels open follow-ups (cancelFollowUpsForFinalStage).
- HOLE FOUND: updateLead accepts stageId directly (PATCH /api/v1/leads/[id]) — bypasses changeStage (no STAGE_CHANGE activity, no events, would skip stageEnteredAt reset). Must delegate real transitions to changeStage.
- Settings architecture: org-scoped Setting key/value; keys "sla_thresholds", "followup_sla"; POST /api/v1/settings validates per-key; 15s config caches with invalidation in services.
- Engine pattern: PURE modules lib/sla.ts (first-response, DO NOT TOUCH beyond SLA_KIND), lib/sla-followup.ts (follow-up). Service pattern: sla-service.ts / followup-sla-service.ts (attach*, where fragments, 2-phase sorts, count* for KPI).
- useSlaTick: shared 60s singleton timer (reuse for stage age).
- i18n: flat keys in lib/leados/i18n.ts × hy/ru/en.
- Seed: LEADS array + stageIndex; settings created BEFORE pipeline stages (stage_inactivity Setting needs stage IDs → must be created after stages); demo reset re-runs seed → timestamps restored.
- Export: has sla + followUp filters/columns; kanban/dashboard/leads routes attach both SLA layers via attach* helpers.
- Tests: bun test; tests/sla.test.ts (28), tests/followup-sla.test.ts (31) — 59/59 must stay green.

Stage Summary (DEFINE — design decisions):
- SOURCE OF TRUTH: OPTION C. Lead.stageEnteredAt DateTime? (nullable, additive, db push). createLead sets = now; changeStage sets = now ONLY on real transition; same-stage PATCH = no-op early return (no activity/no reset). updateLead: stageId stripped from direct update, different stage → delegated to changeStage.
- ENGINE: src/lib/sla-stage-inactivity.ts (PURE) — STAGE_INACTIVITY_STATUS {ON_TRACK, AGING, STALE, NOT_APPLICABLE}; StageInactivityConfig {warningBeforeHours, stages: {[stageId]: {thresholdHours}}}; DEFAULT_STAGE_INACTIVITY_HOURS = 72 fallback (config layer only); validateStageInactivityConfig (per-stage threshold>0 finite, warning>0, warning<threshold); computeStageInactivity (final stage type won/lost OR status WON/LOST/ARCHIVED OR no stage → NOT_APPLICABLE; future timestamp clamp 0; ON_TRACK age<threshold-warning, AGING in window, STALE age>=threshold); compareLeadsByStageInactivity (STALE most-overdue → AGING closest → ON_TRACK oldest); SLA_KIND.STAGE_INACTIVITY added additively.
- SERVICE: src/lib/leados/stage-inactivity-service.ts — Setting key "stage_inactivity"; getStageInactivityConfig(orgId) loads Setting + default pipeline stages, drops deleted, falls back default for new stages (15s cache + invalidation); stageHealthFilterWhere(status, config) per-stage OR fragments with stageEnteredAt-null→createdAt fallback (engine parity); attachStageInactivityToLeads; countStaleDeals; sortLeadIdsByStageInactivity (2-phase).
- FILTER/SORT/API: leads ?stageHealth=STALE|AGING|ON_TRACK|NOT_APPLICABLE + sort=stageinactivity:urgency + rows[].stageInactivity + stageInactivityConfig in responses (leads, detail, kanban); export ?stageHealth= + Stage/StageEnteredAt/StageAge/StageHealth columns; dashboard metrics.staleDeals + NEEDS ATTENTION block (3 engines: FR breach / FU overdue / stale; issues vs distinct leads; top-5 critical preview); settings POST validates stage_inactivity.
- UI: StageHealthBadge (Hourglass icon family; ON_TRACK muted emerald, AGING amber, STALE red, NOT_APPLICABLE muted; popover: Stage/Entered/Age/Expected max/Stale by — Section 23 tooltip copy); Lead List: stage age line under StageBadge + badge + stageHealth filter select + sort option + route param; Lead Detail: third header badge + attention summary line; Kanban: onlyUrgent (AGING/STALE); Dashboard: Stale deals tile (click → ?stageHealth=STALE) + NEEDS ATTENTION block; Settings: StageInactivityConfigCard (real pipeline stages, final stages "Not monitored", warning input, live badge preview).
- SEED: stage_inactivity Setting (New 24 / Contacted 48 / Qualified 72 / Meeting 72 / Proposal 120 / Negotiation 120, warning 12h, keyed by stage ID); demo A(New 3h ON_TRACK) B(Contacted 45h AGING) C(Qualified 80h STALE) D(Proposal 7d STALE — §36 drag scenario) E(Won NA) F(Lost NA) + realistic composition (§125).
- TESTS: tests/stage-inactivity.test.ts (engine states incl. §48-52 matrix, future clamp, config validation, §57 sort C/A/D/E/B, regression guard) — 59 existing stay green.
- FUTURE-READY (§118): LEAD_EVENT.STAGE_BECAME_STALE + INTEGRATION_EVENTS constants + pure transition helper; NO worker, NO notifications, NO auto-move, NO auto-tasks.

---
Task ID: stage-2
Agent: main
Task: STAGE INACTIVITY — implementation, connection, QA and final verification (third SLA layer)

Work Log:
- MODEL: Lead.stageEnteredAt DateTime? (nullable, additive) via db push. Backfill script scripts/backfill-stage-entered-at.ts: last STAGE_CHANGE activity ?? createdAt (never updatedAt) — 30 leads: 22 from activity, 8 from createdAt. createLead sets = now; changeStage resets = now ONLY on real transition (same update as stage+status — atomic §82); updateLead stageId path delegated to changeStage (bypass closed); same-stage PATCH = no-op (no activity/reset/events).
- ENGINE (src/lib/sla-stage-inactivity.ts, PURE): STAGE_INACTIVITY_STATUS {ON_TRACK, AGING, STALE, NOT_APPLICABLE}; StageInactivityConfig {warningBeforeHours, stages: {[stageId]: {thresholdHours}}} keyed by STAGE ID; DEFAULT_STAGE_INACTIVITY_HOURS=72 single fallback; validateStageInactivityConfig (per-stage >0 finite, warning>0, warning<threshold — server 400 + client inline + disabled save); parseStageInactivityConfig (backfills legacy rows); computeStageInactivity (final stage type won/lost OR status WON/LOST/ARCHIVED OR no stage → NOT_APPLICABLE; future timestamp clamps age 0; null stageEnteredAt → createdAt fallback; exact-ms status decisions = filter parity; warningAt/staleAt derived from stageEnteredAt); compareLeadsByStageInactivity (STALE largest-overdue → AGING smallest-remaining → ON_TRACK oldest-entered → N/A newest — cross-stage correct); detectStageInactivityTransition (AGING_STARTED/STALE_STARTED/RECOVERED — future automation contract, no worker). SLA_KIND.STAGE_INACTIVITY added additively to sla.ts.
- SERVICE (src/lib/leados/stage-inactivity-service.ts): Setting key "stage_inactivity"; getStageInactivityConfig → RESOLVED config (all open stages of ALL org pipelines, new stages fall back 72h "Using default", deleted stages ignored on load, 15s cache + invalidation); attachStageInactivityToLeads (pure per-row compute, no N+1); stageHealthFilterWhere — per-stage OR Prisma fragments with stageEnteredAt-null→createdAt fallback (STALE/AGING/ON_TRACK/NOT_APPLICABLE, full engine parity incl. boundaries); countStaleDeals; sortLeadIdsByStageInactivity (2-phase); asEngineConfig export.
- APIs: leads ?stageHealth= + sort=stageinactivity:urgency + rows[].stageInactivity + stageInactivityConfig; lead detail + stage PATCH (now returns all three layers); kanban cards + config; export ?stageHealth= + StageEnteredAt/StageAge/StageHealth/StageStaleBy columns; settings POST validates stage_inactivity (400s); dashboard metrics.staleDeals + getAttentionQueue (three engines: FR breach / FU overdue / stale — issues vs distinct leads + top-5 critical preview, severity-ranked).
- UI: sla/stage-health-badge.tsx (shared badge + popover §23 tooltip copy: Stage/Entered/Age/Expected max ≤Xh/Stale by; compact + onlyUrgent + hideNotApplicable variants; text+color a11y; shared 60s tick); leads-view: Stage column shows StageBadge + "6d on stage" age line, new Stage Health column (badge + hideN/A), stageHealth filter select, stageinactivity:urgency sort option, route param, stale row tint; lead-detail: third header badge + compact ATTENTION strip (§70, only when issues); kanban LeadCard onlyUrgent badge (AGING/STALE only); dashboard: "Stale deals" tile (click → ?stageHealth=STALE) + NEEDS ATTENTION block (3 clickable counts + top-3 leads with issue chips §112/113); settings: StageInactivityConfigCard (real pipeline stages via usePipeline, per-stage inputs stacked §97, final stages "Won · Lost — not monitored", warning input, client validation, shared-badge preview §76, save invalidates leads/lead/kanban/dashboard).
- i18n: 30 stage.* + attention.* keys × hy/ru/en.
- SEED: stage_inactivity Setting (New 24/Contacted 48/Qualified 72/Meeting 72/Proposal 120/Negotiation 120, warning 12, stage-ID keyed); stageAgeHours per lead — composition §125: 18 ON_TRACK (60%) / 5 AGING (17%) / 3 STALE (10%) / 4 final; §35 demo: Anna New ~3h ON_TRACK, Sergey Contacted 45h AGING, Vardan Qualified 80h STALE, Dmitry/AquaService Proposal 168h STALE BY 2D (§36 critical scenario, FU overdue too → 2 issues), Won/Lost NOT_APPLICABLE; reseed script scripts/reseed-demo.ts (wipes tenant data + seed — demo reset §84).

QA & REPAIR LOOPS (all PASS):
- L1 SEMANTICS (§102/103): NOTE → stageAge unchanged (API test); CALL group in unit tests; UI verified.
- L2 STAGE CHANGE (§104/155): Proposal→Meeting via Lead Detail UI → "On track 0m" LIVE without refresh; timeline "Stage changed to Meeting"; dashboard stale 3→2.
- L3 SAME-STAGE (§20/50/59): Proposal→Proposal API → age unchanged, no duplicate activity; browser DnD same-column drop → timer NOT reset (0m→1m continuing).
- L4 SETTINGS RECALC (§105/127/156): Proposal 120→240 via API AND via Settings UI save → Gagik 130h instantly ON_TRACK (no lead change); invalid configs → HTTP 400 (warning≥threshold, threshold 0); client inline error + disabled Save.
- L5 NEW STAGE (§106): created "Contract Review" → appears in resolved config with 72h fallback + usingDefault=1.
- L6 RENAME (§107/42): renamed → 96h config survived via stage ID.
- L7 FINAL STAGE (§108/159): Vardan STALE → Won → NOT_APPLICABLE; dashboard -1; filter drops; FU cancellation policy applied.
- L8 MULTI-ISSUE (§109/131/132/157): Gagik FU OVERDUE + STALE = 2 issues; stage→Meeting → FU preserved (2→1 issues, still in queue); complete FU → 0 issues, gone from queue. §91 exact: 2 not 1 not 3.
- L9 MOBILE (§95/96/97): 390×844 dashboard/leads/lead-detail/settings — no document overflow, badges visible, per-stage inputs stacked.
- L10 DASHBOARD UX (§111): NEEDS ATTENTION block: 3 labeled rows (Unanswered 2 / Overdue follow-ups 3 / Stale deals 3) + "8 issues across 6 leads" — answerable in 5 seconds; top leads with issue chips.
- §160 REOPEN: Won→Qualified → ON_TRACK age 0, no stale restored.
- §145/146/147 cross-engine: FU complete / first response / stage change — no engine resets another (unit + API).
- §60 KANBAN DRAG (real browser DnD): multiple real drags — stage persisted, stageEnteredAt reset (ageMin 0-1), stale badge disappeared, dashboard count decreased, filter updated, timeline recorded.
- §136 CONSISTENCY @500 leads: list=78 = dashboard=78 = export=78 MATCH.
- §135 SHAREABLE URL: #/leads?stageHealth=STALE deep-link works (3 stale rows).
- REPAIRS during QA: (1) threshold minutes were added as ms in staleAt/warningAt — caught by tests, fixed with exact-ms parity; (2) CRITICAL latent defect found: config caches were per-module-instance in dev → cross-route invalidation silently broken for ALL THREE layers → fixed with globalThis singleton caches (same pattern as Prisma client) in sla-service + followup-sla-service + stage-inactivity-service; (3) PATCH /stage returned raw lead → now returns all three SLA layers (§38); (4) sort comparator switched from entered-time to overdue/remaining magnitudes for cross-stage correctness (§57).

PERFORMANCE @500 synthetic leads (§47/100): stageinactivity sort 84ms · STALE filter 71ms · stage+stale 49ms · STALE+sla=BREACH 172ms · STALE+followUp=OVERDUE 30ms · dashboard+attention 57ms · kanban 75ms · export 95ms. No N+1 by construction (1 config read w/ cache, pure per-row compute). Cleanup verified.

Verification: TS clean, ESLint exit 0, production build PASS (§151), 109/109 unit tests (28 FR + 31 FU unchanged + 50 new stage-inactivity; §53/54), fresh browser session page errors 0 / console errors 0 (§152/153), 14 QA screenshots in download/stage-qa/ (§154), dark mode + RU/HY/EN verified.

Stage Summary:
- STAGE INACTIVITY delivered as the third independent SLA layer: persisted stageEnteredAt source of truth (reset only on real transitions), per-stage thresholds from Settings keyed by stage ID, final stages excluded, ON_TRACK/AGING/STALE/NOT_APPLICABLE engine, Lead List/Detail/Kanban/Dashboard/Export surfaces, server-side stageHealth filter + urgency sort, NEEDS ATTENTION presentation layer over the three engines (issues ≠ leads), future automation contract (transition detection, no worker). First-response (28) and follow-up (31) regression green. VERIFIED_COMPLETE.

---
Task ID: 4-1
Agent: main
Task: STAGE 4 (v0.14) EVENT ENGINE + NOTIFICATION CENTER — INSPECT

Work Log:
- Read full spec upload (2640 lines, 120 sections).
- Inspected: prisma/schema.prisma, context.ts (session/auth), events.ts (LeadEvent/IntegrationEvent publisher), constants.ts, sla.ts + sla-followup.ts + sla-stage-inactivity.ts (pure engines), sla-service.ts / followup-sla-service.ts / stage-inactivity-service.ts (server services with globalThis config caches), lead-service.ts (createLead/updateLead/changeStage/assignLead/archiveLead), activities route (qualifying types + auto-followup policy), tasks routes (POST/PATCH/DELETE), followup route (complete/reschedule/cancel), settings route (key-validated upserts), app-shell.tsx + header-controls.tsx (existing simple bell), hash-route.ts, i18n.ts (t() with {var} interpolation), seed.ts (30 leads + 1 legacy notification), use-api.ts hooks, tests (bun:test, 109 tests PASS), scripts/ (scale-test pattern with direct PrismaClient).
- DB state: 1 org, 30 leads, 1 notification. Clean.

INSPECT ANSWERS (spec Section 3):
1. Recipient today: Notification.userId (nullable = org broadcast); session = cookie leados_uid, fallback = org OWNER.
2. Persistent User model: YES (id, organizationId, role OWNER/ADMIN/MANAGER/SALES_MANAGER/VIEWER, status).
3. Organization membership: YES (User.organizationId; every route scoped via getSession()).
4. Real background worker: NO (Next.js app only, no cron). Choice: Option B+C hybrid — protected org-scoped reconcile API + client 5-min tick + manual script. Reconciler is idempotent so concurrent triggers are safe. Documented limitation.
5. Time-based transitions: deterministic deduplication keys + DB unique(organizationId, deduplicationKey) + reconciler calling the 3 EXISTING engines (computeFirstResponseSla / computeFollowUpSla / computeStageInactivity). No SLA logic reimplementation.

Stage Summary:
- Task model supports assignee/dueAt/status → TASK_ASSIGNED, TASK_DUE_SOON, TASK_OVERDUE implementable (Task.type = TASK only; FOLLOW_UP tasks belong to the Follow-up engine — prevents double notifications).
- Existing Notification model will be EXTENDED additively (eventId, severity, templateKey, payload, entityType, entityId, deepLink, readAt, resolvedAt); legacy `read` Boolean kept in sync.
- New DomainEvent model (org-scoped, dedup unique, processedAt for projector crash recovery).
- Emission points identified: assignment (lead-service create/update/assign), stage change (resolution hook), qualifying activity (FR resolution), followup mutations (resolution), task mutations (TASK_ASSIGNED + resolutions), seed (reconciliation run + synthetic states).
- Plan: MODEL → pure lib/domain-events.ts (types, dedup keys, planner) → services (publish/projector/recipients/resolution/reconciler) → API routes → UI (bell popover + full view + settings tab + deep links) → i18n → tests → QA.

---
Task ID: 4-2..4-8
Agent: main
Task: MODEL + IMPLEMENT + RECONCILER + API + UI + CONNECT + TEST for the Event Engine v0.14

Work Log:
- MODEL: Prisma DomainEvent (org-scoped, unique(organizationId, deduplicationKey), processedAt recovery, indexes) + Notification extended additively (eventId, severity, templateKey, payload, entityType, entityId, deepLink, readAt, resolvedAt, unique(eventId, userId); legacy `read` Boolean kept in sync). db push OK.
- PURE ENGINE src/lib/domain-events.ts: DOMAIN_EVENT (9 types), SEVERITY map (CRITICAL: FR breach/FU overdue/stale/task overdue; WARNING: due soon/aging; INFO: assignments), deterministic dedup key builders (stage/FU/task cycles anchored to stageEnteredAt/dueAt; assignments to the action instant), NOTIFICATION_TEMPLATES (titleKey/messageKey per type), deep links (lead/<id>?focus=..., tasks?task=...), preferences (per-user, defaults ON, parse/validate), task event config (warningBeforeHours, default 4), planLeadEvents() + planTaskEvents() consuming REAL engine results (no SLA reimplementation; TASK_* only for type=TASK — follow-ups never double-notify), renderEnglishSnapshot() fallback.
- SERVICES: domain-event-service.ts (publishDomainEvent idempotent via P2002 catch, projectEventToNotifications with prefs filter + unique(eventId,userId) catch, resolveNotificationRecipients — Section 17 fallback CHAINS first-non-null, getOrgFallbackRecipient OWNER→ADMIN→any, getPreferencesFor batch cache, reprocessUnprocessedEvents crash recovery, listDomainEvents dev inspector). notification-service.ts (list server-paginated + filters all/unread/critical/resolved, server-side unread count, markRead/markAllRead recipient-scoped, resolveNotificationsForEntity + convenience resolvers, user-scoped preferences Setting key notification_preferences:<uid>). event-reconciler.ts (runEventReconciliation: recovery → configs once → active leads batch → first-response groupBy + FU task map → pure planners → chunked dedup-key lookups → idempotent creates + projections; summary log; task_events Setting key).
- HOOKS: lead-service (LEAD_ASSIGNED on create/update/assign with same-owner guard; resolveStageNotifications on real changeStage; resolveAllLeadProblems on archive), activities route (qualifying response resolves FR breach), followup-sla-service (complete/cancel/reschedule/final-stage cancel resolve FU notifications task-scoped), tasks routes (TASK_ASSIGNED on create + assignee change; resolution on DONE/CANCELLED/dueAt change/DELETE).
- API: GET /notifications (filters+pagination+recent), GET /notifications/unread-count, POST /notifications/mark-all-read, PATCH /notifications/:id/read, GET/PUT /notifications/preferences, POST /events/reconcile (org-scoped idempotent trigger), GET /events/domain (dev inspector), settings POST task_events key (validated). Legacy PATCH /notifications kept as compat.
- UI: notifications/notification-card.tsx (localized render templateKey+payload, severity chips icon+label never color-only, unread dot, resolved badge, parseDeepLink), notifications-bell.tsx (badge 1–99/99+, Popover desktop / full-width Sheet mobile, skeleton/loading/error-retry, empty state), notifications-view.tsx (full center: filters, server pagination, deep links, mark all read, reconcile refresh), settings-notifications-tab.tsx (per-type toggles + task window + dev event inspector), app-shell (notifications route + useEventReconciliationTick 5-min idempotent client tick), lead-detail focus params (activity/followup→tasks tab, stage→changer), tasks-view task highlight ring. i18n: 54 keys × hy/ru/en.
- SEED: generic TASK demo (overdue 30h + due soon 2h), runEventReconciliation at seed end (Section 84 restore-without-duplicates), synthetic states: LEAD_ASSIGNED info READ (48h ago) + FOLLOW_UP_OVERDUE resolved historical (72h ago).
- TESTS: tests/domain-events.test.ts (32 pure) + tests/event-engine.test.ts (19 integration, throwaway org with cascade cleanup). Fixed during test runs: recipient chain must be first-non-null (Section 17 fallback), task payload missing assigneeId/ownerId hints, floating timestamp in a test.

Stage Summary:
- FULL SUITE: 160/160 PASS (109 existing: 28 FR + 31 FU + 50 stage + new 51).
- Scale: 500-lead reconcile run1 = 272 events/408 notifications in ~930ms; run2 = 0/0 in ~23ms; zero duplicate keys, zero duplicate (eventId,userId) pairs.
- Architecture: BUSINESS STATE → engines → planner → DEDUP-PROTECTED EVENT STORE → projector → in-app notification → read/resolved → deep link. No notifications from React; no SLA reimplementation; additive layer.
- Remaining: ESLint, production build, demo reseed, browser QA (desktop/mobile/dark), final report + commit.

---
Task ID: 4-9..4-10
Agent: main
Task: VERIFY (browser QA, repair loops, scale) + final delivery

Work Log:
- Demo reseed with the new event-engine seeding: 30 leads → 20 reconciled events (5 STAGE_AGING, 3 STALE, 2 FR_BREACHED, 4 FU_OVERDUE, 1 FU_DUE_SOON, 5 TASK_OVERDUE, 1 TASK_DUE_SOON) + synthetic states (LEAD_ASSIGNED info READ, FOLLOW_UP_OVERDUE resolved historical).
- Browser QA (agent-browser, 1440×900 + 390×844 + dark mode):
  * Bell popover: localized cards, honest occurredAt-based relative times, severity chips + labels (never color-only), legacy-row English fallback, mark all read, View all. Badge 1–99 style (David: 9, Aram: 2 → empty after mark-all-read).
  * Deep links: FR notification → lead/<id>?focus=activity (tab switched, hash cleaned); STAGE stale notification → focus=stage (stage changer scrolled); task notification → tasks?task=<id> highlight ring.
  * E2E Scenario A (FR): MESSAGE logged via UI → RESPONDED → notification RESOLVED → unread 3→2 → Needs Attention KPI drops.
  * E2E Scenario C (STALE): Dmitry Proposal→Meeting via UI → stale notification resolved, stageInactivity ON_TRACK.
  * Filters: All / Unread (2 for Aram, 9 for David) / Critical / Resolved (only Robert's fixed breach).
  * Settings → Notifications: 9 localized toggles (severity-letter chips), task window input, save persists user-scoped prefs (verified in DB), dev event inspector table.
  * Mobile 390×844: bell opens FULL-WIDTH (390px) Sheet drawer, cards clickable, deep links work, notifications view no overflow, settings toggles 9 + spinbutton, no horizontal scroll anywhere.
  * Dark mode: notifications view + bell popover verified.
  * Locales: HY (default) + RU + EN fully localized titles/messages.
- Repair loops:
  1. {stage} placeholder not interpolated in the stage-stale TITLE → fixed (title now renders with vars).
  2. Latent HYDRATION BUG (pre-existing): reloading any non-dashboard hash route (e.g. #/notifications) → server rendered Dashboard, client rendered the hash view → React hydration error. FIXED with an SSR-safe mount gate (neutral skeleton until mount, same pattern as ThemeToggle). Fresh-session verification: 0 page errors on #/notifications, #/leads, #/settings, #/pipeline, #/tasks.
  3. Recurrence × 5 via API: 0 new events / 0 new notifications every run (18 duplicates skipped) — Section 104 PASS.
  4. READ ≠ RESOLVED browser proof: mark-all-read clears the badge; Needs Attention block remains (1 SLA / 3 FU / 2 stale) — Section 50 PASS.
- Final gates: bun test 160/160 PASS; ESLint 0 problems; tsc src/ clean; production build PASS (standalone).
- Screenshots: download/events-qa/01..25 (dashboard+bell, popover, deep links, resolution flows, filters, settings, mobile, dark, RU/EN).

Stage Summary:
- FINAL VERDICT: VERIFIED_COMPLETE — see final report in the conversation.
- Key numbers: 51 new tests (160 total), 9 event types, 500-lead reconciliation ~930ms first run / ~23ms steady-state, zero duplicates by construction (DB unique constraints).
- Limitations (documented): background execution is client-tick + API trigger (no production scheduler in this deployment); TASK events cover type=TASK only (FOLLOW_UP belongs to the follow-up engine — no double notifications); preferences are per-user Setting rows (real User model exists, so user-scoped).

---
Task ID: auto-1 (INSPECT)
Agent: main
Task: Inspect codebase for AUTOMATION ENGINE (v0.15) integration.

Work Log:
- Read prisma/schema.prisma: DomainEvent (deduplicationKey unique, processedAt = PROJECTOR-owned), Notification (unique(eventId,userId)), Task (type TASK/FOLLOW_UP), Lead, Setting.
- Read domain-event-service.ts: publishDomainEvent() creates event + projects notifications; projectEventToNotifications stamps processedAt — MUST NOT be reused by automation.
- Read event-reconciler.ts: runEventReconciliation(orgId) sweep, batch, idempotent.
- Read lead-service.ts: updateLead (priority), assignLead, changeStage, createLead — business services for actions.
- Read tasks route: creates task inline (db.task.create + publishEvent + TASK_ASSIGNED domain event) — to extract into task-service for automation reuse.
- Read context.ts: getSession(), canManage() = OWNER/ADMIN, canMutate() = !VIEWER.
- Read app-shell.tsx (NAV + views), hash-route.ts, use-api.ts (React Query patterns), i18n.ts (flat keys hy/ru/en), seed.ts (demo org, runs reconciliation at end).
- Tests: bun test; DB-backed integration pattern in tests/event-engine.test.ts (throwaway org, cascade cleanup).

Stage Summary:
- Integration points mapped: event store exists and is durable; projector idempotency = Notification unique(eventId,userId); automation needs OWN AutomationExecution unique(ruleId,eventId).
- Plan: add AutomationRule + AutomationExecution + DomainEvent.automationExecutionId (causation) + Task automation trace columns; pure condition DSL in src/lib/automation-conditions.ts; engine/processor under src/lib/leados/; worker orchestrator runLeadOSWorkers; API /api/v1/automations/*; UI automations view; seed demo rules; tests.

---
Task ID: auto-2 (IMPLEMENT: engine + API + UI)
Agent: main
Task: Implement AUTOMATION ENGINE v0.15 (rule model → final UI).

Work Log:
- Prisma: AutomationRule (version, enabledAt backlog guard, deletedAt soft delete) + AutomationExecution (unique(ruleId,eventId), ruleVersion, result JSON) + DomainEvent.automationExecutionId (causation) + Task automation attribution columns. db push OK.
- Pure modules: automation-conditions.ts (13-field whitelist, 8 operators, ALL/ANY, validation with org-scoped dynamic refs, structured trace), automation-actions.ts (5 action types, validation, interpolation), automation-templates.ts (3 templates, template 4 deliberately omitted per spec 48).
- Services: automation-context.ts (AsyncLocalStorage causation), task-service.ts + note-service.ts (extracted business paths from routes), automation-engine.ts (processEventRule with tenant/enabled/backlog/idempotency/actionability/loop guards, STOP-on-failure, partial results, retryAutomationExecution that never re-runs already-SUCCESS actions, dryRunAutomationRule), automation-processor.ts (batch: rules by trigger, candidates ASC, one executions query, per-rule enabledAt filter), leados-workers.ts (runLeadOSWorkers: reconcile → project → automations, each step independently try/catch), automation-rule-service.ts (CRUD + validation + version bump on significant edits + metrics via groupBy, no N+1).
- publishDomainEvent stamps automationExecutionId from ALS (causation chain, spec 29).
- API: /automations (GET list+summary, POST create OWNER/ADMIN), /automations/[id] (GET/PATCH/DELETE soft), /automations/[id]/dry-run (POST), /automations/executions (GET history), /automations/executions/[id] (GET detail, POST manual retry), /workers/run (POST session OR x-workers-secret).
- Client tick switched to workers/run (reconcile → project → automations each 5 min).
- UI: automations-view (rule cards with WHEN/IF/THEN summary + metrics + run-now + templates gallery + history with status filter), rule-builder (vertical WHEN/IF/THEN, structured selects, per-action params, enabledAt hint), execution-detail (condition trace, action results with partial completion, human error only, retry for FAILED), DryRunDialog (lead picker, preview, creates nothing), Automated badge on tasks. i18n HY/RU/EN (126 keys × 3 + stage.type/task.status enums).
- Seed: 3 demo rules enabled (stale+HIGH→task, FU overdue+HIGH→notify+task, FR breached+HIGH/URGENT→urgent task) + processor run for honest SUCCESS/SKIPPED/FAILED history.
- Fixed: dynamic i18n key typing (tr wrapper), pre-existing event-engine.test.ts null typing, engine guards (enabled + backlog in processEventRule itself).

Stage Summary:
- TypeScript PASS, ESLint PASS (0 warnings), tests 229/229 PASS (46 pure condition + 23 engine integration + 160 regression).
- Next: reseed demo → browser QA → mobile/dark/i18n QA → production build → final report.

---
Task ID: auto-3 (TEST + BROWSER QA + FINAL VERIFY)
Agent: main
Task: Prove the AUTOMATION ENGINE end-to-end: tests, scale, browser QA, repair loops, all gates.

Work Log:
- Tests: 46 pure condition/action tests (all operators, ALL vs ANY difference, validation failures incl. whitelist traversal attempts + forbidden action types) + 23 DB integration tests (SUCCESS/SKIPPED traces, idempotency ×10, two rules → 2 executions, disabled rule, enabledAt backlog guard, actionability incl. WON lead + STAGE_TIMER_RESET + TASK_COMPLETED + ASSIGNEE_CHANGED, multi-action partial failure with STOP, manual retry after fixing owner [SUCCESS actions not re-run, same execution row], SUCCESS not replayable, causation stamping, chain depth 0/1/2 + depth-5 skip, tenant isolation, dry-run purity ×2, processor ×5 zero duplicates, worker chain).
- Full suite: 229/229 PASS (160 pre-existing + 69 new). TypeScript PASS, ESLint 0/0, production build PASS (all automation routes present).
- Scale test (spec 107-108): 500 leads + 667 events + 3 rules → 1167 executions in 12.1s batch; runs 2-5 → 0 duplicates, 23ms steady; rule A conditions respected at scale (225 HIGH tasks, 0 MEDIUM); 34 FAILED all "no owner" (unassigned leads). PASS.
- Demo seed re-run: honest history — 5 SUCCESS (tasks for stale HIGH deals + overdue FU), SKIPPED (conditions trace + no-longer-actionable), FAILED ("This lead has no owner to assign to." — ExpressDelivery) + 6 automation tasks + 3 automation notifications.
- Browser QA (agent-browser, 17 screenshots in download/auto-qa/): automations list (summary chips, rule cards, metrics, WHEN/IF/THEN with LOCALIZED enum values), builder (name+condition+URGENT value+task title → saved rule verified via API), dry-run (lead picker → MATCH + condition trace + action preview with resolved assignee name; DB counts unchanged — creates nothing), execution detail (event + condition trace localized + action FAILED + human error + duration), manual Retry after assigning owner (FAILED→SUCCESS, exactly 1 task, same row), pause toggle (enabled=false, enabledAt=null), history status filter with skip reasons (localized), "Run now" workers button, RU locale page, HY default, dark mode, mobile 390×844 (0 horizontal overflow, stacked cards), tasks view "Automated" badges.
- REPAIR LOOPS: (1) Radix ScrollArea overlapped the Save button in flex dialogs → replaced with native overflow-y-auto in builder/detail/dry-run dialogs; (2) raw enum values in rule chips → localized via enumLabel; (3) inverted switch aria-label fixed; (4) PRE-EXISTING bug found & fixed: tasks GET did not split comma-joined status values (?status=TODO,IN_PROGRESS) → active tasks list was empty since v0.1 — fixed with flatMap split, both contracts work.
- Console: clean (no page errors, no unexpected console output).

Stage Summary:
- VERIFIED end-to-end: SLA → DomainEvent → AutomationExecution → Task with zero duplicates; one event + one rule = max one automatic execution — proven by unique constraint, engine tests, ×5 stress and the 500-lead scale test.
- Remaining (documented): no production cron (client tick 5min + /workers/run with secret header ready); automation action error messages are English human strings; executions stuck in RUNNING from a crash need manual DB fix (documented); processor processes max 1000 candidate events per run.

---
Task ID: v0.16-1 (INSPECT DEPLOYMENT)
Agent: main
Task: Inspect deployment environment, worker infrastructure, and existing engines before production-reliability hardening (v0.16 spec).

Work Log:
- Deployment: self-hosted standalone Next.js 16 (output: "standalone"), production start = `bun .next/standalone/server.js` — LONG-LIVED process (not serverless). Reverse proxy: Caddy :81 → localhost:3000. Public preview URL exists.
- Cron: NO Vercel/Supabase/external scheduler configured. PROVIDER-NATIVE OPTION = Next.js `instrumentation.ts` register() hook → in-process setInterval scheduler that starts at server boot, independent of any browser. This is the real production scheduler for this deployment model.
- DB: SQLite file (db/custom.db), single-writer → DB-backed WorkerLease is correct; no connection-limit issue.
- Env: only DATABASE_URL set. WORKERS_SECRET supported by /workers/run but not set; secret compare uses plain === (not constant-time); secret path runs FIRST org only; NO lease, NO WorkerRun durability, NO rate limit.
- Client tick: app-shell useWorkersTick() runs unconditionally every 5 min (currently the ONLY trigger). Gate needed: NEXT_PUBLIC_DEMO_WORKER_TICK (spec 32).
- Processor limitation confirmed: `take: limit(1000)` on occurredAt ASC — events beyond the first 1000 are NEVER re-queried at a later cursor → permanently unprocessed ("process first 1000 and stop forever" bug, spec 24).
- AutomationExecution has NO lease columns → RUNNING rows after a crash hang forever (spec 11 confirmed).
- Action errors: English human strings, no errorCode/errorParams (spec 68 confirmed).
- Existing assets to REUSE (do not rewrite): event-reconciler (sweep + projection + crash recovery), domain-event-service (projector, prefs cache, getOrgFallbackRecipient), automation-engine (processEventRule, actionability, loop guard, retryAutomationExecution, dryRun), task/note/lead services, WebhookEndpoint model + CRUD (legacy IntegrationEvent delivery stays as-is — separate subsystem), Setting-based per-user prefs (notification_preferences:<userId>).
- Idempotency gap: Task carries automationRuleId/automationExecutionId; action-level idempotency needs automationActionIndex on Task/Note + uniques; Notification needs automationActionKey unique + fanoutAt.
- User model: has email, NO telegramChatId → add telegramChatId/telegramConnectedAt.
- UI: settings-view tabs (add "workers" + "integrations"); notifications settings tab per-event in-app toggles (extend with email/telegram columns); rule-builder action param UI extendable for SEND_EMAIL/SEND_TELEGRAM/SEND_WEBHOOK.
- i18n: flat dict hy/ru/en in src/lib/leados/i18n.ts; DictKey typing — new keys ×3 locales.
- Tests: bun test, 229/229 passing (automation-engine.test.ts has DB integration patterns with throwaway org).

Stage Summary:
- v0.16 implementation plan (order per directive):
  1) Prisma: WorkerRun, WorkerLease, NotificationDelivery (+uniques), AutomationExecution lease/retry/errorCode columns, Task.automationActionIndex(+unique), Note automation cols(+unique), Notification.automationActionKey(+unique)+fanoutAt, User.telegramChatId/ConnectedAt.
  2) Worker core: lease acquire/extend/release, WorkerRun lifecycle (RUNNING/SUCCESS/PARTIAL/FAILED), heartbeat, instrumentation.ts scheduler (env-gated, global-guarded), client tick gate NEXT_PUBLIC_DEMO_WORKER_TICK.
  3) Error model: automation-errors.ts (errorCode taxonomy, classifyAutomationError, backoff 1m/5m/15m, maxAttempts=3).
  4) Engine hardening: execution lease (lockedAt/lockExpiresAt), FAILED_RETRYABLE, recoverStaleAutomationExecutions (incl. legacy null-lock rows → WORKER_CRASHED with trace), action effect idempotency (CREATED/REUSED/NO_CHANGE), errorCode+errorParams on actions, new actions SEND_EMAIL/SEND_TELEGRAM/SEND_WEBHOOK (create NotificationDelivery rows; org endpoints only, no arbitrary recipients/URLs).
  5) Processor: cursor batch loop (250/batch, time budget, lease heartbeat), automatic retries of FAILED_RETRYABLE, stats + remaining candidates.
  6) Delivery layer: prefs v2 (event × channel matrix, external channels default OFF), fan-out (unique(notificationId,channel,recipient); webhook per event+endpoint), providers: Resend-style HTTP email, Telegram Bot API, HMAC-signed webhook with SSRF validation + redirect:manual + timeout; demo providers behind LEADOS_DEMO; delivery worker (own lease, batching, backoff, maxAttempts).
  7) API: workers/run hardened (timingSafeEqual, ALL orgs, 409 LEASE_BUSY, stats-only), workers/health, integrations status/test/telegram connect+webhook, deliveries list/retry.
  8) UI: Settings→Workers (Worker Health + Failed Jobs + retry), Settings→Integrations (Email/Telegram/Webhook cards + test buttons), notifications tab channel toggles, rule-builder 3 new actions, localized errorCodes; i18n ×3.
  9) Seed/demo: backfill fanoutAt (no backlog send), demo channel prefs, demo deliveries via demo providers.
  10) Tests: critical A–J + unit + regression 229.
  11) QA: browser/mobile/dark/i18n/clean console + PROOF: scheduler runs with NO browser; load test 500 leads/2500 events.

---
Task ID: v0.16-2 (IMPLEMENT: worker hardening + delivery layer)
Agent: main
Task: Implement production-reliable worker infrastructure + external delivery channels (full v0.16 spec).

Work Log:
- PRISMA (additive): WorkerRun (RUNNING/SUCCESS/PARTIAL/FAILED + stats + heartbeat), WorkerLease (unique type — one active lease per worker), NotificationDelivery (PENDING/SENDING/SENT/FAILED_RETRYABLE/FAILED/SKIPPED + uniques: (notificationId,channel,recipient), (eventId,channel,recipient), (automationExecutionId,automationActionIndex)), AutomationExecution + lockedAt/lockExpiresAt/attemptCount/nextAttemptAt/errorCode/errorParams, Task/Note + automationActionIndex (+unique(execId,actionIndex)), Notification + automationActionKey(unique)+fanoutAt, User + telegramChatId/telegramConnectedAt.
- WORKER CORE: worker-lease.ts (acquire/takeover-expired/extend/release, LEASE_BUSY), worker-run-service.ts (durable run lifecycle + 30d trim), scheduler.ts + src/instrumentation.ts (IN-PROCESS production scheduler — Next.js register() hook, env-gated, HMR-safe), client tick now NEXT_PUBLIC_DEMO_WORKER_TICK-gated (demo fallback only).
- ERROR MODEL: automation-errors.ts — AUTO_ERROR taxonomy (NO_LEAD_OWNER…MAX_ATTEMPTS_EXCEEDED), classifyAutomationError (retryable: timeout/429/5xx/WORKER_CRASHED; non-retryable: business facts), backoff 1m/5m/15m, maxAttempts 3.
- ENGINE HARDENING: execution lease stamped at RUNNING (lockExpiresAt +120s), FAILED_RETRYABLE + attemptCount + nextAttemptAt; recoverStaleAutomationExecutions (expired lease OR legacy null-lock rows → FAILED_RETRYABLE with WORKER_CRASHED trace — never a silent flip); ACTION-LEVEL IDEMPOTENCY: CREATE_TASK/ADD_NOTE/CREATE_NOTIFICATION/SEND_* look up (executionId, actionIndex) effects → effect=REUSED; SET_LEAD_PRIORITY/ASSIGN_LEAD → NO_CHANGE when already applied; action outcomes carry errorCode; SKIPPED actions (channel not connected) do NOT stop the chain; new actions SEND_EMAIL/SEND_TELEGRAM (recipients LEAD_OWNER/TASK_ASSIGNEE/EVENT_RECIPIENT/SPECIFIC_USER only) + SEND_WEBHOOK (org endpoint only) create ONE durable delivery row each (unique exec+actionIndex, retry-safe).
- PROCESSOR: cursor batch loop 250/batch — fixed the v0.15 "first 1000 forever" bug; time budget (WORKER_MAX_RUN_MS) → PARTIAL + remaining stats; snapshot bound occurredAt<=runStart keeps automation→automation chains on the NEXT run; retries due FAILED_RETRYABLE; recovery runs first.
- DELIVERY LAYER: channels.ts (channel/status enums, ChannelPreferences event×channel matrix — defaults OFF, emailHtml, appLink, buildWebhookPayload v1), ssrf.ts (localhost/private IPv4+IPv6/link-local/CGNAT/metadata/userinfo/non-http + DNS-resolved-IP checks, injectable resolve), providers.ts (EmailProvider: Resend HTTP real + demo; TelegramProvider: Bot API real + demo; WebhookProvider: HMAC-SHA256 signed, X-HayDev-Event-Id, redirect:manual, 8s timeout; demo mode LEADOS_DEMO=true OVERRIDES real creds; channel UNAVAILABLE when creds absent), fanout.ts (EMAIL/TELEGRAM per user prefs, WEBHOOK per org endpoint, content rendered at fan-out in org locale, fanoutAt scan marker, row-by-row idempotent inserts), delivery-worker.ts (own lease, stale SENDING recovery → WORKER_CRASHED, batching + budget, backoff, manualRetryDelivery).
- NOTIFICATION PREFERENCES v2: same Setting row extended with .channels matrix; notification-service gets/sets types+channels atomically; PUT /notifications/preferences accepts both shapes (backward compatible).
- API: workers/run hardened (timingSafeEqual secret, secret→ALL orgs, 409 LEASE_BUSY, stats-only response); workers/health (scheduler state, runs, leases, org queue depth — OWNER/ADMIN); integrations (status, email/test, telegram connect/connect-demo/disconnect/status/test/webhook secret-token-verified, webhooks CRUD with SSRF validation + auto-generated signing secret + HAYDEV_WEBHOOK_TEST); deliveries list (manager-safe: no errorCode/attempts; technical for OWNER/ADMIN) + [id]/retry; notifications/[id]/deliveries.
- UI: Settings→Integrations (3 channel cards, mode badges DEMO/REAL/UNAVAILABLE, test buttons, webhook CRUD + SSRF note, demo banner), Settings→Workers (scheduler status + Run now, queue depth, last runs with stats, Failed Jobs: failed automations + failed/retryable/skipped deliveries with manual Retry), notifications settings: 3 channel columns per event type (telegram disabled until connected), notification cards: delivery status chips, rule-builder: SEND_EMAIL/SEND_TELEGRAM/SEND_WEBHOOK params (subject/body/recipient/endpoint select), execution-detail: effect badges (CREATED/REUSED/NO_CHANGE) + localized errorCode; i18n +~110 keys ×3 (hy/ru/en).
- SEED: fanoutAt backfill (history never emailed), demo webhook endpoint, demo user telegram connected + email/telegram prefs on 2 critical types, full worker chain at seed end → honest SENT demo deliveries.
- BUGS FOUND & FIXED during development: (1) parseChannelPreferences/validateChannelPreferences shallow-copied DEFAULT_CHANNEL_PREFERENCES → MUTATED the shared nested toggles — one user's prefs leaked ON state into later parses (caught by TEST J, fixed with fresh per-type objects); (2) processor remaining stat was 0 when budget expired before the first batch.

Stage Summary:
- Tests: 283/283 (230 regression + 53 new: 19 worker-infra incl. CRITICAL A/B/D, 32 delivery-layer incl. CRITICAL E/F/G/H/I/J, 2 batching CRITICAL C). TS PASS, ESLint 0, build PASS.
- Load test (spec 85): 500 leads/2500 events/3 rules → 10 batches, 2500 executions 0 duplicates, fan-out 1500 rows (500 email+500 telegram+500 webhook), worker 1500 SENT 0 failed, queues drained. VERDICT PASS.
- PROOF spec 74: scheduler ran trigger=scheduler runs (60s interval) with NO browser — WorkerRun rows verified; UI shows them.
- Live HTTP: parallel workers/run → 200 SUCCESS + 409 LEASE_BUSY.
- Browser QA: 17 screenshots (worker health, integrations incl. SSRF-block toast, channel prefs + save verified in DB, notifications delivery chips, failed jobs + manual retry → PENDING → scheduler SENT, rule builder external actions + endpoint picker, execution detail localized error, mobile 390×844 no overflow, dark mode, fresh-session console 0 errors).

---
Task ID: v0.17-1 (INSPECT)
Agent: main
Task: Inspect auth/tenant state before production authentication (v0.17).

Work Log:
- getSession() trusted leados_uid cookie WITHOUT verification (any user impersonation) + implicit fallback to first org OWNER — no real auth existed.
- User: single-org (organizationId + role columns), email unique per org, NO passwordHash/locale/timezone; 5 roles (OWNER/ADMIN/MANAGER/SALES_MANAGER/VIEWER); no membership entity, no sessions, no invites, no security audit.
- next-auth@4 installed but unused (incompatible with Next 16 App Router patterns) → decision: custom secure email/password auth (spec-allowed), runtime is bun everywhere.
- Prefs: org Setting rows keyed notification_preferences:<userId> (fanout + projector + prefs route call sites mapped).
- fanout renders in ORG locale (users had no locale column); Activity.userId nullable + automation actorUserId null (system actor pattern already present).
- Session/seed routes unguarded; no middleware; IDOR pattern verified GOOD across routes (findUnique + organizationId check everywhere).

Stage Summary:
- Plan: schema (OrganizationMember/Session/PasswordResetToken/OrganizationInvite/AuditLog/UserNotificationPreference + User passwordHash/locale/timezone/global email + org isDemo) → backfill → auth libs (password/tokens/session-store/rate-limit/permissions/audit/auth-service) → context rework (production path + demo fallback + membership revalidation) → apiError codemod → auth/members/audit routes → proxy.ts (CSRF+headers) → services migration (prefs table + user locale) → UI (login/invite/profile/team/audit tabs + user menu + permission gating) → seed → tests → QA.

---
Task ID: v0.17-2 (IMPLEMENT: production auth)
Agent: main
Task: Implement full v0.17 production authentication, membership, permissions, tenant isolation, audit.

Work Log:
- PRISMA: 6 new models (OrganizationMember unique(org,user), Session tokenHash-unique + absolute 30d + idle 7d rolling + revokedAt, PasswordResetToken hashed+1h+single-use, OrganizationInvite tokenHash+7d+single-use+org/email-bound, AuditLog actor-typed append-only, UserNotificationPreference composite PK) + User.passwordHash/locale/timezone + global email @unique + Organization.isDemo. db push OK.
- BACKFILL (scripts/auth-backfill.ts, idempotent): 4 memberships ensured, MANAGER/SALES_MANAGER→MEMBER, demo org flagged isDemo, prefs Setting→UserNotificationPreference (9 rows), user locale/timezone from org.
- AUTH CORE: password.ts (Bun bcrypt cost 12 + scrypt fallback + policy), tokens.ts (32B base64url + sha256 + timing-safe), session-store.ts (create/validate with throttled idle-touch/revoke/revokeAll/list + HttpOnly SameSite=Lax cookie, Secure in prod), rate-limit.ts (sliding window + escalating lockout 15m→60m cap), permissions.ts (17 PERMISSIONS constants + ROLE_PERMISSIONS OWNER/ADMIN/MEMBER/VIEWER + normalizeRole legacy map + can()), audit.ts (30 AUDIT_ACTIONS + actor types USER/AUTOMATION/WORKER/SYSTEM/ANONYMOUS).
- context.ts REWORK: production path = cookie token → DB session → ACTIVE user → ACTIVE membership in active org (fallback hop to remaining membership when lost, spec 29); role/permissions from MEMBERSHIP (user.role cache never trusted); demo path = demo org only (leados_uid switcher strictly inside isDemo org); AuthRequiredError/ForbiddenError → apiError() maps 401/403.
- CODEMOD: 80 API route files serverError→apiError (200 replacements).
- ROUTES: auth/login (performLogin service: IP+email rate limit, lockout, enumeration-safe, audit, rotation), logout(+all), me (memberships+sessions), switch-org (membership-validated, demo blocked), bootstrap (one-time gate while zero password accounts; demo-org emails rejected), forgot/reset-password (hashed 1h single-use token, all sessions revoked; email via provider when configured else server console), demo-login (LEADOS_DEMO only), profile (name/locale/timezone), password change (current required, other sessions revoked), invite/accept (acceptInvite service: atomic single-use claim in transaction, new-user + existing-user paths).
- members API: GET list+invites (TEAM_READ), POST invite (MEMBER_MANAGE; OWNER-only ADMIN invites; OWNER never grantable), invite/[id] resend (token rotation)/revoke, members/[id] PATCH role (last-owner 409 BEFORE self-change 400; admin scope 403) / DELETE (last owner 409, admin scope, invite cleanup); users route membership-based; session POST demo-only; seed guarded (empty DB or demo mode).
- member-service + auth-service extracted (cookie-free, testable); audit wired into login/logout/invites/member CRUD/automation CRUD+enable-disable/webhook CRUD+secret ROTATION (POST webhooks/[id]).
- SERVICES: notification-service + projector + fanout → UserNotificationPreference table; fanout renders in RECIPIENT locale (User.locale, org fallback).
- MIDDLEWARE→proxy.ts (Next 16 convention): CSRF Origin check for mutating /api/v1 (webhook/workers/ingest exempt), security headers (nosniff, SAMEORIGIN, referrer, permissions-policy, CSP, HSTS in prod), no CORS ever.
- UI: login screen (login card + demo button gated by server probe + forgot + reset + first-run BootstrapCard), InviteScreen, user menu (profile/org switcher when multi-org/logout/logout-all; demo switcher only in demo), SettingsView: Profile tab (name/locale/timezone/password/sessions), Team tab (members, role select, remove, invite dialog with shareable link), Security Audit tab (filter+pagination); admin tabs hidden without permission (MEMBER sees 3 tabs); DemoBadge only for demo sessions; ?tab= deep-link.
- SEED: isDemo org, memberships per user, prefs rows, MEMBER roles.
- i18n: ~96 keys ×3 locales.

Stage Summary:
- TypeScript PASS, ESLint PASS, 323/323 tests PASS (283 regression + 40 new), production build PASS.

---
Task ID: v0.17-3 (SECURITY TESTS + QA + FINAL VERIFY)
Agent: main
Task: Prove the auth system: unit/integration tests, live HTTP QA, tenant load test, browser QA both modes.

Work Log:
- tests/auth-security.test.ts (40 tests): password hash/verify/policy; tokens; rate limiter window/lockout/clear; permission map incl. legacy MANAGER→MEMBER; session store (hash-only storage, idle+absolute expiry, revoke, revokeAll, disabled user); performLogin (success+audit, enumeration-safe, 5-fail lockout blocks even correct password); resolveAuthenticatedSessionFromToken (membership role beats user.role cache, garbage/revoked→null, membership-loss→null or safe fallback to other org with pointer self-heal, escalation via cache impossible); member guards (MEMBER cannot invite, OWNER not grantable by invite, ADMIN scope, last-owner 409, self-demotion guard, role-cache sync, removal kills session immediately); invite lifecycle (new-user accept+session, reuse→ALREADY_USED, expired, revoked, existing-user requires matching session, token rotation); cross-tenant service write blocked (LEAD_NOT_FOUND); demo isolation (demo user pinned to demo org even with forged pointer); audit actor-typed rows; personal prefs roundtrip (no org Setting rows); fanout renders RU for ru-locale user in hy org.
- scripts/auth-http-qa.ts: PROD pass 47/47 (unauth 401s ×6, demo switcher/demo-login 403, headers, CSRF foreign origin 403, brute-force 429, bootstrap→login cookie HttpOnly+SameSite, enumeration-safe 401, cross-tenant read/write 404, org switch no-membership 404, invite create/accept/reuse, MEMBER automation/webhook 403 + read-only automations, role escalation blocked, OWNER positives, removed membership→immediate 401, logout/logout-all kill both sessions, workers without session 401); workers with x-workers-secret 200; telegram webhook secret-verified 401 without; public ingest 200. DEMO pass 4/4. Self-cleaning QA orgs.
- scripts/auth-tenant-load-test.ts (spec 89): 10 orgs × 5 users × 50 leads; every org sees exactly own 50; 90/90 cross-tenant write probes blocked; 90/90 read probes blocked; session resolution 2.8ms/request; cascade cleanup zero leftovers.
- Browser QA (27 screenshots, download/v017-qa/): demo mode (dashboard + DEMO·synthetic banner, settings 16 tabs for OWNER, Profile tab functional, Team tab with invite dialog → link extraction → second-session acceptance → Anna QA MEMBER joined → MEMBER sees only 3 settings tabs + automations without create button → owner removes her via UI with confirm, Security Audit tab shows MEMBER_INVITED/INVITE_ACCEPTED/LOGIN_SUCCESS, user menu, dark mode, mobile 390×844 no overflow, console clean); production mode (BootstrapCard first-run → Real Estate Co + OWNER Sona → workspace WITHOUT demo banner → invite Tigran → accepts with own session → user menu Logout/Logout everywhere → logout → login screen → login as Sona → dashboard; mobile login screen no overflow; zero console errors). QA orgs deleted after.
- REPAIR LOOPS during QA: (1) removed-member login edge → performLogin now rejects NO_ORGANIZATION (clear 403, no zombie session); (2) last-owner guard reordered BEFORE self-change guard (409 semantics); (3) Next 16 deprecation → middleware.ts renamed proxy.ts (headers verified still applied); (4) test type-guards for true|ServiceError unions; (5) dev-server restart after production build (.next swap).

Stage Summary:
- VERIFIED: user Org A physically cannot read, write or trigger anything in Org B even with forged API payloads — proven at service level, live HTTP level (47/47), scale level (90/90 probes) and browser level.
- Final state: demo mode restored (LEADOS_DEMO=true), 323/323 tests, TS PASS, ESLint PASS, production build PASS, console clean.
- Remaining limitations documented in final report (invite delivery without email provider = shareable link; CSP allows unsafe-inline/eval for Next; password reset via console log in self-hosted mode without provider; lead visibility policy = org-wide for MEMBER; executions history in AuditLog retained forever until org deletion).

---
Task ID: deploy-1
Agent: main (Z.ai Code)
Task: Clone https://github.com/HayDev-lab/HayDevLeadsOS from GitHub and run it in this sandbox.

Work Log:
- Cloned the repo to /home/z/HayDevLeadsOS (full v0.17 codebase, 125KB worklog history).
- Verified repo package.json is IDENTICAL to the sandbox my-project scaffold → reused existing node_modules.
- Stopped the scaffold dev server on :3000; deployed repo into /home/z/my-project: src/, prisma/, public/, scripts/, db/custom.db (11MB pre-seeded demo database), .env (LEADOS_DEMO=true, scheduler 60s), next.config.ts, tailwind.config.ts, components.json, postcss.config.mjs, eslint.config.mjs, tsconfig.json.
- Ran `bun run db:generate` (Prisma client for the 1190-line LeadOS schema) + `prisma db push` → "already in sync" (shipped DB matches schema exactly).
- Kept sandbox gateway Caddyfile unchanged (proxies :3000).
- Started dev server: Next.js 16.1.3 Turbopack ready in 1395ms; LeadOS in-process scheduler started (event reconciler + automation processor + delivery worker all SUCCESS on demo org).
- E2E verification via agent-browser (7 screenshots in download/clone-verify/):
  * Dashboard renders: KPI cards (5 new, 3 SLA breached, 6 overdue follow-ups, 11 stalled, 2 won/2 lost), attention feed, tasks list.
  * Demo session auto-established (Aram Grigoryan, OWNER, HayDev Demo org, hy locale).
  * Leads view: search, 6 filter dropdowns, priority chips, CSV import/export, duplicate scanner.
  * Lead detail (#/lead/...): SLA badges, stage health, action buttons (call/message/email/edit/ERP sync/export), activity timeline, tasks, custom fields.
  * Kanban view, dark-mode toggle, notifications bell (9 unread), mobile 390×844 responsive — all working.
  * Console: zero page errors.
- API smoke tests: /session, /dashboard, /leads, /workers/health → all 200 with correct data.
- `bun run lint` → PASS (zero issues).

Stage Summary:
- HayDevLeadsOS v0.17 is fully deployed and running on port 3000 behind the sandbox gateway.
- Demo data: 31 leads, 27 tasks, 1 pipeline, 4 users (aram/lilit/david/narek @haydev.am), 3 automation rules.
- Demo login is enabled (LEADOS_DEMO=true) — opening / shows the app with an implicit demo session.
- No code changes were needed; the repo ships a complete, self-consistent app + database.
- Verification artifacts: download/clone-verify/01..07*.png

---
Task ID: round2-1
Agent: main (Z.ai Code webDevReview)
Task: Scheduled 15-min review: QA the untested views, fix findings, add features (forecast + i18n), improve styling.

Work Log:
- QA'd all previously untested views via agent-browser (Analytics, Automations, Tasks, Inbox, Team, Settings) — all render, zero console errors. Screenshots in download/round2-qa/ (01–15).
- VLM-assisted UI review. Findings triage: settings 16-tab wrap = acceptable; team red dot = intentional critical pulse; analytics funnel "truncation" = below-fold scroll.
- REAL FINDING 1: systematic i18n gap — Team view fully English, Analytics ~20 hardcoded strings, lead dialog ("Surname", "Initial note…").
- REAL FINDING 2 (false alarm resolved): "stuck" lead dialog was the DUPLICATE DETECTOR working as designed — typed phone matched Vega Logistics exactly; amber banner shown, no lead created. API POST verified separately (probe lead cleaned up).
- NEW FEATURE — Revenue Forecast (v0.18):
  * Backend (analytics-service.ts): per-OPEN-stage win probability computed EMPIRICALLY from STAGE_CHANGE activity history (p = won-after-reaching / resolved-after-reaching, min 2 samples); stages without history fall back to position-based estimate flagged empirical:false (never presented as fact). Returns stages[] + weightedTotal + bestCase + commit (≥60%) + empiricalCoverage.
  * Frontend (analytics-view.tsx): new ForecastCard — gradient headline number, commit→forecast→best-case range bar with markers, per-stage rows (count, value, probability chip with tooltip showing empirical/estimate + sample size, weighted value bar; hatched style for estimates), staggered framer-motion entrance, mobile 2-line layout, hint line. Empirical chips solid, estimate chips dashed-border muted.
  * Seed (seed.ts): new SeedLead fields entryStageIdx/lostAtStageIdx; resolved leads now get FULL transition history (entry→furthest open→terminal, deterministic timestamps, metadata.to on every hop); open leads' single activity now carries metadata. Demo design: Mher W full path, Gayane W enters at Qualified (business_audit), Pavel L lost at Negotiation, Anahit L lost at Proposal.
  * Backfill script (scripts/backfill-forecast-history.ts): synthesized histories for the 4 pre-existing resolved leads + repaired metadata.to on 22 old activities. Idempotent. Result: 100% empirical coverage, probabilities 33/33/50/50/50/67%, samples 3/3/4/4/4/3.
- I18N: +95 keys ×3 locales (hy/ru/en) — full Team view, all Analytics card titles/descriptions/bucket labels/ROI table headers, forecast keys, common.surname, lead.note_placeholder.
- STYLING: KPI cards get leados-lift hover + entrance motion; heatmap cells scale on hover; forecast card gradient header; probability bars with hatched estimate pattern.
- INFRA INCIDENT: dev server killed by OOM killer twice (next-server ~2GB RSS + stale Chromium renderers ~700MB on 4.1GB machine). Fixed: closed stale browser daemon; restarted with the persistent pattern `(nohup bun run dev &)`. Server now stable across commands. NOTE for future rounds: close agent-browser between test batches; if next-server RSS > ~1.5GB, schedule a restart.
- VERIFY: lint PASS (0 issues); dev.log clean (0 errors); API /analytics returns forecast; browser QA — forecast card renders (light+dark, hy+ru), Team view localized (hy/ru verified in DOM), lead dialog placeholders localized, locale restored to hy; screenshots 11–15.

Stage Summary:
- App stable; new Revenue Forecast feature fully working with honest empirical/estimate distinction.
- i18n coverage now includes Team + Analytics + lead form; stage NAMES remain English by design (org-configurable data, consistent across locales).
- Open risks: (a) OOM fragility on this 4.1GB sandbox — keep browser closed when idle; (b) forecast commit threshold hardcoded 60%; (c) forecast samples depend on stage history — CSV-imported leads without transitions undercount "reached" stages.
- Next round suggestions: restart-safe server monitoring; consider localizing seeded stage names per-locale (needs stageName i18n overlay); dashboard mini-forecast widget; weekly-won run-rate in forecast card.

---
Task ID: round3-1
Agent: main (Z.ai Code webDevReview)
Task: Scheduled 15-min review: assess stability, then implement the worklog's "next round suggestion" — dashboard mini-forecast widget.

Work Log:
- STATUS CHECK: server healthy (auto-persisted since round 2 fix), forecast API intact (100% empirical coverage, weighted 18.4M), lint clean. QA screenshots: round3-qa/01–02.
- WORK FOCUS (from round2 suggestions): dashboard mini-forecast widget + finishing dashboard i18n leftovers.
- NEW FEATURE — Dashboard Revenue Forecast Widget (dashboard-view.tsx):
  * Added useAnalytics() to DashboardView; widget renders next to the by-source chart (stacks with by-stage chart in a right column).
  * Design: gradient headline (weighted forecast) + commit/best-case values, compact range bar with commit marker, top-3 stages by weighted value as mini chips (name, value, probability bar — solid for empirical, muted for estimates), empirical coverage badge in header, whole card clickable → navigates to #/analytics, "actions →" affordance on hover.
  * Honest-data design preserved: estimate bars visually muted exactly like the full forecast card.
- I18N FIXES (dashboard): "X active leads" → "{totalActive} · {t(team.active)}"; "Conversion funnel" → t(analytics.funnel.title). No new keys needed (reuse).
- STYLING: widget card has gradient background wash (from-primary/5), border-primary/20, leados-lift hover; headline gradient animates opacity on hover; range bar has 700ms width transition.
- VERIFY (agent-browser + VLM):
  * Renders correctly — VLM: "Layout is clean... No overlaps or critical defects... integrates seamlessly".
  * Click navigation works (clicked widget → URL #/analytics, title "Վերլուծություն").
  * Mobile 390×844: no horizontal scroll, widget stacks cleanly, chips readable (VLM confirmed).
  * Dark mode: gradient number and labels high contrast (VLM confirmed).
  * lint PASS, dev.log 0 errors, browser console clean.

Stage Summary:
- Dashboard now surfaces the revenue forecast without navigating to Analytics — headline number + commit + best case + top stages in one glance.
- All round-2 suggestions except stage-name i18n overlay are done.
- Open risks: (a) dashboard now fires the analytics query (heavier — ~6 extra DB aggregate scans) on every dashboard visit; acceptable for demo scale, worth caching if orgs grow; (b) OOM fragility still present (browser closed when idle this round, no incidents); (c) stage names still English-by-design.
- Next round suggestions: (1) API-level caching for analytics/dashboard (in-memory TTL cache — matches "local memory caching" stack rule); (2) weekly-won run-rate line in forecast card; (3) keyboard shortcut palette (⌘K search exists — verify and extend to actions); (4) lead detail: revenue-impact badge when lead stage changes.

---
Task ID: round4-1
Agent: main (Z.ai Code webDevReview)
Task: Scheduled 15-min review: assess stability, then implement round-3 suggestions — command palette, API-level caching, forecast run-rate + styling polish.

Work Log:
- STATUS CHECK: server healthy (scheduler SUCCESS cycles, dev.log clean), dashboard renders, zero console errors.
- NEW FEATURE 1 — Command Palette ⌘K (v0.19, src/components/leados/command-palette.tsx):
  * Full replacement of the old lead-only SearchTrigger (deleted from header-controls.tsx; app-shell now renders CommandPalette).
  * Groups: LEADS (server /search results ≥2 chars, avatar + name + company·phone + stage chip + ↵ icon), GO TO (all 9 sidebar views + notifications "view all"), ACTIONS (New lead → navigates to #/leads and fires `leados:new-lead` custom event; Toggle dark mode), LANGUAGE (hy/ru/en with current-locale marker).
  * Built on shadcn command.tsx (cmdk) composed directly with Dialog (CommandDialog wrapper can't pass shouldFilter=false).
  * shouldFilter=false + manual client-side filtering of static groups — server-returned leads never hidden by cmdk's local fuzzy filter; own empty state (icon + no-results + hint), searching spinner strip under input, kbd footer (↑↓ · hint · ⌘K), mobile icon trigger + desktop input-look trigger with focus-visible ring.
  * LeadFormDialog now supports CONTROLLED mode (open/onOpenChange props, internal-state fallback); LeadsView listens for `leados:new-lead` and opens the dialog.
  * i18n: +16 palette keys ×3 locales.
- NEW FEATURE 2 — API response cache (src/lib/leados/api-cache.ts):
  * cached(key, ttl, fn) per-org TTL cache, 512-entry insert-order eviction, lazy expiry sweep; invalidateOrgCache() drops all scopes for an org.
  * WIRED: /analytics (90s TTL) + /dashboard (45s TTL).
  * INVALIDATION: lead-service createLead/updateLead/changeStage/assignLead/archiveLead/restoreLead/mergeLeads + task-service createTask + tasks/[id] PATCH/DELETE + leads/bulk POST (raw updateMany path). Import/ingest covered via createLead.
  * CRITICAL FIX during QA: module-level Map was DUPLICATED per Turbopack route graph (invalidation from lead-service never reached the analytics route's copy — served stale 31 vs 32). Fixed by moving the store to globalThis.__leadosApiCache (same singleton pattern as db.ts Prisma client).
  * MEASURED: analytics 406ms → 14ms (28x) cached; dashboard 124ms → 11ms (11x); after a lead mutation the next call recomputes (verified totalLeads 31 → 32 → 31 with create/delete probe).
- NEW FEATURE 3 — Weekly-won run-rate (forecast):
  * analytics-service: forecast.runRate {last7Wins, last7Value, weeklyValue (30d×7/30 smoothed), weeklyCount}.
  * ForecastCard: dashed emerald strip under the range bar — TrendingUp icon, "Run-rate (30d)" label, bold weekly value, "per week", right-aligned "{n} · 7d" wins pill; full hint in tooltip.
  * TYPE FIX (latent round-2 bug): useAnalytics return type was missing `forecast` entirely — added full forecast + runRate typing.
- STYLING: sidebar active nav item now has a left accent bar (primary-foreground/80 pill, also visible on mobile sheet); cmdk selected items get a 2px primary left accent via globals.css [data-slot=command-item][data-selected=true]; palette trigger focus-visible ring; run-rate strip itself is a new visual element (dashed emerald).
- REACT COMPILER fixes: removed useMemo around trivial filters in palette (compiler rejected the match-closure dependency pattern); removed unused eslint-disable directives; renamed lucide Command icon import (clashed with cmdk Command).
- VERIFY: ESLint PASS (0 issues), tsc --noEmit PASS (src/), dev.log 0 errors, browser QA round4-qa/01-11: palette opens via ⌘K (placeholder "Որոնում կամ անցում…"), lead search "ann" → 3 results (Anna/Hovhannes/Anahit with avatars), Enter → lead detail, "analytics" → #/analytics, "Նոր լիդ" → #/leads + create dialog opens, theme toggle → dark on, language switch EN → instant ("Analytics" h1, "Run-rate (30d) 1.1M AMD per week") and back to hy, empty state ("Արդյունքներ չկան։"), run-rate strip renders light+dark (hy+en), mobile 390×844 no horizontal overflow, sidebar active indicator confirmed in DOM, VLM review of palette + dark analytics: clean, no defects, zero console errors. Locale and theme restored to original (hy / light).
- NOTE: probe leads cleaned up (created 3, deleted 3 — DB back to 31 leads).

Stage Summary:
- ⌘K is now a full command palette (search + navigation + actions + language), the forecast card answers "how fast is revenue landing", and the heaviest read APIs are cached with correct mutation-driven invalidation.
- Cache is single-process by design (matches local-memory-caching stack rule); multi-instance deployments would need per-node or shared caching.
- Open risks: (a) OOM fragility unchanged (browser closed when idle this round, no incidents); (b) forecast commit threshold still hardcoded 60%; (c) stage names still English-by-design; (d) settings/pipeline mutations are not cache-invalidated (bounded by TTL 45-90s, acceptable).
- Next round suggestions: (1) recently-viewed leads section in the palette (localStorage history); (2) lead-detail revenue-impact badge when stage changes (round-3 leftover); (3) cache TTL/invalidation for /team and /inbox stats; (4) stage-name i18n overlay; (5) keyboard shortcut hints in sidebar tooltips.

---
Task ID: round5-1
Agent: main (Z.ai Code webDevReview)
Task: Scheduled 15-min review: assess stability, QA, then implement round-4 suggestions — recently-viewed leads in palette, lead-detail revenue-impact, /team + /inbox caching, sidebar ⌘K affordance + styling polish.

Work Log:
- STATUS CHECK: next-server RSS had grown to ~1.9GB (above the 1.5GB OOM threshold from round 2) → proactively restarted dev server via the (nohup bun run dev &) pattern BEFORE browser QA. During the round the server was OOM-killed once more (1.6GB anon-rss; dmesg confirmed) while stale agent-browser Chromium renderers (~15 processes) held memory — closed browser daemon, restarted, and closed it again after each test batch. LESSON REINFORCED: never leave agent-browser running between batches on this 4.1GB box.
- QA ROUND: all 9 views + lead detail + ⌘K palette render with ZERO console errors. Found and deleted 1 leftover QA probe lead ("HTTP QA", 31→30 leads). Kanban/palette/dashboard/notifications all healthy. Screenshots round5-qa/01–03.
- NEW FEATURE 1 — Recently-viewed leads in ⌘K palette (v0.20):
  * src/lib/leados/recent-leads.ts: localStorage utility (key leados:recent-leads, max 5, most-recent-first, dedupe by id, corrupt-JSON-safe).
  * LeadDetailView records every opened lead (ref-guarded effect; name/company/phone/avatarColor/stageName captured).
  * Palette: "Recent" group (i18n'd, hy/ru/en) rendered above "Go to"; rows show avatar, name, company·phone, stage chip + History icon. Derived via useMemo on open (lint-clean: no setState-in-effect; recomputes exactly when palette opens). Client-side filterable like other static groups.
- NEW FEATURE 2 — Revenue-impact stage changer (round-3 leftover):
  * StageChanger now pulls the empirical forecast (useAnalytics → forecast.stages, matched by stage NAME) and renders: probability % chip on every open-stage button (solid emerald = empirical, dashed muted = position estimate — same honesty language as the Analytics forecast card), and for leads with estimatedValue a weighted-delta badge (+/−AMD, emerald/rose, TrendingUp/Down icons, lg+ only) vs the current stage.
  * Stage-change success fires a localized toast: "Կշռված փայփայումը փոխվեց՝ +306K AMD" (hy) / "Взвешенный пайплайн: {delta}" (ru) / "Weighted pipeline {delta}" (en).
  * Card footer hint line explains probability provenance (empirical vs estimate).
  * VERIFIED MATH: Sergey Ivanov (1.8M AMD, Contacted 33%) → Qualified (50%) shows +306K = 1.8M×17pp; Meeting (67%) shows +612K = 1.8M×34pp. Toast verified live; demo lead reverted after test.
- NEW FEATURE 3 — API caching for /team + /inbox stats:
  * /team: cached(`team:<org>`, 60s) → measured 130ms → 11ms (11×) on repeat.
  * /inbox?view=stats: cached(`inbox-stats:<org>`, 30s) — this endpoint feeds the sidebar badge poller; TTL-bounded staleness documented in route comments.
- NEW FEATURE 4 — Sidebar ⌘K search affordance:
  * New SidebarSearchButton under the sidebar nav (desktop): Search icon + localized placeholder + ⌘K kbd chip; dispatches leados:open-palette custom event (palette now listens for it). Makes the palette discoverable without knowing the shortcut. Mirrors the header trigger's visual style for consistency.
- STYLING POLISH (mandatory):
  * Probability chips + delta badges (feature 2) are themselves a major visual upgrade of the stage card.
  * Command palette: elevated spotlight shadow on the dialog (deep drop + hairline ring), slim 6px custom scrollbar on the command list, footer breathing room py-2→py-2.5 (VLM suggestion).
  * Sidebar: search button slot with space-y-3 rhythm above the EVERY LEAD tagline.
- I18N: +7 keys ×3 locales (palette.group.recent, lead.impact.toast/samples/estimate/hint, sidebar.search_hint; hy wording proofread — գնահատական).
- LINT FIX during QA: initial recent-leads state update in effect violated react-hooks/set-state-in-effect → refactored to useMemo-on-open derivation (cleaner semantics, zero lint suppressions).
- VERIFY (agent-browser + VLM):
  * ESLint PASS (0 issues), tsc --noEmit PASS (src/; only pre-existing examples/skills errors).
  * All 9 views + lead detail: zero console errors, before and after changes; no horizontal overflow at 1280 and 390.
  * Palette Recent group: ordering verified (Elena→Irina→Sergey after 3 lead visits), click navigates to lead detail, localStorage contents match UI.
  * Stage card: chips + deltas + hint render (light + dark + EN + RU + hy); toast fires with correct amount; VLM review of scrolled stage card: "polished, functional, ready for production. No critical issues."
  * Dark palette VLM review: AAA contrast, perfect alignment; only minor footer-padding note (fixed).
  * Locale cookie switching verified EN ("Recently viewed", "Change stage", hint) and RU ("Недавние"); restored hy default.
  * Screenshots round5-qa/01–12 (palette, lead detail, kanban, stage-impact light/dark/EN, sidebar button, mobile 390×844, final dashboard).

Stage Summary:
- Four round-4 suggestions implemented (recent-leads palette, revenue-impact badge, team/inbox caching, sidebar shortcut hint) + styling polish; all verified across locales/themes/viewports with zero console errors.
- The lead-detail stage card is now revenue-aware: every stage button answers "what is this worth weighted?" before the user moves the lead.
- Cache coverage now: analytics(90s), dashboard(45s), team(60s), inbox-stats(30s); mutation-driven invalidation still wired only for lead/task mutations (settings/pipeline bounded by TTL — acceptable).
- Open risks: (a) OOM fragility remains the #1 operational risk — this round had one kill (1.6GB rss) despite precautions; recommend a periodic scheduled restart or NODE_OPTIONS=--max-old-space-size cap next round; (b) forecast stage matching is by stage NAME (unique per pipeline today, would need ID in forecast payload if orgs rename stages to duplicates across pipelines); (c) stage names still English-by-design.
- Next round suggestions: (1) dev-server memory mitigation (max-old-space-size / scheduled restart / Turbopack memory flags); (2) stage-name i18n overlay or rename stage.name→id in forecast payload; (3) "Copy lead link" share action in lead header; (4) keyboard shortcut for new lead (e.g. ⌘⇧N) wired to the existing leados:new-lead event; (5) settings mutations → cache invalidation.

---
Task ID: round6-1
Agent: main (Z.ai Code webDevReview)
Task: Scheduled 15-min review: assess stability, QA via agent-browser, fix findings, then implement round-5 suggestions — ⌘⇧N new-lead shortcut, copy-lead-link, settings/pipeline/member cache invalidation, dev-server memory mitigation — plus mandatory styling polish.

Work Log:
- STATUS CHECK: server healthy (scheduler SUCCESS cycles, dev.log clean, all 9 views + lead detail render with ZERO console errors; QA screenshots round6-qa/01–07). next-server RSS was 1.68GB (above the 1.5GB OOM threshold); dmesg later confirmed the OLD uncapped server had been OOM-killed once (~03:14, before this round's restart).
- MEMORY MITIGATION (round-5 suggestion #1, delivered):
  * package.json dev script now runs with NODE_OPTIONS=--max-old-space-size=1536 — bounds V8 old-space so GC works harder before the kernel OOM-killer fires.
  * Restarted the dev server (RSS 1.68GB → 545MB fresh). The capped server survived a FULL browser QA round with Chromium open (~700MB) — no OOM kill this round (previous rounds lost the server at least once per round).
- NEW FEATURE 1 — Global new-lead shortcut (v0.21, command-palette.tsx):
  * ⌘⇧N / Ctrl+Shift+N AND Alt+N (browser-safe alternative — Chrome reserves Ctrl+Shift+N for incognito on some platforms) create a lead from ANY view: navigate("leads") + existing `leados:new-lead` event → controlled LeadFormDialog opens.
  * Implementation: newLeadFromShortcut wrapped in useCallback([navigate]) (navigate is stable in useHashRoute); global keydown effect extended, deps clean.
  * Discoverability: kbd chip "⇧⌘N" on the leads-view "New lead" button (hidden on mobile, title tooltip) + kbd chips on the palette ACTIONS item.
  * VERIFIED live: Alt+N from a lead-detail page → URL #/leads + "Նոր լիդ" dialog open (agent-browser press Alt+n).
- NEW FEATURE 2 — Keyboard shortcuts help sheet (v0.21, command-palette.tsx):
  * "?" (and plain "/" — Shift+Slash doesn't produce "?" on Armenian/national layouts) opens a styled shortcuts dialog: ⌘K palette, ⇧⌘N + Alt+N new lead, ↑↓ navigate, ↵ select, Esc close, ? help. Guarded by isTypingContext so it never fires while typing in inputs.
  * Palette ACTIONS group gains "Keyboard shortcuts" item (Keyboard icon + "?" kbd chip); palette footer now shows "⌘K · ?" hint.
  * Full i18n ×3 locales (6 new keys: shortcuts.title/palette/navigate/select/close/help).
  * VERIFIED live: synthetic "?" keydown opens sheet; physical "/" press opens sheet (after HMR); EN locale shows "Keyboard shortcuts"; palette filter "keys" narrows to the item.
- NEW FEATURE 3 — Copy lead link (v0.21, lead-detail-view.tsx):
  * LeadHeader gains a "Copy link" button: navigator.clipboard.writeText(`${origin}/#/lead/${id}`) with textarea+execCommand fallback and toast-error showing the raw URL as last resort; emerald success state (Check icon + "Copied") for 2s.
  * i18n keys lead.copy_link / lead.link_copied_short / toast.lead_link_copied ×3 locales.
  * VERIFIED live: click → toast "Լիդի հղումը պատճենվեց սեղմատախտակ"; EN shows "Copy link".
- NEW FEATURE 4 — Lead header "More" overflow menu (v0.21):
  * VLM flagged the 10-button action wall. Row reduced to 6: Call (primary), Message, Email, Edit, Copy link + "⋯ More" DropdownMenu holding ERP sync, Score recalc, Export activity, QuoteFlow (disabled), separator, destructive red Archive.
  * Archive converted from AlertDialogTrigger-wrapping-a-button to a CONTROLLED AlertDialog (open/onOpenChange state) opened from the menu item — avoids Radix nested-portal issues.
  * VERIFIED live: menu opens with all 5 items; Archive → confirmation AlertDialog renders; cancelled safely. VLM review of the decluttered header: "well-structured and clean… clear visual hierarchy".
- NEW FEATURE 5 — Cache invalidation for org-config mutations (round-5 suggestion #5):
  * invalidateOrgCache(orgId) now fires on: settings PATCH (org/scoring), pipeline stage POST/PATCH/DELETE, members PATCH (role change) / DELETE (removal), auth invite accept (new membership → /team cache).
  * Rationale comments in each route; invite create/resend/revoke deliberately NOT invalidated (team-service returns no pending invites).
  * VERIFIED via curl timing: /team 43ms → 9.7ms (cached) → settings PATCH 200 → 35.5ms (recomputed) — invalidation works end-to-end.
- STYLING POLISH (mandatory, VLM-triage then code-verified):
  * Dashboard KPI labels: truncate → line-clamp-2 + min-h-[2.4em] + title tooltip (DOM-verified: 9/10 labels now fully readable in 2 lines, the 10th clips slightly but has a tooltip; before: ALL were single-line ellipsized).
  * Armenian all-caps section headers (attention banner + today queue): removed `uppercase` (Armenian caps are hard to read); kept font-semibold + tracking-wide.
  * Lead contact info: Field values now font-medium (clearer value-vs-label hierarchy).
  * Leads table company column: max-w 160→220px + title tooltip.
  * Sidebar inbox badge: washed sky chip → solid bg-primary text-primary-foreground shadow-sm (+ tabular-nums).
  * New-lead button + palette items carry kbd hint chips (consistent with palette trigger style).
- i18n total: +18 keys ×3 locales (copy_link ×3, shortcuts ×6, common.more, toast, kbd hints are symbols).
- VERIFY (agent-browser + VLM + curl):
  * ESLint PASS (0 issues), tsc --noEmit PASS (src/).
  * All 9 views + lead detail: zero console errors; mobile 390×844 NO horizontal overflow (dashboard + lead detail); dark-mode lead header verified.
  * Palette: ⌘K opens; "keys" filter works; shortcuts item present; footer hint updated.
  * EN locale verified (Copy link / Keyboard shortcuts / filter), locale + light theme restored to hy.
  * 18 screenshots in download/round6-qa/ (01–18).

Stage Summary:
- v0.21 shipped: global ⇧⌘N/Alt+N new-lead shortcut, "?" shortcuts help sheet, copy-lead-link with copied feedback, decluttered 6-button lead header with More menu, mutation-driven cache invalidation for org-config changes, and the long-awaited dev-server memory cap.
- The memory cap is the first round since round 2 with ZERO OOM incidents while running full browser QA.
- Cache coverage now: analytics(90s), dashboard(45s), team(60s), inbox-stats(30s) — invalidated by lead/task mutations AND settings/stage/member mutations.
- Open risks: (a) V8 old-space cap doesn't bound non-heap (external/Turbopack) memory — RSS can still reach ~1.8GB; restart before QA if RSS creeps higher; (b) Ctrl+Shift+N reserved on some Chrome platforms — Alt+N documented as the fallback; (c) stage names still English-by-design (i18n overlay pending); (d) "Priority: Low" chip contrast in dark mode flagged by VLM (pre-existing primitives design, not touched); (e) forecast commit threshold still hardcoded 60%.
- Next round suggestions: (1) stage-name i18n overlay (long-standing); (2) priority-badge dark-mode contrast pass in primitives.tsx; (3) "/" key could also focus the palette search (common convention) instead of only opening help; (4) users/sources/tags route mutations → cache invalidation if those endpoints gain caching; (5) kanban drag-and-drop regression round; (6) add a "shortcuts" hint row to the sidebar search button tooltip.

---
Task ID: round7-1
Agent: main (Z.ai Code webDevReview)
Task: Scheduled 15-min review: assess stability, QA via agent-browser (incl. kanban drag regression), fix findings, then implement the long-standing stage-name i18n overlay + routing hygiene + priority-badge contrast.

Work Log:
- STATUS CHECK: server healthy (scheduler SUCCESS, dev.log clean). next-server RSS had crept to 1845MB despite the v0.21 V8 cap (cap doesn't bound non-heap/Turbopack memory, as predicted) → restarted BEFORE QA (RSS → 608MB). Zero OOM incidents this round.
- QA SWEEP (agent-browser, screenshots round7-qa/01–02): all 9 views + lead detail + palette + help sheet render, zero console errors, mobile 390×844 no-overflow.
- REAL FINDING (routing robustness): URL #/kanban rendered the DASHBOARD (content/URL mismatch) — unknown hash views silently fell back to `dashboard` in app-shell's view resolution. The app itself never links #/kanban, but stale/typo'd/deep links hit this.
- KANBAN DRAG REGRESSION (round-6 suggestion, delivered): simulated a REAL dnd-kit pointer drag with agent-browser mouse events (move → down → incremental moves → up) on Tigran Petrosyan's card → stage changed New → Meeting via the live API, kanban reflected it, zero console errors. Reverted both probe changes (Tigran → New, later Lyudmila → Qualified) via PATCH; DB back to pristine demo state.
- NEW FEATURE — STAGE-NAME i18n OVERLAY (v0.22, the long-standing "stage names English-by-design" item):
  * Architecture: stages are org-configurable DATA (PipelineStage.name, canonical English as seeded). A DISPLAY-ONLY overlay localizes exactly the canonical names — every matching/filter/API/automation path keeps using the raw DB name, and orgs that rename a stage see their custom name verbatim (honesty preserved).
  * i18n.ts: +8 keys `stage.name.*` ×3 locales (hy: Նոր/Կապ հաստատված/Որակավորված/Հանդիպում/Առաջարկ/Բանակցություն/Շահված/Կորսված; ru: Новый/Связались/…; en: identity no-op) + exported STAGE_NAME_OVERLAY_KEYS map + localizeStageName(t, name) helper.
  * Applied at 11 render points: StageBadge (primitives.tsx — the choke point covering leads table, lead header, kanban cards), kanban column headers (pipeline-view), StageChanger buttons (lead-detail), analytics funnel rows + forecast per-stage rows, dashboard by-stage MiniBar labels + forecast widget top-3 chips, palette lead chips + recent-leads chips, duplicates scanner badge, stage filter/bulk dropdowns (leads-view), notification message vars (display-time, matching the "structured data, never frozen translation" architecture).
  * Raw DB name preserved in `title` tooltips wherever the overlay changes the display.
  * BONUS i18n gaps found + fixed during implementation: leads-view priority FILTER buttons were hardcoded English ("Low/Medium/High/Urgent") → now t(priority.*) with PRIORITY const keys; bulk priority SelectItems likewise.
  * VERIFIED live: dashboard 10 localized labels; kanban all 8 columns localized (hy/ru verified, en identity); StageChanger 8/8 buttons localized; leads table 14 localized badges; analytics forecast+funnel localized; localized stage CLICK still changes the stage correctly (Lyudmila Qualified → Contacted via UI click → API confirmed → reverted); priority buttons show Ցածր/Միջին/Բարձր/Շտապ.
- BUG FIX — ROUTING HYGIENE (v0.22, app-shell.tsx):
  * VIEW_ALIASES { kanban: "pipeline" } — common alternative hash names resolve to the real view (#/kanban now renders the Kanban, verified).
  * Unknown hash views (typos/stale links) now NORMALIZE to #/dashboard via effect so the URL always matches the rendered content (verified: #/leadz → #/dashboard + dashboard h1).
  * Implementation detail: the hygiene effect runs BEFORE all early returns (rules-of-hooks — initial version tripped eslint, fixed); route gating now uses a knownView boolean (also handles the "invite" deep-link view which previously bypassed EXTRA_VIEWS).
- STYLING (mandatory): PriorityBadge text contrast stepped up (light: slate-600→700, sky-700→800; dark: slate-300→200, sky-300→200) — the round-6 VLM-flagged washed-out look.
- DARK-MODE CORRECTION (important for future rounds): the theme provider is `attribute="class" defaultTheme="light" enableSystem={false}` — `agent-browser set media dark` does NOTHING for this app. Round-6's "dark" screenshots 13–14 were actually LIGHT mode (VLM comments about "white background" now explained). This round: real dark mode via the theme TOGGLE click, verified `document.documentElement.className === "dark"`, leads table screenshotted (13-leads-dark-REAL.png), Urgent badge computed colors checked programmatically: bg L*16 / text L*92 ≈ 12:1 contrast — VLM's "red-on-red unreadable" claim was a hallucination; badges are fine. Round-6 worklog dark claims corrected by this entry.
- VERIFY: ESLint PASS (0 issues), tsc --noEmit PASS (src/), dev.log 0 errors, browser console clean across all views, 13 screenshots in download/round7-qa/ (01–13).

Stage Summary:
- v0.22 shipped: stage names now fully localized across the entire UI (display-only overlay, custom names verbatim, raw names in tooltips) — the oldest open i18n item since round 2 is CLOSED.
- Routing hardened: kanban alias + unknown-hash normalization (URL always matches content).
- Kanban drag-and-drop regression PASSED with a real pointer-level drag.
- Remaining open risks: (a) RSS still creeps to ~1.8GB over hours — restart before heavy QA rounds (this round: 608MB → 1.79GB after full QA; no OOM); (b) forecast stage matching is still by NAME (overlay didn't change this — display-only by design); (c) `agent-browser set media dark` is a NO-OP for this app — always use the theme toggle for dark QA; (d) settings stage-rename input correctly stays raw (org data editing).
- Next round suggestions: (1) users/sources/tags mutation routes → cache invalidation (if those endpoints get cached); (2) drag-drop coverage for mobile kanban if dnd-kit touch sensor is enabled; (3) localize remaining hardcoded strings audit (e.g. "Move to stage…"/"Priority…" bulk placeholders, "Matched by {reason}" in duplicates scanner, "KEEP" chip); (4) forecast commit threshold → org-configurable setting; (5) consider hash-restore for back/forward navigation UX.
