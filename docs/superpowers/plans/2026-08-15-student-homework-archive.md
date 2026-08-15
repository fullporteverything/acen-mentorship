# Student Homework Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a private Overview-page archive where students can preview and download every immutable homework PDF version with its status and feedback.

**Architecture:** Query immutable Neon homework submissions/reviews through a member-isolated service, expose only safe proxy URLs through a guarded API, and render a latest-three Overview card plus a full grouped archive. Keep Blob private, quarantine-aware, and compatible with the current legacy submission while the broader migration remains in Blob mode.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Drizzle ORM, Neon Postgres, Vercel Blob, Vitest.

## Global Constraints

- Every submission and review version is append-only and retained indefinitely.
- Ordinary members can access only records owned by their linked Discord identities; admins continue using the existing admin workflow.
- Raw private Blob URLs and provider credentials are never returned to clients.
- Quarantined, orphaned, untracked, or missing uploads are never represented as downloadable.
- Bulk ZIP export is deferred; individual PDF preview/download is included.
- Preserve legacy Blob data and keep `DATA_BACKEND_MODE=blob` until the verified migration gate permits cutover.

---

### Task 1: Member-Isolated Homework Archive Service and API

**Files:**
- Create: `lib/homework-archive.ts`
- Create: `lib/homework-archive.test.ts`
- Create: `app/api/homework/archive/route.ts`
- Create: `app/api/homework/archive/route.test.ts`
- Modify: `lib/db/schema.ts` only if an index required by the query is missing
- Create: `drizzle/0013_homework_archive_indexes.sql` only if schema changes are required

**Interfaces:**
- Consumes: `requireMemberOrResponse()`, `progressViewerIds(discordId)`, Drizzle `homeworkSubmissions`, `homeworkRubricReviews`, `lessons`, and upload availability metadata.
- Produces: `listHomeworkArchive(input: { discordIds: string[]; cursor?: string; limit: number; lessonId?: string; status?: string }): Promise<HomeworkArchivePage>` and guarded `GET /api/homework/archive`.

- [ ] Write failing service tests for newest-first immutable versions, latest review selection, cursor pagination, lesson/status filtering, main/alt identity union, ordinary-member isolation, and unavailable upload state.
- [ ] Run `npm.cmd test -- lib/homework-archive.test.ts` and verify failures occur because the service is absent.
- [ ] Implement typed archive rows containing submission ID, lesson ID/title, version, filename, submitted date, status, feedback, availability, and safe proxy preview/download paths; never include a raw Blob URL.
- [ ] Run the focused service tests and verify they pass against isolated Neon fixtures.
- [ ] Write failing route tests for anonymous 401, revoked membership and Discord outage status preservation, query validation, member isolation, and paginated safe response shape.
- [ ] Implement the route with `requireMemberOrResponse()`, linked identity resolution, bounded limit (default 25, maximum 100), opaque cursor validation, and no admin-only data leakage.
- [ ] Run service and route tests, lint, and typecheck.
- [ ] Commit locally as `feat: add private homework archive service` without pushing.

### Task 2: Safe PDF Preview and Download

**Files:**
- Modify: `app/api/blob/[...path]/route.ts`
- Modify: `app/api/blob/[...path]/route.test.ts` or create it if absent
- Modify: `lib/upload-validation.ts` only to reuse safe PDF filename/disposition helpers

**Interfaces:**
- Consumes: authenticated owner IDs, upload availability/quarantine state, sanitized filenames.
- Produces: `/api/blob/{privatePath}?disposition=inline` for preview and `?disposition=attachment` for download.

- [ ] Write failing proxy tests asserting a student cannot access another student's PDF, main/alt linkage works bidirectionally, quarantined/orphaned/untracked files fail closed, invalid disposition is rejected, inline responses are PDF-only, and attachment filenames are sanitized.
- [ ] Run the focused proxy tests and verify the new disposition contract fails.
- [ ] Implement an allowlisted disposition parser; preserve existing ownership and quarantine checks before fetching provider content; set `Content-Type: application/pdf`, `X-Content-Type-Options: nosniff`, and the correct safe `Content-Disposition`.
- [ ] Run focused proxy/auth/upload tests and verify no private provider URL appears in responses.
- [ ] Commit locally as `feat: secure homework preview and downloads` without pushing.

### Task 3: Overview Card and Full Archive UI

**Files:**
- Create: `components/MyHomeworkCard.tsx`
- Create: `components/MyHomeworkCard.test.tsx`
- Create: `components/HomeworkArchive.tsx`
- Create: `components/HomeworkArchive.test.tsx`
- Create: `app/dashboard/homework/page.tsx`
- Modify: `app/dashboard/page.tsx`
- Modify: dashboard styles in the existing global/component stylesheet

**Interfaces:**
- Consumes: `GET /api/homework/archive`, preview/download proxy URLs.
- Produces: latest-three Overview card and `/dashboard/homework` grouped archive view.

- [ ] Write failing component tests for latest-three ordering, lesson/version/date/status labels, Preview/Download actions, View full archive link, empty state, retryable error state, and unavailable-file copy.
- [ ] Implement `MyHomeworkCard` with the site's current visual language and no blocking animation; render on Overview without changing CORE counters or progress calculation.
- [ ] Write failing full-archive tests for grouping by lesson, newest version first, lesson/status filters, pagination/load-more, feedback, keyboard focus, reduced motion, and mobile-safe overflow despite desktop priority.
- [ ] Implement the archive page with semantic headings, labeled controls, visible focus, status text plus color, lazy PDF preview, individual downloads, and a retry loader that does not reload the whole dashboard.
- [ ] Run component, route, service, authorization, and accessibility-focused tests.
- [ ] Run the full suite, `npm.cmd run lint`, `npx.cmd tsc --noEmit`, `npm.cmd run build`, `npm.cmd audit --omit=dev --audit-level=moderate`, and `git diff --check`.
- [ ] Request code review; resolve every Critical/Important finding and repeat verification.
- [ ] Commit locally as `feat: add student homework archive experience` without pushing.
- [ ] Include these commits in the single final release push only after the broader in-progress hardening batches are also reviewed and green.
