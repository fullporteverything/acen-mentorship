# Kinescope Video Migration Design

## Goal

Replace Cloudflare Stream with Kinescope throughout the application while preserving the existing student lesson experience and the in-app administrator video workflow. This is a hard cutover: no Cloudflare playback or API fallback will remain after deployment.

The existing Cloudflare video identifiers are not portable. All lesson video assignments must therefore be cleared during the migration. Administrators will re-upload the source videos to Kinescope and assign the resulting Kinescope video IDs after deployment. Until a lesson receives a new video ID, students will see the application's existing unavailable/coming-soon state.

## Scope

The migration includes:

- Server-side Kinescope authentication and configuration.
- Direct, resumable administrator uploads to Kinescope using TUS.
- Kinescope video listing and processing-state normalization.
- Lesson video assignment and validation using Kinescope UUIDs.
- Student playback through the Kinescope embedded player.
- Kinescope DRM/capture protection and an authenticated, per-student Discord identity watermark.
- Removal of Cloudflare-specific routes, components, labels, comments, URLs, and environment variables.
- Caption behavior based only on capabilities verified in the Kinescope API.
- Documentation and environment setup updates.

Lesson progress, access locking, homework, announcements, authentication, and unrelated admin features are outside the migration and must retain their current behavior.

## Chosen Approach

Use a complete Kinescope integration with provider-neutral application boundaries. User-facing and internal names should describe their purpose, such as `VideoPlayer`, `video-status`, and `video-upload-url`, rather than embedding a provider name. The Kinescope-specific request and response details remain confined to server-side integration helpers and API routes.

This avoids retaining misleading Cloudflare names and makes a future provider change less invasive without introducing a general-purpose provider abstraction that the application does not currently need.

## Configuration and Security

The server reads:

- `KINESCOPE_API_TOKEN`: a Kinescope workspace access token with the minimum API and upload permissions needed by this integration.
- `KINESCOPE_PROJECT_ID`: the Kinescope project or parent identifier used for uploads and library filtering.
- `KINESCOPE_PLAYER_ID`: the protected Kinescope player configuration used for lesson playback.

Both values remain server-only. The API token must never be serialized into a client response or sent to the browser. The browser receives only the temporary Kinescope TUS upload endpoint returned by the server-side initialization call.

Cloudflare configuration (`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_STREAM_API_TOKEN`) is removed from runtime code and setup documentation.

## Architecture and Data Flow

### Upload

1. An authenticated administrator selects a file in the existing upload interface.
2. The client sends file metadata (name, size, title, and supported options) to an admin-only application route.
3. The route validates the session and metadata, then initializes an upload with Kinescope using the server-side API token and configured project ID.
4. The route returns only the Kinescope TUS endpoint and normalized upload metadata.
5. The existing `tus-js-client` integration uploads the bytes directly from the browser to Kinescope, preserving progress, retry, and resume behavior.
6. On completion, the client refreshes the video library and displays the returned Kinescope video ID.

The application server never proxies the video bytes.

### Library and Processing

The admin video-library route reads videos from Kinescope and maps provider data into the fields the UI needs: ID, title, creation date, duration, processing status/progress, and readiness.

Kinescope's terminal playable state is `done`. Pending, uploading, pre-processing, and processing states are displayed as not ready. Aborted and error states are displayed as failed with a useful administrator-facing message. Provider errors are sanitized before reaching the browser, and authentication/configuration failures produce explicit server errors without leaking credentials.

The lesson status helper uses the same normalization and a short cache to avoid repeated Kinescope API calls during server rendering. A missing or invalid video ID resolves to unavailable rather than throwing on the student page.

### Assignment

Kinescope video IDs are UUIDs. A shared validator is used by the lesson form, assignment control, override API, and lesson lookup path so client and server behavior cannot drift. Assignment endpoints still enforce administrator authorization.

All seeded and persisted Cloudflare assignments are cleared as part of the migration. The application does not attempt to transform or recognize Cloudflare IDs.

### Playback

The Cloudflare player component is replaced by a provider-neutral video player that renders Kinescope's supported responsive embed URL for a validated video ID. The lesson page keeps its current dimensions, loading/processing treatment, and surrounding controls. Kinescope remains responsible for adaptive streaming and playback UI.

The configured Kinescope project/player must have DRM encryption, recording protection, download prevention, and production-domain embedding restrictions enabled. The iframe must include Kinescope's required `encrypted-media` permission. Protected playback is a release gate: deployment is not accepted until a real protected upload has been verified to hide the video during screen recording/sharing on Kinescope-supported browser and operating-system combinations.

Kinescope documents that protected video may be hidden while audio continues when active recording or screen-viewing software is detected. This is the primary blackout layer. The existing application `ScreenGuard` remains as a secondary, best-effort deterrent that blocks same-page calls to `getDisplayMedia`, logs the authenticated capture attempt, and covers the page with black. It cannot detect capture initiated by a different application, browser extension, modified client, operating system, or external camera; the product must not claim otherwise. Unsupported DRM browsers fail closed with an actionable protected-playback message instead of falling back to an unencrypted stream.

### Per-student Watermark

Every student lesson video displays a persistent moving watermark containing both the authenticated Discord username and Discord user ID. These values come from the server-validated login session already used by the lesson page; watermark text is never accepted from request parameters, local storage, or other client-controlled identity fields.

The watermark is rendered by the application above the player with low but readable opacity, periodically changing among safe positions to make cropping difficult without obscuring lesson content. Multiple faint instances may be used at larger viewport sizes. The watermark layer ignores pointer events and is excluded for administrators only when the existing server-derived admin authorization says the viewer is an administrator.

Because a Kinescope iframe entering native fullscreen would escape an application overlay, the integration must not expose an unwatermarked fullscreen path. The implementation must either use a documented Kinescope per-viewer watermark mechanism that accepts server-authorized identity or disable native iframe fullscreen and provide fullscreen on the application-owned player wrapper so the Discord watermark remains visible. Picture-in-picture, casting, download, and other playback paths that omit the application watermark are disabled for protected lessons.

The shared Kinescope player may additionally carry a fixed ACEN watermark, but that does not replace the required per-student Discord watermark.

### Captions

Cloudflare caption endpoints and assumptions are removed. During implementation, Kinescope's current official API is checked for both caption discovery and automatic caption generation:

- If both operations are documented and available to the configured account, the existing controls are adapted to normalized Kinescope responses.
- If automatic generation is unavailable, the generate action is removed and the player relies on caption tracks configured in Kinescope.
- No Cloudflare caption route, URL, or silent compatibility shim remains.

This capability check affects only caption controls, not the core upload, assignment, or playback migration.

## API and Component Changes

Provider-specific route names are replaced with purpose-based names. The final route set should expose one upload-initialization route, one video-library route, and only the caption route supported by the verified Kinescope API. Obsolete Cloudflare direct-upload and caption routes are deleted rather than retained as aliases.

`CloudflarePlayer` becomes a provider-neutral player component. Admin components retain their current roles but change copy, identifiers, and response types from Cloudflare terminology to Kinescope terminology. Shared Kinescope request logic and response normalization live in focused server-only modules rather than being duplicated across routes.

## Failure Handling

- Missing Kinescope configuration: admin APIs return a clear configuration error; student lessons remain unavailable without exposing secrets.
- Upload initialization failure: the upload UI shows a retryable error and does not start TUS.
- Interrupted upload: `tus-js-client` retains resumable retry behavior.
- Processing delay: the admin library and lesson page show processing until Kinescope reports `done`.
- Processing failure: administrators see a failed status; students see unavailable rather than a broken iframe.
- Invalid or stale video ID: assignment is rejected on the server; an already-stored stale ID renders unavailable.
- Kinescope API outage: cached readiness may be used within its existing short lifetime; otherwise the page fails closed to unavailable.

## Testing and Verification

Automated coverage should focus on stable application behavior:

- Kinescope UUID validation accepts valid IDs and rejects Cloudflare IDs and malformed input.
- Provider response normalization maps every documented processing state correctly.
- Admin routes reject unauthorized requests and missing configuration.
- Kinescope API failures are sanitized and mapped to appropriate response codes.
- Lessons without a Kinescope video ID render the unavailable/coming-soon state.
- A ready lesson produces the expected Kinescope embed URL.
- Watermark identity is derived from the authenticated session and includes both Discord username and ID.
- The watermark remains present in the supported fullscreen path, and unwatermarked picture-in-picture, casting, and download paths are unavailable.
- Unsupported DRM playback fails closed instead of serving an unprotected stream.

Verification includes linting, type checking or a production build, relevant automated tests, and a repository-wide search confirming that no runtime Cloudflare references, environment variables, URLs, or labels remain. Any references retained in the migration spec or version history are documentation only.

Manual acceptance checks:

1. Configure a Kinescope token and project ID.
2. Upload a representative large video through the admin UI and confirm progress/resume behavior.
3. Confirm the library shows processing and later transitions to ready.
4. Assign the video to a lesson.
5. Sign in as a student and verify playback at desktop and mobile sizes.
6. Verify the visible watermark contains that student's Discord username and ID, moves over time, and remains visible in fullscreen.
7. Attempt browser/tab/window and supported operating-system screen sharing or recording and confirm protected video is hidden while the application logs same-page capture attempts.
8. Confirm picture-in-picture, casting, downloads, direct unprotected playback, and embedding from an unapproved domain are unavailable.
9. Verify an unassigned lesson shows the unavailable state without console or server errors.

## Deployment and Cutover

Deploy the code and Kinescope environment variables together. Remove the Cloudflare environment variables once the new deployment is healthy. Because there is no compatibility period, all video lessons remain unavailable until an administrator uploads and assigns their Kinescope replacements.

Rollback means redeploying the previous Cloudflare-backed release with its Cloudflare environment variables and assignments. The new release itself contains no dual-provider rollback path.

## Success Criteria

- Administrators can upload, monitor, list, copy IDs for, and assign Kinescope videos from the application.
- Students can play assigned, fully processed Kinescope videos without changes to the surrounding lesson workflow.
- Kinescope DRM/capture protection is enabled and verified, with no unencrypted fallback.
- Every non-admin playback surface visibly carries the authenticated student's Discord username and user ID, including supported fullscreen playback.
- Unwatermarked picture-in-picture, casting, download, and direct playback paths are disabled.
- Unassigned or non-ready lessons fail closed with the current unavailable/processing experience.
- No Cloudflare runtime integration, fallback, configuration, or user-facing terminology remains.
- Existing non-video features continue to pass their verification checks.
