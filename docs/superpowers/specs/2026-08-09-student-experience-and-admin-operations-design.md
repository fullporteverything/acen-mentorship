# Student Experience and Admin Operations Design

**Status:** Approved in conversation on 2026-08-09 (items 1–10 accepted by the owner)

## Objective

Improve the existing desktop-first mentorship experience without changing its black/pink visual identity, weakening curriculum/security rules, or risking homework and progress data. Work ships in small verified production batches.

## Batch A — Playback Progress and Lesson Navigation

### Watch progress and resume

- Use Kinescope's official IFrame Player API and its `TimeUpdate`, `Pause`, `Ended`, duration, and `seekTo` capabilities.
- Store watch position separately from homework approval under a new private Blob namespace. This prevents watch autosaves from overwriting submissions or approval changes.
- Track current seconds, duration, percentage, completion, and update time per Discord user and lesson.
- Resume automatically only when the stored position is meaningful (at least five seconds) and the video is not effectively finished (below 95%).
- Save at a throttled interval plus pause/end/page exit. A watch reaching the end displays 100%, but it never completes homework or unlocks another lecture.
- Show the percentage on lesson cards/sidebar and a compact “Resume from …” status near the player.
- Preserve the existing protected embed resolution, capture blackout behavior, moving Discord watermark, and wrapper fullscreen control.

Kinescope's current official documentation explicitly supports LMS progress tracking, `TimeUpdate`, `Ended`, `getDuration`, and `seekTo`: https://docs.kinescope.ru/instrukcii-dlya-razrabotchikov/iframe-player-api/

### Previous/next controls

- Add Previous and Next controls at the bottom of each lesson.
- CORE navigation traverses only CORE lessons. Supplemental navigation stays inside its own category.
- Never link to a locked destination. When the next lesson is locked, explain the requirement instead of creating a misleading link.
- Use Next.js `Link` for lesson cards, sidebar entries, current-lesson CTA, and previous/next controls to enable prefetching and faster transitions.

## Batch B — Notifications and Admin Workflow

### Notification center

- Add one header notification control with unread count.
- Include new announcements, homework status changes, journal feedback, and security strikes after the first strike.
- Persist read state per user; notifications must remain useful across devices and sessions.
- Keep strike notices hidden for users with zero strikes, as already requested.

### Desktop admin reorganization

- Reorganize the current long admin surface into clear desktop sections/tabs: Students, Homework, Videos, Curriculum, Announcements, and Security.
- Preserve every existing action and API; this is information architecture, not a rewrite.
- Keep the current theme and add concise counts/status labels so urgent queues are visible immediately.

### Captions retry and video assignment

- Make failed/pending caption generation visibly retryable and idempotent.
- Display actionable failure text without exposing credentials or raw provider payloads.
- Add “Assign to lesson” directly on each video-library row, backed by the existing lesson override validation and API.
- Refresh the affected row/lesson state in place after a successful action.

## Batch C — Polish, Recovery, and Support

### Readability

- Increase body contrast and line-height where text is currently faint, reduce extreme letter spacing on long labels, and constrain paragraph width.
- Keep the black background, pink accents, serif typography, and existing page structure.

### Empty/error/retry states

- Add themed empty states for no announcements, no submissions, no videos, and no feedback.
- Replace dead-end failures with a short explanation and safe Retry action where the operation is idempotent.
- Do not expose provider tokens, Blob paths, stack traces, or internal IDs beyond the student's own Discord watermark.

### Login and support path

- Make the Discord sign-in requirement explicit on the entry page.
- Add a consistent support/appeal link on login failures, lockout, lesson access errors, and the dashboard footer.
- Support destination is configuration-driven so it can be changed without editing multiple pages.

## Data and Security Rules

- Homework PDFs, submissions, approvals, curriculum completion, journals, strikes, and account links are never migrated or deleted by these changes.
- Watch progress is additive and isolated from the homework record.
- All mutation APIs authenticate the Discord session and validate lesson access server-side.
- The main and alt owner accounts retain their existing automatic curriculum pass-through.
- Screen-capture response and persistent strike enforcement remain global across sessions/devices and are not coupled to the video host.

## Release Strategy

1. Playback progress + navigation.
2. Notifications + admin organization + caption retry + direct assignment.
3. Readability + resilient states + support path.

Each batch receives focused tests, the full suite, TypeScript, production build, code review, GitHub push, and Vercel Ready confirmation before the next batch ships.
