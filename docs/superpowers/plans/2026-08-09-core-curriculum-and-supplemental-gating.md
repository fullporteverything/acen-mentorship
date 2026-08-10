# CORE Curriculum and Supplemental Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep the student CORE path sequential and uninterrupted by external content, while visibly locking every supplemental category until CORE Lecture 04 is complete.

**Architecture:** Centralize curriculum classification and access-state derivation in pure functions in `lib/lessons-config.ts`. Both the curriculum page/sidebar and direct lesson route consume the same state map so list navigation and URL access cannot disagree. CORE is ordered independently; all non-CORE lessons share a single gate at the fourth ordered CORE lesson.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Vitest, Vercel Blob-backed lesson progress.

## Global Constraints

- Preserve every lesson, submission, approval, upload, and progress record; this is a derived access-control change only.
- Treat a normalized `CORE CONTENT` group name as CORE; every other present or future group is supplemental.
- CORE unlocks only from the previous CORE lesson's approved/completed state.
- Supplemental content stays visible but locked until CORE lesson four is complete, then all supplemental content unlocks together.
- If fewer than four CORE lessons exist, supplemental content fails closed for students.
- Admin bypass remains intact.
- Use an ordinary student identity in regression scenarios so the owner's automatic pass-through cannot hide failures.

---

### Task 1: Add curriculum classification and state regression tests

**Files:**
- Create: `lib/lessons-config.test.ts`
- Modify: `lib/lessons-config.ts`

1. Write failing tests for normalized CORE classification, partition ordering, an interleaved supplemental lesson not blocking the next CORE lesson, CORE-only `current` selection, supplemental locking before CORE four, all-supplemental unlock after CORE four, fail-closed behavior with fewer than four CORE lessons, and admin bypass.
2. Run `npx vitest run lib/lessons-config.test.ts` and confirm failures are caused by the missing curriculum APIs.
3. Implement `CORE_GROUP`, `isCoreLesson`, `partitionCurriculum`, and `computeCurriculumStates` as pure functions. Return CORE and supplemental state arrays, a combined state map/list, gate lesson, and gate status.
4. Keep legacy helpers compatible where still used, but route new student curriculum behavior through the centralized helper.
5. Run the focused test file and confirm it passes.

### Task 2: Wire the curriculum page and sidebar to the shared access model

**Files:**
- Modify: `app/dashboard/lessons/page.tsx`
- Modify: `components/LessonsSidebar.tsx`

1. Replace whole-list sequential state derivation with `computeCurriculumStates`.
2. Render CORE first and supplemental groups beneath it without dropping existing or future lessons/sections.
3. Keep supplemental cards and sidebar entries visible while locked; show gate language that names CORE Lecture 04.
4. Calculate student progress from CORE only so external content never reduces the curriculum percentage.
5. Preserve admin add/edit controls and unlock bypass.
6. Run the focused tests and TypeScript check.

### Task 3: Enforce the same gate on direct lesson URLs

**Files:**
- Modify: `app/dashboard/lessons/[lessonId]/page.tsx`
- Modify: `lib/lessons-config.test.ts`

1. Add a test proving state lookup applies the same CORE/supplemental rules regardless of list position.
2. Replace `isLessonUnlocked` usage on the detail route with the centralized curriculum state lookup.
3. For locked CORE lessons, explain that the previous CORE lesson must be passed. For locked supplemental lessons, explain that CORE Lecture 04 must be passed.
4. Ensure video playback, homework controls, and all lesson actions stay inaccessible when the shared state says locked.
5. Run focused tests and TypeScript.

### Task 4: Verify, commit, push, and confirm deployment

**Files:**
- Verify all touched files and generated output only.

1. Run `npm test`.
2. Run `npx tsc --noEmit`.
3. Run `npm run build`.
4. Inspect `git diff --check` and `git status --short`.
5. Commit the blocker fix on explicitly authorized `main`, push to `origin/main`, and monitor the Vercel production deployment until Ready.
6. Smoke-check the deployed curriculum page where authentication permits; otherwise report the deployment result and the exact authenticated scenario to verify.
