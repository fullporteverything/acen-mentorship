# Persistent Security Strikes and Kinescope Captions Design

## Goal

Add persistent, Discord-identity-based screen-sharing strikes with individual admin appeals, while restoring automatic English captions through Kinescope. Preserve all homework, progress, journal, feedback, and unrelated member data.

## Security Model

Each authenticated non-admin member has a persistent security record keyed by the Discord user ID from the server-validated NextAuth session. Records are stored in Vercel Blob and apply across all browsers, devices, old sessions, and new sessions until an administrator resets that member.

The record contains:

- Discord user ID and latest authenticated username.
- Strike count and locked status.
- First and most recent detection timestamps.
- A bounded audit history containing timestamp, IP, and user agent.

Client-supplied Discord identity is never authoritative. Capture APIs derive identity from the authenticated session.

## Strike Experience

When the browser detector observes a display-capture request, it immediately replaces the protected site content locally while sending the authenticated attempt to the server. The server atomically increments the member's persistent strike count and returns the authoritative state. These are real application states rendered on the site, not browser alerts, generic dialogs, or an external page.

- Strike 1 vertically stacks:
  - Title: “I can see you…”
  - Supporting line 1: “Screen sharing or recording was detected.”
  - Supporting line 2: “Don’t make that mistake again.”
- Strike 2 vertically stacks:
  - Title: “Last chance.”
  - Supporting line 1: “Another screen sharing or recording attempt was detected.”
  - Supporting line 2: “Your next attempt will revoke access to the site.”
- Strike 3 and every later attempt vertically stacks:
  - Title: “Access revoked.”
  - Supporting line 1: “This account was locked after repeated screen sharing or recording attempts.”
  - Supporting line 2: “Contact an administrator to appeal this lockout.”

Each title and supporting line is its own block element with deliberate vertical spacing and a readable maximum width. Copy must wrap only within its own line block; CSS must not concatenate the supporting sentences into a paragraph that can appear cut off mid-thought.

The pages reuse the established ACEN dashboard and current `ScreenGuard` visual language: the same dark/black protected surface, muted rose warning color, Georgia-style serif typography, uppercase/letter-spaced security heading treatment, thin gradient divider, border treatment, spacing rhythm, and responsive behavior already present on the site. The warning content is centered in the existing application shell and feels native to the lesson/dashboard experience. It must remain legible without clipping at desktop and mobile widths.

The first and second warning screens place a lower-center checkbox labeled “I acknowledge this warning.” The checkbox and Continue button use the site's existing form and button styling. The Continue button remains disabled until the member checks it. Acknowledgment dismisses only the current warning; it does not remove or reduce the strike. The third-strike screen has no acknowledgment control or client-side bypass.

The dashboard layout checks persistent lock state on the server for every protected request. A locked member cannot regain access by signing out, changing devices, clearing browser storage, or reusing an older session.

## Detection and DRM Boundaries

The application detector continues to intercept same-page `getDisplayMedia` calls and can react immediately to capture initiated through the protected page. It cannot reliably observe capture initiated by another application, browser extension, modified browser, operating-system tool, or external camera.

Kinescope DRM remains the primary protected-video blackout layer for supported browsers and operating systems. DRM may hide the video from external recording without informing the application, so such an event cannot always produce an application strike. The UI and documentation must state this limitation accurately.

The configured Kinescope player continues to disallow unwatermarked native fullscreen, picture-in-picture, casting, sharing, downloads, and unencrypted fallback.

## Persistent Storage

Create a focused security-strike store backed by Vercel Blob. Updates use the safest available compare/update pattern and are idempotent for a unique attempt identifier so client retries do not create duplicate strikes. Audit history is bounded to prevent unlimited record growth.

Storage uses a new security prefix and does not modify or delete existing `dojo/homework`, `dojo/journal`, profile, progress, announcement, or feedback objects.

If the strike store is temporarily unavailable, the local warning remains visible and the client retries the authenticated write. Server-side lock checks fail safely without exposing stored evidence or credentials.

## Admin Security Members

Replace the process-memory capture list and global unlock control with a persistent Security Members section in the existing admin panel.

The list shows members who have at least one recorded strike, including:

- Discord username and user ID.
- Strike count.
- Warning or locked status.
- Most recent detection time.
- Recent audit evidence appropriate for the administrator.

Each row has an individual “Reset & Unlock” action. The admin-only API accepts a Discord user ID, verifies the administrator session, clears that member's strike count and locked state, and records the administrative reset. It does not create a permanent screen-sharing exception. The member will receive strike 1 again after a future detection.

The unreliable process-local `security-store` lock state and “Unlock All” behavior are removed. No bulk reset is required.

## Automatic English Captions

After a successful Kinescope video upload, the admin workflow requests automatic English subtitles through `POST /v1/videos/:video_id/subtitles/auto` with `languages: ["en"]`.

The API token remains server-only. The admin UI reports caption generation as pending, ready, or failed by reading Kinescope subtitle status. Upload success is not reversed if caption generation fails; the UI provides a retry action for that video. Existing English tracks are detected before requesting another track so retries do not create duplicates.

Completed subtitles are rendered by the protected Kinescope player. No Cloudflare caption route or compatibility code is restored.

## Failure Handling

- Unauthenticated capture report: reject without writing a strike.
- Admin capture: do not create a member strike.
- Duplicate attempt ID: return the existing result without incrementing again.
- Strike-write failure: retain the blocking screen and retry; do not silently dismiss it.
- Locked member request: return/render the server-enforced appeal screen.
- Individual reset failure: retain the current lock state and show an admin error.
- Caption API failure: keep the uploaded video, show caption failure, and allow retry.

## Verification

- A single attempt produces strike 1 and requires the acknowledgment checkbox before continuing.
- A second attempt produces strike 2 and requires acknowledgment.
- A third attempt locks every current and future session for that Discord ID.
- All three states use the existing ACEN site theme and show title, supporting line 1, and supporting line 2 as separate vertically stacked blocks without clipping at desktop or mobile widths.
- A different device and cleared browser state do not bypass the lock.
- Resetting one member restores only that member and returns their strike count to zero.
- A future attempt after reset becomes strike 1.
- Non-admins cannot list or reset security records.
- Retries with the same attempt ID do not increment twice.
- Existing homework, progress, journal, and feedback data remain readable.
- New uploads request one English Kinescope subtitle track and expose retryable status.

## Success Criteria

- Strike enforcement is persistent, cross-device, tied to authenticated Discord identity, and individually appealable.
- Warning acknowledgment uses a lower-center “I acknowledge this warning” checkbox and cannot clear strikes.
- Third-strike lockout has no client-side bypass.
- Admins can see who is warned or locked and reset one member without affecting others.
- Kinescope DRM and the application detector work as complementary layers with accurate limitations.
- Automatic English captions are restored without reintroducing Cloudflare code.
- Existing student submissions and progress remain intact.
