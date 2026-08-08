# Kinescope Video Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Cloudflare Stream with a hard-cutover Kinescope workflow that preserves in-app video administration, protects playback, and watermarks every student view with the authenticated Discord username and ID.

**Architecture:** Confine Kinescope HTTP and response normalization to server-only modules, expose provider-neutral admin routes and UI components, and render protected Kinescope embeds inside an application-owned watermarked wrapper. Use the existing NextAuth Discord session for identity and the existing `ScreenGuard` as a secondary capture deterrent.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript 5.6, NextAuth 5, `tus-js-client` 4, Vitest, Kinescope REST/upload APIs.

## Global Constraints

- This is a hard cutover; no Cloudflare runtime fallback or compatibility alias may remain.
- Existing Cloudflare lesson IDs must be cleared; lessons remain unavailable until their Kinescope replacements are assigned.
- `KINESCOPE_API_TOKEN`, `KINESCOPE_PROJECT_ID`, and `KINESCOPE_PLAYER_ID` are server-only.
- Kinescope DRM, recording protection, download prevention, and production-domain restrictions are release gates.
- Student watermark text must come from the server-validated session and contain both Discord username and Discord ID.
- Native fullscreen, picture-in-picture, casting, download, or direct playback must not create an unwatermarked path.
- Unsupported DRM playback fails closed; no unencrypted stream is served.
- Preserve lesson locks, homework, progress, announcements, authentication, and unrelated admin behavior.

---

### Task 1: Test Harness and Kinescope Domain Module

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `lib/video-id.ts`
- Create: `lib/kinescope.ts`
- Create: `lib/video-id.test.ts`
- Create: `lib/kinescope.test.ts`

**Interfaces:**
- Produces: `isKinescopeVideoId(value: unknown): value is string`
- Produces: `getKinescopeConfig(): { apiToken: string; projectId: string; playerId: string }`
- Produces: `normalizeKinescopeVideo(raw: unknown): LibraryVideo`
- Produces: `kinescopeFetch(path: string, init?: RequestInit): Promise<Response>`
- Produces: `LibraryVideo` with `id`, `title`, `createdAt`, `duration`, `status`, `progress`, `ready`, and optional `error`.

- [ ] **Step 1: Add the test command and Vitest**

Add `"test": "vitest run"` to `scripts` and install `vitest` as a dev dependency with `npm install --save-dev vitest`.

- [ ] **Step 2: Write failing ID and normalization tests**

Cover a lowercase UUID, uppercase UUID, a Cloudflare-style 32-character ID, placeholders, all Kinescope states (`pending`, `uploading`, `pre-processing`, `processing`, `done`, `aborted`, `error`), malformed responses, and numeric coercion for duration/progress.

```ts
expect(isKinescopeVideoId("57c95d80-7a5b-43f5-b3c9-7fbabb5c54f0")).toBe(true);
expect(isKinescopeVideoId("0123456789abcdef0123456789abcdef")).toBe(false);
expect(normalizeKinescopeVideo({ id: VALID_ID, title: "Lesson", status: "done" }).ready).toBe(true);
expect(normalizeKinescopeVideo({ id: VALID_ID, title: "Lesson", status: "processing" }).ready).toBe(false);
```

- [ ] **Step 3: Run tests and confirm the expected failure**

Run: `npm test -- lib/video-id.test.ts lib/kinescope.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement the minimal domain module**

Use the canonical UUID expression in `video-id.ts`. In `kinescope.ts`, mark the file server-only, validate all three environment values, attach `Authorization: Bearer ${apiToken}` and JSON headers, and map only `status === "done"` to `ready: true`. Throw a typed/sanitized integration error without including response headers, tokens, or raw HTML.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- lib/video-id.test.ts lib/kinescope.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json lib/video-id.ts lib/video-id.test.ts lib/kinescope.ts lib/kinescope.test.ts
git commit -m "feat(video): add Kinescope domain integration"
```

### Task 2: Kinescope Admin and Readiness APIs

**Files:**
- Create: `app/api/admin/video-upload-url/route.ts`
- Modify: `app/api/admin/videos/route.ts`
- Delete: `app/api/admin/stream-tus-url/route.ts`
- Delete: `app/api/admin/stream-upload-url/route.ts`
- Replace: `lib/stream-status.ts` with `lib/video-status.ts`
- Create: `app/api/admin/video-upload-url/route.test.ts`
- Create: `app/api/admin/videos/route.test.ts`
- Create: `lib/video-status.test.ts`

**Interfaces:**
- Consumes: `getKinescopeConfig`, `kinescopeFetch`, `normalizeKinescopeVideo`, `isKinescopeVideoId`.
- Produces: `POST /api/admin/video-upload-url` accepting `{ fileName: string; fileSize: number; title?: string }` and returning `{ uploadUrl: string }`.
- Produces: `GET /api/admin/videos` returning `{ videos: LibraryVideo[] }`.
- Produces: `isVideoReady(videoId: string): Promise<boolean>`.

- [ ] **Step 1: Write failing route and status tests**

Mock `auth()` and `fetch()`. Assert 403 for non-admins, 400 for empty/oversized metadata, 500 for missing server config, token-free success payloads, normalized library results, `done` readiness, failed-state readiness, and API-outage fail-closed behavior.

```ts
expect(await isVideoReady(VALID_ID)).toBe(true);
expect(await isVideoReady("not-a-uuid")).toBe(false);
expect(JSON.stringify(await response.json())).not.toContain("Bearer");
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- app/api/admin/video-upload-url/route.test.ts app/api/admin/videos/route.test.ts lib/video-status.test.ts`

Expected: FAIL because the new route/status module does not exist.

- [ ] **Step 3: Implement upload initialization**

Authorize with the existing `ADMIN_DISCORD_ID` comparison. Call Kinescope `POST https://uploader.kinescope.io/v2/init` server-side with the project parent, file metadata, and Bearer token. Accept only the documented endpoint from the response and return it as `uploadUrl`; never return the token.

- [ ] **Step 4: Implement library and readiness**

Fetch `/v1/videos` with the configured project filter, normalize each item, attach existing lesson titles by exact video ID, and sort newest first. Replace Cloudflare readiness checks with `/v1/videos/:video_id`, retain short ready/not-ready caching, and return false on malformed IDs or provider failure.

- [ ] **Step 5: Remove obsolete routes and run focused tests**

Run: `npm test -- app/api/admin/video-upload-url/route.test.ts app/api/admin/videos/route.test.ts lib/video-status.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add app/api/admin/video-upload-url app/api/admin/videos app/api/admin/stream-tus-url app/api/admin/stream-upload-url lib/video-status.ts lib/video-status.test.ts lib/stream-status.ts
git commit -m "feat(video): connect admin APIs to Kinescope"
```

### Task 3: Admin Upload, Library, Assignment, and Caption Cleanup

**Files:**
- Modify: `components/VideoUpload.tsx`
- Modify: `components/VideoLibrary.tsx`
- Modify: `components/VideoAssign.tsx`
- Modify: `components/AddLessonForm.tsx`
- Modify: `app/api/admin/add-lesson/route.ts`
- Modify: `app/api/admin/lesson-overrides/route.ts`
- Delete: `components/CaptionControls.tsx`
- Delete: `app/api/admin/captions/route.ts`

**Interfaces:**
- Consumes: provider-neutral admin API contracts from Task 2 and `isKinescopeVideoId` on server routes.
- Produces: unchanged admin user flow with Kinescope terminology and UUID assignment.

- [ ] **Step 1: Add failing validator/API tests for assignment**

Extend route tests to prove malformed and Cloudflare IDs return 400, valid Kinescope UUIDs are accepted, and blank IDs retain the documented unavailable behavior.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- app/api/admin/add-lesson app/api/admin/lesson-overrides`

Expected: FAIL because current heuristics accept non-Kinescope IDs.

- [ ] **Step 3: Update the upload UI**

Change initialization to `/api/admin/video-upload-url`, feed the returned URL to `tus.Upload`, retain progress/retry/cancel/copy behavior, remove Cloudflare chunk-size assumptions, and change all labels to Kinescope. Remove automatic Cloudflare caption generation and explain that subtitle tracks are managed in Kinescope and rendered by its player.

- [ ] **Step 4: Update library and assignment UI**

Consume `LibraryVideo.status`, `progress`, `ready`, and `error`; label IDs as Kinescope video IDs; use UUID validation consistently in both client controls and server routes.

- [ ] **Step 5: Delete Cloudflare caption code and run tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add components app/api/admin
git commit -m "feat(video): migrate admin workflow to Kinescope"
```

### Task 4: Protected Player and Discord Identity Watermark

**Files:**
- Create: `components/VideoPlayer.tsx`
- Create: `components/StudentWatermark.tsx`
- Create: `components/StudentWatermark.test.tsx`
- Modify: `components/ScreenGuard.tsx`
- Delete: `components/CloudflarePlayer.tsx`

**Interfaces:**
- Produces: `VideoPlayer({ videoId, title, discordId, discordUsername, isAdmin }: VideoPlayerProps)`.
- Produces: `watermarkText({ discordId, discordUsername }): string` returning `${discordUsername} • ${discordId}` with safe fallbacks.

- [ ] **Step 1: Write failing watermark and player tests**

Test that the displayed identity includes both session fields, client-provided HTML is escaped by React, the overlay uses `pointerEvents: "none"`, non-admin embeds omit native fullscreen/PiP/casting/download permissions, and the iframe includes `encrypted-media`.

```tsx
render(<StudentWatermark discordUsername="student" discordId="123" />);
expect(screen.getAllByText("student • 123").length).toBeGreaterThan(0);
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- components/StudentWatermark.test.tsx`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the player wrapper**

Use `https://kinescope.io/embed/${videoId}` only for validated IDs. Add `allow="autoplay; encrypted-media"`; do not add iframe `allowFullScreen`. Provide application-wrapper fullscreen through `requestFullscreen()` so the overlay remains inside the fullscreen element. Disable/remove PiP, AirPlay, Chromecast, share, and download through the protected Kinescope player configuration identified by `KINESCOPE_PLAYER_ID`; if configuration cannot be verified, show a protected-playback error rather than an unprotected iframe.

- [ ] **Step 4: Implement the moving identity watermark**

Render at least two faint instances on desktop and one on small screens. Move among deterministic safe positions on a timer, include username and ID in every instance, set `aria-hidden`, `userSelect: "none"`, and `pointerEvents: "none"`. Do not render it for server-authorized admins.

- [ ] **Step 5: Retain and correct ScreenGuard**

Keep same-page `getDisplayMedia` logging and blackout as a secondary layer, remove Cloudflare claims, restore the original function on cleanup, and preserve the admin bypass only when the page supplied server-derived admin authorization.

- [ ] **Step 6: Run focused tests and commit**

Run: `npm test -- components/StudentWatermark.test.tsx`

Expected: PASS.

```powershell
git add components/VideoPlayer.tsx components/StudentWatermark.tsx components/StudentWatermark.test.tsx components/ScreenGuard.tsx components/CloudflarePlayer.tsx
git commit -m "feat(video): add protected watermarked playback"
```

### Task 5: Lesson Integration and Hard Cutover

**Files:**
- Modify: `app/dashboard/lessons/[lessonId]/page.tsx`
- Modify: `lib/lessons-config.ts`
- Modify: any persisted lesson override seed/config that contains a Cloudflare ID, discovered with `rg`.
- Create: `lib/lessons-config.test.ts`

**Interfaces:**
- Consumes: `VideoPlayer`, `isVideoReady`, and `isKinescopeVideoId`.
- Produces: server-derived `discordId`, `discordUsername`, and `isAdmin` props for protected playback.

- [ ] **Step 1: Write failing hard-cutover tests**

Assert every seeded lesson video ID is blank or a valid Kinescope UUID, Cloudflare-style IDs are absent, blank lessons remain unavailable, and override application does not reintroduce placeholders.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- lib/lessons-config.test.ts`

Expected: FAIL if any Cloudflare assignment or old placeholder remains.

- [ ] **Step 3: Wire the lesson page to protected playback**

Import `VideoPlayer` and `lib/video-status.ts`; remove duplicate ID heuristics; obtain username from `session.user.name` with a non-secret fallback and ID from `session.user.discordId`; pass both only from the server component. Keep existing processing and unavailable panels.

- [ ] **Step 4: Clear old assignments and terminology**

Set seeded video IDs to empty strings, remove Cloudflare comments, and ensure an empty assignment is a valid coming-soon state rather than an exception.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- lib/lessons-config.test.ts`

Expected: PASS.

```powershell
git add app/dashboard/lessons lib/lessons-config.ts lib/lessons-config.test.ts
git commit -m "feat(video): cut lessons over to Kinescope"
```

### Task 6: Configuration, Security Verification, and Cleanup

**Files:**
- Modify: `SETUP.md`
- Modify: `.env.example` if present.
- Modify: `next.config.mjs` if Kinescope frame/image origins require CSP or image configuration.
- Modify: `package.json` only if verification exposes a script issue.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: deployable configuration instructions and evidence that no Cloudflare runtime integration remains.

- [ ] **Step 1: Update setup documentation**

Document how to create the Kinescope API token, project, and protected player; set the three environment variables in Vercel; enable DRM/capture protection, production-domain restrictions, disabled downloads/share/casting/PiP, and HTTPS; and re-upload/reassign every lesson after deployment.

- [ ] **Step 2: Run automated verification**

Run: `npm test`

Expected: all tests pass.

Run: `npx tsc --noEmit`

Expected: exit 0.

Run: `npm run build`

Expected: production build succeeds.

- [ ] **Step 3: Search for forbidden remnants**

Run: `rg -n -i "cloudflare|videodelivery|iframe\.cloudflarestream|CLOUDFLARE_" app components lib SETUP.md package.json next.config.mjs`

Expected: no matches.

- [ ] **Step 4: Perform protected-playback acceptance checks**

With a real Kinescope test video and non-admin Discord account, verify upload/resume, transition to `done`, assignment, desktop/mobile playback, visible moving username-and-ID watermark, wrapper fullscreen watermark, recording/share blackout on supported Chrome/Edge and operating-system combinations, blocked unsupported DRM browser behavior, disallowed PiP/casting/download/share, and rejected embedding from an unapproved domain.

- [ ] **Step 5: Review the complete diff and commit**

Run: `git diff --check`

Expected: no whitespace errors.

```powershell
git add SETUP.md .env.example next.config.mjs package.json package-lock.json
git commit -m "docs(video): document protected Kinescope deployment"
```

- [ ] **Step 6: Stop before external deployment**

Report verification results and request explicit approval before pushing or changing Vercel environment/deployment state. Do not deploy without `KINESCOPE_API_TOKEN`, `KINESCOPE_PROJECT_ID`, and `KINESCOPE_PLAYER_ID` being configured in Vercel.
