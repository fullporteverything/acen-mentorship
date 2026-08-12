# Platform Hardening and Product Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace unsafe mutable Blob metadata with Neon-backed transactions, remove known high/critical dependency findings, and deliver the approved admin, learning, support, security, and restrained visual improvements without losing existing data.

**Architecture:** Vercel Blob remains the private binary store. A repository boundary selects `blob`, `dual`, or `postgres`; Neon Postgres becomes authoritative after an idempotent checksum-verified import. Security and product features consume centralized authorization, validation, audit, and database services instead of writing JSON records directly.

**Tech Stack:** Next.js 16.3.0, React 19, NextAuth 5.0.0-beta.32 / Auth.js 0.41.3+, Neon Serverless 1.1.0, Drizzle ORM 0.45.2, Drizzle Kit 0.31.10, Zod 4.4.3, file-type 22.0.1, pdf-parse 2.4.5, Vitest, Kinescope, Vercel Blob, Framer Motion, Three.js.

## Global Constraints

- Preserve all legacy Blob metadata and every referenced PDF/image; no legacy deletion in this program.
- Preserve CORE-only progression, supplemental gating after CORE Lecture 04, and owner main/alt progress union.
- Do not claim the browser detects Discord, OBS, OS, GPU, HDMI, camera, or hardware capture.
- Keep moving Discord username/ID watermarks and wrapper fullscreen for every account.
- Use tests first for every behavior change and verify the expected failure before implementation.
- Create local checkpoint commits only. Push GitHub `main` once, after every release gate passes.
- `npm audit --omit=dev` must report zero high and critical findings before release.

---

### Task 1: Framework, Auth, and Authorization Foundation

**Files:**
- Modify: `package.json`, `package-lock.json`, `next.config.mjs`, `auth.ts`, `app/api/auth/[...nextauth]/route.ts`
- Create: `lib/authz.ts`, `lib/authz.test.ts`, `lib/discord-membership.ts`, `lib/discord-membership.test.ts`, `lib/security-headers.test.ts`
- Modify: protected dashboard pages, Server Actions, and API routes to consume `requireMember()` / `requireAdmin()`

**Interfaces:**
- Produces: `requireMember(): Promise<MemberIdentity>`, `requireAdmin(): Promise<MemberIdentity>`, `verifyDiscordMembership(discordId, accessToken?): Promise<RoleCheckResult>`.

- [ ] Write failing tests for anonymous/member/admin authorization, owner/alt identity, removed role, temporary Discord failure, and required security headers.
- [ ] Run the focused tests and verify they fail because the centralized helpers and headers do not exist.
- [ ] Upgrade framework/auth dependencies, remove persisted OAuth access tokens, implement bounded role revalidation, and migrate protected entry points to the helpers.
- [ ] Add CSP, frame restrictions, content-type, referrer, permissions, and cross-origin headers compatible with Discord, Kinescope, Vercel Blob, fonts, and current scripts/styles.
- [ ] Run focused tests, full tests, typecheck, build, and production audit; resolve upgrade regressions without weakening authorization.
- [ ] Commit locally: `feat: harden framework authentication and request headers`.

### Task 2: Neon Schema and Transaction Services

**Files:**
- Modify: `.env.example`, `package.json`
- Create: `drizzle.config.ts`, `lib/db/client.ts`, `lib/db/schema.ts`, `lib/db/schema.test.ts`, `lib/db/transactions.ts`, `lib/db/transactions.test.ts`, `drizzle/*.sql`

**Interfaces:**
- Consumes: `DATABASE_URL` supplied by the Neon/Vercel integration.
- Produces: typed Drizzle tables and `dbTransaction(fn)` plus repository-ready row types.

- [ ] Write failing schema tests for all tables, foreign keys, uniqueness rules, soft deletes, immutable submission versions, strike locking, receipts, audit events, rate buckets, migration runs/items, transcript cues, lesson notes, and support messages.
- [ ] Verify failure before schema creation.
- [ ] Add Neon/Drizzle dependencies, create the schema and initial SQL migration, and provision the Neon project through the approved Vercel/Neon integration.
- [ ] Write failing concurrency tests for duplicate receipts, simultaneous strike increments, simultaneous journal writes, and homework review/resubmission ordering.
- [ ] Implement transaction helpers and constraints until every concurrency test passes.
- [ ] Run migrations against an isolated verification branch/database and run schema/integration tests.
- [ ] Commit locally: `feat: add transactional Neon data model`.

### Task 3: Repository Boundary and Lossless Blob Migration

**Files:**
- Create: `lib/repositories/index.ts`, `lib/repositories/types.ts`, `lib/repositories/blob-repository.ts`, `lib/repositories/postgres-repository.ts`, `lib/repositories/dual-repository.ts`
- Create: `scripts/migrate-blob-to-neon.ts`, `scripts/verify-neon-migration.ts`, `scripts/migration-fixtures/*`
- Create: repository and migration tests under `lib/repositories/*.test.ts` and `scripts/*.test.ts`
- Modify: existing `lesson-store.ts`, `journal-store.ts`, `security-store.ts`, `watch-progress-store.ts`, profile/notification callers

**Interfaces:**
- Produces: `getRepository(backend: "blob" | "dual" | "postgres"): PlatformRepository` and restart-safe migration commands.

- [ ] Write failing contract tests that run identical member/progress/homework/journal/security/announcement/receipt/watch operations against Blob fixtures and Postgres.
- [ ] Implement the common repository interface and Blob adapter without changing legacy behavior.
- [ ] Implement the Postgres adapter using transactions and versioned records.
- [ ] Write failing migration tests for complete, partial, corrupt, duplicated, missing-file, and rerun fixtures.
- [ ] Implement manifest generation, normalized checksums, idempotent import, per-item reporting, count comparison, dual writes, and safe shadow-read mismatch reporting.
- [ ] Run a production-Blob read-only dry run, import into Neon, verify per-family/member counts and checksums, and save the report under `.superpowers/sdd/` without secrets.
- [ ] Exercise `blob` rollback and block `postgres` selection on unresolved mismatches.
- [ ] Commit locally: `feat: add verified Blob to Neon migration`.

### Task 4: Rate Limits, Audit Events, Network Risk, and Upload Safety

**Files:**
- Create: `lib/rate-limit.ts`, `lib/audit.ts`, `lib/network-risk.ts`, `lib/upload-validation.ts`, `lib/malware-scan.ts` and focused tests
- Modify: mutation/API routes, homework upload, journal upload, Blob proxy, admin operations, `VpnGuard.tsx`

**Interfaces:**
- Produces: `consumeRateLimit(subject, action, policy)`, `recordAuditEvent(event)`, `assessNetworkRisk(ip)`, `validatePdf(file)`, `validateImage(file)`, `scanUpload(blobPath)`.

- [ ] Write failing tests for rate windows, immutable audit rows, HTTPS/fail-open risk checks, PDF magic bytes/parseability, image signature/dimension checks, safe content disposition, and quarantine behavior.
- [ ] Implement Postgres-backed rate limiting and audit recording around every approved sensitive route/action.
- [ ] Replace the HTTP VPN lookup with HTTPS network-risk assessment and admin-overridable risk state that does not create capture strikes.
- [ ] Implement upload validation and quarantine/scanning adapter; do not claim a scan succeeded when no provider is configured.
- [ ] Add orphan-upload tracking when metadata transactions fail.
- [ ] Run authorization, upload, concurrency, full tests, typecheck, build, and audit.
- [ ] Commit locally: `feat: harden uploads rate limits and audit history`.

### Task 5: Student Health, Search, Pagination, Export, and Support

**Files:**
- Create: `lib/student-health.ts`, `lib/support-service.ts`, `app/api/admin/student-health/route.ts`, `app/api/admin/export/route.ts`, `app/api/support/route.ts`
- Create: `components/admin/StudentHealthDashboard.tsx`, `StudentHealthTable.tsx`, `StudentDetailPanel.tsx`, `SupportQueue.tsx`, `AuditHistory.tsx`
- Modify: `components/AdminPanel.tsx`, `app/dashboard/admin/page.tsx`, `app/support/page.tsx`, `components/NotificationCenter.tsx`
- Test: service, route, pagination, authorization, CSV escaping, and component state tests

**Interfaces:**
- Produces paginated health/support/audit queries and Discord-linked internal tickets.

- [ ] Write failing tests for health classifications, last activity, current CORE lesson, watch percentage, pending homework, stuck students, strikes, search/filter/sort/page cursors, CSV escaping, and ticket lifecycle.
- [ ] Implement SQL-backed services and guarded routes.
- [ ] Build the admin overview, student detail, support queue, audit history, filters, counts, pagination, and export.
- [ ] Replace the fallback support dead end with a real rate-limited ticket form and optional safe external HTTPS destination.
- [ ] Add support-reply notifications and empty/error/retry states.
- [ ] Run focused tests, accessibility checks, full tests, typecheck, and build.
- [ ] Commit locally: `feat: add student health and support operations`.

### Task 6: Versioned Homework, Rubrics, Transcripts, and Timestamp Notes

**Files:**
- Create: `lib/homework-service.ts`, `lib/transcript-service.ts`, `lib/lesson-notes-service.ts` and tests
- Create: `app/api/lessons/[lessonId]/transcript/route.ts`, `app/api/lessons/[lessonId]/notes/route.ts`
- Modify: homework submission/review routes and lesson page
- Create: `components/TranscriptPanel.tsx`, `TimestampNotes.tsx`, `HomeworkHistory.tsx`, `components/admin/HomeworkReview.tsx`

**Interfaces:**
- Produces immutable submission versions, rubric reviews, transcript cue search/seek data, and private member timestamp notes.

- [ ] Write failing tests for immutable resubmissions, review history, rubric validation, member isolation, cue ordering/search, safe Kinescope caption normalization, and timestamp-note access.
- [ ] Implement transactional homework and review services and migrate existing latest submissions as version 1.
- [ ] Implement transcript ingestion/search and player seek integration.
- [ ] Implement private timestamp notes/bookmarks and lesson UI.
- [ ] Add version history/rubric admin UI and student review history.
- [ ] Run focused tests, access-control tests, full tests, typecheck, and build.
- [ ] Commit locally: `feat: add versioned learning and review tools`.

### Task 7: Restrained Visual System and Accessibility

**Files:**
- Modify: `app/globals.css`, landing/dashboard/lesson/admin/support components, internal nav links
- Create: `components/DepthPhi.tsx`, `components/CoreProgressDepth.tsx`, `lib/motion-preference.ts` and tests

**Interfaces:**
- Produces reduced-motion-aware depth accents that do not wrap forms, tables, video, or security screens.

- [ ] Write failing tests for focus visibility, semantic headings/labels/live regions, reduced-motion behavior, internal `Link` navigation, and readable contrast tokens.
- [ ] Replace low-opacity instructional text, excessive long-label tracking, hover-only read semantics, and missing focus rings.
- [ ] Add the depth-reactive entry Phi and dimensional CORE progress visualization with static reduced-motion fallbacks.
- [ ] Add restrained ambient depth only to major empty/success states; keep operational surfaces flat.
- [ ] Verify desktop widths, basic mobile overflow, keyboard navigation, reduced motion, bright/dark watermark readability, and loading/error boundaries.
- [ ] Run accessibility-focused tests, full tests, typecheck, and build.
- [ ] Commit locally: `feat: refine accessible depth and visual hierarchy`.

### Task 8: Cutover, Final Review, and Single Production Push

**Files:**
- Modify: `.env.example`, operational documentation
- Create: `.superpowers/sdd/2026-08-12-platform-hardening/final-release-report.md`

**Interfaces:**
- Produces the signed-off migration/release report and live Postgres-backed production deployment.

- [ ] Run the final Blob manifest/import/verification and ensure there are zero unexplained mismatches or missing referenced files.
- [ ] Set verified environments through `blob` → `dual` → `postgres`, exercise rollback, then select `postgres` for production.
- [ ] Remove stale Cloudflare variables only after repository-wide and Vercel runtime verification shows no references.
- [ ] Run the full suite, database integration/concurrency tests, `tsc --noEmit`, production build, `git diff --check`, and `npm audit --omit=dev` with zero high/critical findings.
- [ ] Run final code/security review and resolve every Critical/Important issue.
- [ ] Run authenticated and anonymous production-equivalent smoke tests plus desktop visual/accessibility review.
- [ ] Confirm clean working tree and reviewed local commit history.
- [ ] Push `main` once to GitHub, wait for Vercel Production `Ready`, verify the public alias, and run post-deploy smoke/health checks.
