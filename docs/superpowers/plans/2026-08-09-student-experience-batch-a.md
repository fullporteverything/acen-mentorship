# Student Experience Batch A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add real Kinescope watch percentage/resume and fast, access-aware lesson navigation without changing homework unlock behavior.

**Architecture:** Persist watch progress in a separate private Blob document per Discord user. Expose authenticated GET/POST endpoints, integrate the official Kinescope IFrame Player API inside the existing protected video wrapper, and derive previous/next destinations from the same centralized curriculum state used for authorization.

**Tech Stack:** Next.js 14, React 18, TypeScript, Vitest, Vercel Blob, Kinescope IFrame Player API.

---

### Task 1: Add isolated watch-progress model and API

- Create `lib/watch-progress.ts` with validation, percentage clamping, resume rules, and private Blob persistence.
- Create authenticated `app/api/lessons/watch-progress/route.ts` GET/POST handlers.
- Validate the lesson against the effective curriculum and reject inaccessible lessons server-side.
- Add pure model tests and mocked route authorization tests.

### Task 2: Integrate Kinescope progress and resume

- Add the official IFrame API loader dependency.
- Extend `VideoPlayer` with lesson ID and initial watch progress.
- Subscribe to loaded/time/pause/end/error events, resume safely with `seekTo`, throttle saves, and clean up subscriptions.
- Show watch percentage/resume status without covering player controls or the moving watermark.
- Keep capture protection, sandboxing, protected embed URL checks, and wrapper fullscreen behavior.

### Task 3: Add access-aware previous/next navigation and faster links

- Add a pure navigation helper with tests for CORE-only and within-supplemental-category traversal.
- Render Previous/Next controls on the detail page only for accessible destinations.
- Convert internal curriculum anchors to Next.js `Link`.
- Surface watch percentage on cards/sidebar without treating it as homework completion.

### Task 4: Verify and deploy

- Run focused tests, full tests, `npx tsc --noEmit`, `npm run build`, and `git diff --check`.
- Request code review and resolve Critical/Important findings.
- Commit/push `main` and wait for Vercel production Ready.
