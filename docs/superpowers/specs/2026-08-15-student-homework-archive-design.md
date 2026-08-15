# Student Homework Archive Design

## Goal

Give every student a private, durable archive of every homework PDF they submit so they can preview and download past work at any time. Resubmissions must never overwrite earlier versions.

## Experience

The dashboard Overview page includes a **My Homework** card showing the three most recent submissions. Each entry displays the CORE lesson title, submission version, submission date, review status, and actions to preview or download the PDF.

A **View full archive** action opens the complete history. The archive is grouped by lesson, newest submission first, and supports simple lesson/status filtering. Each immutable version includes its review status and admin feedback. Individual PDF downloads ship with the initial feature; bulk ZIP export is explicitly deferred.

## Data and Retention

The archive reads from the versioned `homework_submissions` and `homework_rubric_reviews` records in Neon. Each submission points to its private Vercel Blob storage key. Submission and review versions remain append-only and are retained indefinitely. No archive action deletes or replaces a file or version.

Legacy Blob-backed homework is surfaced through the existing migration/repository boundary when migration evidence is complete. Until then, the current submission remains available through the legacy path and no legacy record is deleted.

## Authorization and File Access

Archive queries use the centralized member boundary and filter by the authenticated member's linked Discord identities. Ordinary students can read only their own submission metadata and files. Admins retain access through the existing admin review workflow.

Preview and download links use the authenticated Blob proxy. The proxy verifies ownership, upload metadata, and quarantine status before returning a file. Direct or guessed storage paths do not grant access. Download responses use a sanitized attachment filename; preview responses use safe inline PDF disposition.

## Failure States

- A quarantined, orphaned, or unavailable PDF displays a clear unavailable state instead of a broken link.
- Temporary Discord membership or database failures return a retryable unavailable state and do not sign the student out.
- An empty archive explains that submitted homework will appear there.
- Metadata may never claim a file is downloadable until ownership and upload tracking are present.

## Components and Interfaces

- `homework archive service`: paginated member-isolated version/review query.
- member archive API: returns safe metadata and authenticated preview/download URLs; it never returns provider credentials or raw private URLs.
- Overview `MyHomeworkCard`: latest three submissions plus archive entry point.
- full archive view: grouped history, status/lesson filter, preview, download, feedback.
- authenticated Blob proxy: supports explicit safe preview and download disposition while preserving ownership/quarantine checks.

## Verification

Tests must cover:

- immutable version ordering across resubmissions;
- main/alternate Discord identity linkage and ordinary-student isolation;
- admin versus member authorization;
- preview/download ownership and quarantine enforcement;
- sanitized filenames and correct PDF disposition;
- latest-three Overview behavior, full history grouping, filtering, empty state, and unavailable state;
- temporary Discord/database error behavior;
- legacy current-submission compatibility without data deletion.

The full test suite, lint, typecheck, production build, and production dependency audit must pass before the final push.
