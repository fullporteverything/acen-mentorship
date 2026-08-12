# Platform Hardening and Product Expansion Design

**Status:** Approved section-by-section in conversation on 2026-08-10

## Objective

Turn the existing desktop-first mentorship site into a secure, transaction-safe learning platform without changing its black/rose/serif identity, breaking CORE progression, weakening private video delivery, or losing any student data. The entire program is verified locally and pushed to GitHub only after all batches are complete.

## Non-Negotiable Constraints

- Existing homework PDFs, journal images, submissions, progress, journals, strikes, notifications, curriculum overrides, account links, and video assignments are preserved.
- Vercel Blob remains the binary file store. Neon Postgres becomes the system of record for mutable metadata.
- Legacy Blob metadata is not deleted during this program and remains a rollback source.
- CORE progression remains independent from supplemental content. Supplemental categories unlock only after CORE Lecture 04.
- Main owner Discord ID `353994234983874570` and preview alt ID `1417619259252801546` retain their existing automatic progress union.
- Student watermarks always show Discord username and ID and continue changing position.
- Browser JavaScript is not represented as capable of detecting Discord, OBS, operating-system, or hardware capture. Capture strikes are issued only from defensible first-party signals.
- UI remains desktop-first, black/rose, serif, restrained, readable, keyboard accessible, and reduced-motion aware.
- No intermediate GitHub push. Local commits are allowed as rollback checkpoints; one final push occurs after complete verification and review.

## Program Architecture

The work uses a phased cutover inside one local development program:

1. Dependency and request-security foundation.
2. Neon schema, migration tooling, and dual-write/shadow-read validation.
3. Transactional repository cutover and admin operations.
4. Student learning tools and support workflow.
5. Restrained visual/accessibility polish.
6. Full migration, security, functional, build, visual, and reviewer gates followed by one GitHub push and Vercel Ready confirmation.

## Dependency and Authentication Security

- Upgrade Next.js, NextAuth/Auth.js, React where required, and transitive production dependencies until `npm audit --omit=dev` reports zero known high or critical findings.
- Preserve Discord OAuth, required-guild-role access, owner/admin identity, and current profile cosmetics.
- Remove the unused Discord OAuth access token from the persistent session/JWT after sign-in authorization completes.
- Centralize member and admin authorization helpers so every server page, Server Action, Blob proxy, and API route uses the same rules.
- Store the last successful Discord role check and revalidate it at a bounded interval. A role removal invalidates protected access without requiring a manual logout.
- Distinguish missing-role errors from temporary Discord/provider failures so valid members receive a retry path instead of misleading denial copy.
- Add authorization regression tests for anonymous, valid member, missing role, removed role, owner, preview alt, and admin cases.

## Request and Application Security

- Add a Content Security Policy compatible with Next.js, Discord OAuth, Kinescope embeds/API use, Vercel Blob, required fonts, and existing local scripts/styles.
- Add `frame-ancestors`, `X-Content-Type-Options`, Referrer Policy, Permissions Policy, and other relevant production headers while retaining Vercel HSTS.
- Add Postgres-backed rate limits for OAuth-sensitive checks, uploads, journal mutations, notifications, watch progress, support tickets, and capture/security endpoints.
- Add immutable audit events for curriculum edits, progress overrides, homework reviews, unlocks, announcements, video assignments, caption requests, support actions, and security changes.
- Do not log credentials, OAuth tokens, file contents, raw provider responses, or full sensitive request bodies.
- Replace the unencrypted third-party VPN lookup. Proxy/hosting risk checks use HTTPS and uncertain results fail open. Risk is logged separately from strike enforcement, and the admin can override false positives.
- Remove stale Cloudflare runtime variables only after confirming no production code references them.

## Capture Protection Model

- Keep the moving Discord username/ID watermark over every protected video for every account, including owner/admin accounts.
- Keep wrapper fullscreen so the watermark remains inside the visible protected frame.
- Use Kinescope's strongest account-available DRM/protected playback, signed or expiring delivery, allowed-domain restrictions, and protected player configuration.
- Preserve the current first-party `getDisplayMedia` interception only as a narrow deterrent; it is not described as broad external-capture detection.
- The product does not claim that a web page can reliably identify Discord, OBS, Windows Game Bar, GPU, HDMI, camera, or hardware capture.
- Strike state remains persistent across devices and sessions. Concurrent strike writes are transactional and cannot lose increments.

## Neon Postgres Data Model

Neon becomes the authoritative mutable store. The schema uses Discord IDs as stable external identities and internal primary keys where relationships benefit from them.

### Tables

- `members`: Discord ID, username cache, role-check state, last activity, created/updated timestamps, and admin/risk flags.
- `lessons`: base/runtime lesson identity, section, ordering, content overrides, video assignment, and active state.
- `lesson_progress`: one member/lesson row for approval/completion state and timestamps.
- `watch_progress`: current seconds, duration, percentage, completion, and update time per member/lesson.
- `homework_submissions`: immutable versioned submissions with Blob pathname, original filename, validation metadata, status, reviewer, feedback, and timestamps.
- `journal_entries`: transactional member journal records.
- `journal_images`: Blob pathname, validated media type, size, dimensions where available, and entry relationship.
- `security_members`: current strike/acknowledgement/lock state.
- `security_events`: immutable capture, risk, acknowledgement, lock, and unlock history.
- `announcements`: authored announcement records.
- `notification_receipts`: one member/notification receipt row with a uniqueness constraint.
- `support_tickets` and `support_messages`: Discord-linked requests, status, priority, assignment, and conversation history.
- `lesson_notes`: private timestamped notes/bookmarks per member and lesson.
- `video_transcripts` and `video_transcript_cues`: searchable transcript metadata and timestamp cues.
- `admin_audit_events`: immutable actor/action/subject metadata and safe before/after summaries.
- `rate_limit_buckets`: bounded server-side counters with expiration.
- `migration_runs` and `migration_items`: resumable import state, checksums, counts, mismatches, and errors.

### Transaction Rules

- Progress approval, homework review, strike increments, notification receipts, support updates, and journal mutations use database transactions and uniqueness/locking constraints.
- A homework resubmission creates a new immutable version; it never overwrites or hides the prior version.
- Binary uploads complete before metadata insertion. If metadata insertion fails, an orphan-cleanup record is created and the UI reports failure rather than success.
- Deletes of journal entries or uploads are soft deletes during this program. Blob removal is outside the initial cutover.

## Migration and Cutover

The application supports `DATA_BACKEND=blob`, `dual`, and `postgres`.

### Migration Sequence

1. Create a timestamped manifest of every legacy metadata Blob and referenced file pathname.
2. Import members, lesson configuration, progress, submissions, journals, strikes, announcements, receipts, profiles, and watch progress with idempotent keys.
3. Record per-item source checksum, destination identity, status, and error in `migration_items`.
4. Compare source and destination counts plus normalized checksums for every record family and every member.
5. Enter `dual` mode: Postgres receives authoritative writes while Blob preservation writes continue where safe; reads come from Postgres and compare a sampled or bounded Blob shadow read.
6. Block cutover if there are unexplained count/checksum mismatches, missing file references, or authorization regressions.
7. Enter `postgres` mode only after a migration report passes and rollback to Blob has been exercised in a non-production verification environment.

Migration scripts are restart-safe. They never delete legacy metadata or files and produce a human-readable final report.

## Upload Hardening

- Homework remains PDF-only with the existing 20 MB maximum unless a lower provider limit requires adjustment.
- Validate magic bytes and parseability rather than trusting browser MIME type or extension.
- Journal images validate magic bytes, supported formats, size, and dimensions; unsupported or malformed images are rejected.
- Homework responses use a safe content disposition and protected authenticated proxy. Journal images remain inline only for validated image formats.
- Add a malware-scanning adapter. If no scanning provider credential exists at release, uploaded homework enters `quarantined`/`pending_scan` and is unavailable to admin review until scanning succeeds; the release cannot silently claim scanning occurred.
- Rate limit uploads and cap per-entry image count and storage-related request size.

## Admin Product Design

### Student Health Dashboard

The default admin view shows:

- total active members;
- members active in the selected time window;
- members stalled on the same CORE lesson;
- current CORE lesson and completion percentage;
- watch percentage and last watch activity;
- pending/resubmitted homework;
- unread support tickets;
- strikes, locks, and risk flags;
- caption/video processing failures.

Admin lists support search, filters, sorting, pagination, concise status badges, and CSV export. Large datasets are paginated in SQL rather than fully scanned through Blob.

### Operations

- Student detail combines progress, watch history, homework versions, journal review status, notes count, support history, and security history.
- Homework review supports a rubric, feedback, version comparison, approval/rejection, and immutable review history.
- Support tickets have open/pending/resolved states, admin replies, priority, and a link back to the member detail.
- Audit history makes every sensitive admin action attributable and reviewable.
- Curriculum and video assignment retain existing behavior with improved validation, optimistic UI only where rollback is explicit, and server-authoritative reconciliation.

## Student Learning Design

- Lesson pages show duration, watch/resume state, prerequisite status, and previous/next navigation constrained to the correct CORE or supplemental path.
- English captions remain generated/retryable through Kinescope.
- Transcript cues are searchable and clicking a cue seeks the player to its timestamp.
- Students can create private timestamped notes/bookmarks tied to the current lesson position.
- Homework history shows every submitted version and its status/review feedback without exposing other members' data.
- Notification center includes announcements, homework reviews, journal feedback, support replies, and strikes, with persistent cross-device receipts.
- Failure states distinguish temporary provider failure, access denial, processing, missing content, and configuration errors without exposing secrets.

## Support Design

- `/support` becomes a real Discord-linked support form rather than instructions with no destination.
- Signed-in members submit tickets under their member record automatically.
- Locked or failed-login users can submit an access request using Discord ID and username plus a description. Rate limits and abuse controls apply.
- If `NEXT_PUBLIC_SUPPORT_URL` points to an approved HTTPS destination, the page may also show the external Discord/ticket link; the internal ticket system remains available.
- Admin can reply, resolve, reopen, and filter tickets. Students receive a notification when a ticket changes.

## Visual and Accessibility Direction

- Preserve the existing black background, rose accents, serif typography, generous whitespace, thin borders, Phi identity, and desktop-first layout.
- Use restrained 3D only to reinforce hierarchy: a depth-reactive Phi on entry, a dimensional CORE progress visualization, and subtle ambient depth on major empty/success states.
- Forms, tables, lesson text, admin operations, security warnings, support, and homework remain flat, fast, and visually stable.
- No spinning cards, excessive parallax, constant camera motion, or decorative WebGL behind task-heavy surfaces.
- Raise low-contrast instructional text to accessible contrast, reduce excessive tracking on long labels, preserve readable line lengths, and add visible keyboard focus states.
- Respect `prefers-reduced-motion`; nonessential Three.js/framer-motion effects stop or reduce automatically.
- Maintain semantic headings, labels, live regions for asynchronous state, and keyboard-operable controls.
- Use Next.js `Link` for internal navigation and preserve loading/error boundaries.

## Error Handling and Observability

- Database, Discord, Blob, Kinescope, scan, and migration failures map to safe typed errors and actionable UI states.
- Mutations never display success until the authoritative transaction commits.
- Operational events include correlation IDs and safe context, and can be reviewed through an admin health surface or Vercel logs.
- Health checks cover database connectivity, Blob access, Kinescope configuration, role-validation configuration, migration state, and caption queue readiness without exposing secrets.
- Alerts are generated for repeated auth-provider failures, migration mismatches, provider outages, caption failures, and sustained rate limiting.

## Testing and Release Gates

### Automated

- Unit tests for validation, authorization, risk policy, curriculum rules, transcript search, and state models.
- Route/Server Action tests for anonymous/member/admin boundaries and malformed input.
- Database integration tests for transactions, concurrency, unique receipts, versioned submissions, strike increments, rate limits, and rollback behavior.
- Migration fixture tests for legacy/partial/corrupt blobs, idempotent reruns, checksum comparison, and missing file references.
- Accessibility tests for landmark/heading/label/focus/reduced-motion behavior.
- Full Vitest suite, `tsc --noEmit`, production build, `git diff --check`, and production dependency audit with zero high/critical findings.

### Manual and Visual

- Login success, missing role, provider outage, role removal, logout, and session expiry.
- Owner main/alt progress union and admin bypass.
- CORE and supplemental progression, video resume, captions, transcript seeking, notes, and homework versions.
- Admin student health, review, support, unlock, audit, and export flows.
- Watermark readability on bright/dark video, wrapper fullscreen, and reduced-motion behavior.
- Desktop visual review at common widths and a basic mobile overflow sanity check.

### Final Release

1. Migration dry run and report pass.
2. Full automated gates pass.
3. Security and code review report no Critical or Important findings.
4. Final visual/interaction review passes.
5. Working tree contains only reviewed program changes.
6. Push all local commits once to GitHub `main`.
7. Wait for Vercel Production `Ready`, verify the public alias, and run production smoke checks.

## Explicit Exclusions

- No claim of reliable external screen-recording detection from browser JavaScript.
- No deletion of legacy Blob metadata or files during the program.
- No mobile-first redesign.
- No social feed, chat room, billing, marketplace, or gamification system.
- No decorative 3D treatment that interferes with reading, forms, video, or admin work.
