# Batch C: Polish, Recovery, and Support

**Goal:** Finish the approved desktop-first UX improvements without changing curriculum, homework, progress, or security persistence.

## Tasks

1. Add one validated, configuration-driven support destination with a safe in-site fallback page.
2. Surface support/appeal on OAuth failures, permanent lockout, locked lesson states, and the overview footer.
3. Make Discord membership/sign-in requirements explicit on the entry card.
4. Add direct retry controls to idempotent notification, video-library, homework, announcement, and security loads.
5. Keep themed empty states for announcements, submissions, videos, feedback, notifications, and security records.
6. Improve desktop copy contrast, line height, paragraph width, and long-label letter spacing through shared CSS.
7. Run focused and full verification, review, push, and wait for Vercel Ready.

## Safety

- No existing Blob namespace is rewritten or deleted.
- Support URLs allow only local paths or HTTP(S) destinations.
- Retry controls repeat GET operations only.
- Security strikes, account links, homework, journals, and curriculum logic remain unchanged.
