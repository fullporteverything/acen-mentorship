# Student Lesson Reordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give administrators drag-and-button controls that persist the student-facing order of lessons within each curriculum section.

**Architecture:** Store a numeric `order` value beside existing per-lesson overrides, apply it deterministically when building the effective curriculum, and expose one validated admin reorder endpoint. A focused client component owns drag state, calls the endpoint with the complete section order, and reconciles from the server response.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Testing Library, Vercel Blob-backed lesson overrides.

**Spec:** `docs/superpowers/specs/2026-08-15-student-lesson-reordering-design.md`

## Global Constraints

- Reordering is limited to the lesson's current section/group.
- Lesson IDs remain stable; progress, homework, video assignments, captions, and watch history are never rewritten.
- Supplemental content remains gated by the existing fourth-CORE-lesson rule.
- Failed saves restore the last server-confirmed order and expose a retryable inline error.
- Every mutation uses the existing admin authorization, persistent rate-limit, and audit boundary.

---

### Task 1: Deterministic curriculum ordering

**Files:**
- Modify: `lib/lessons-config.ts`
- Modify: `lib/lessons-config.test.ts`

**Interfaces:**
- Produces: `LessonOverride.order?: number`
- Produces: `buildEffectiveLessons(added, overrides): Lesson[]` ordered within each normalized group.

- [ ] **Step 1: Write the failing ordering tests**

Add tests that pass overrides `{ "lesson-1": { order: 1 }, "lesson-2": { order: 0 } }`, assert the two CORE IDs swap, assert supplemental relative order is unchanged, and assert every lesson object retains its original ID, title/video override, and group.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd test -- lib/lessons-config.test.ts`

Expected: FAIL because `order` is absent and `buildEffectiveLessons` preserves source order.

- [ ] **Step 3: Implement stable within-group ordering**

Extend the override type only:

```ts
export interface LessonOverride {
  title?: string;
  description?: string;
  homeworkPrompt?: string;
  videoId?: string;
  order?: number;
}
```

After applying content overrides, sort lessons by normalized group. Within the same group, compare finite nonnegative override orders and use original source indexes as the tie/fallback. Across different groups, preserve the groups' first-appearance order.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm.cmd test -- lib/lessons-config.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/lessons-config.ts lib/lessons-config.test.ts
git commit -m "feat: persist student curriculum ordering"
```

---

### Task 2: Validated admin reorder API

**Files:**
- Create: `app/api/admin/lesson-order/route.ts`
- Create: `app/api/admin/lesson-order/route.test.ts`

**Interfaces:**
- Consumes: `getAddedLessons()`, `getLessonOverrides()`, `saveLessonOverrides()` and `buildEffectiveLessons()`.
- Accepts: `POST { group: string; lessonIds: string[] }`.
- Produces: `{ lessons: Array<{ id: string; title: string; group: string; videoId: string }> }`.

- [ ] **Step 1: Write failing route tests**

Mock only auth and Blob storage boundaries. Cover: non-admin response passthrough; duplicate IDs; missing current section ID; ID from another section; successful order persistence; and server-authoritative response order. Assert invalid bodies never call `saveLessonOverrides`.

- [ ] **Step 2: Run the focused route test and verify RED**

Run: `npm.cmd test -- app/api/admin/lesson-order/route.test.ts`

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement exact-set validation and one logical save**

Use `requireAdminOrResponse()` and:

```ts
const denied = await allowMutation(admin, "admin.lesson.order", req);
if (denied) return denied;
```

Normalize `group` with trim/collapsed whitespace/uppercase for comparisons. Build the current effective section, require `lessonIds` to be a unique exact set of its IDs, then assign `{ ...overrides[id], order: index }` for every ID and call `saveLessonOverrides(overrides)` once. Return the newly rebuilt effective lesson summary.

- [ ] **Step 4: Run route and curriculum tests and verify GREEN**

Run: `npm.cmd test -- app/api/admin/lesson-order/route.test.ts lib/lessons-config.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/lesson-order/route.ts app/api/admin/lesson-order/route.test.ts
git commit -m "feat: add validated lesson reorder endpoint"
```

---

### Task 3: Drag-and-button admin ordering UI

**Files:**
- Create: `lib/lesson-order-client.ts`
- Create: `lib/lesson-order-client.test.ts`
- Create: `components/LessonOrderManager.tsx`
- Create: `components/LessonOrderManager.test.tsx`
- Modify: `components/AdminPanel.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: `loadLessonOrder(): Promise<OrderedLesson[]>`.
- Produces: `saveLessonOrder(group: string, lessonIds: string[]): Promise<OrderedLesson[]>`.
- `OrderedLesson` is `{ id: string; title: string; group: string; videoId: string }`.

- [ ] **Step 1: Write failing client and component tests**

The client tests assert GET/POST paths, exact POST body, server errors, and response normalization. The component tests render two CORE lessons, drag the second onto the first, and assert the POST order is `[secondId, firstId]`; click Move down/Move up and assert the same persistence path; reject the save and assert the original row order and `Couldn't save this order. Try again.` are visible.

- [ ] **Step 2: Run focused UI tests and verify RED**

Run: `npm.cmd test -- lib/lesson-order-client.test.ts components/LessonOrderManager.test.tsx`

Expected: FAIL because the client and component do not exist.

- [ ] **Step 3: Implement the API client**

GET `/api/admin/lesson-order`; POST the complete group order to the same path. Throw the server's JSON `error` message on non-OK responses and return only array-shaped `lessons` data.

- [ ] **Step 4: Implement the ordering component**

Load server lessons on mount, group rows by normalized section name, and render each group as an ordered list. Each row is `draggable`, has a visible `⋮⋮` handle, and exposes accessible `Move <title> up` / `Move <title> down` buttons. Keep `confirmedLessons`; optimistically reorder, disable controls while saving, replace state with the returned server order on success, and restore `confirmedLessons` plus the inline error on failure.

- [ ] **Step 5: Place and style the component**

Render `<LessonOrderManager />` at the top of the Videos admin tab, before upload/library controls. Add restrained pink-border row, drag-handle, saving, and error styles matching the existing black/rose/Georgia admin theme.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `npm.cmd test -- lib/lesson-order-client.test.ts components/LessonOrderManager.test.tsx components/AdminPanel.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/lesson-order-client.ts lib/lesson-order-client.test.ts components/LessonOrderManager.tsx components/LessonOrderManager.test.tsx components/AdminPanel.tsx app/globals.css
git commit -m "feat: add drag controls for student lesson order"
```

---

### Task 4: Regression and release verification

**Files:**
- Modify only files implicated by a failing check.

**Interfaces:**
- Consumes the completed ordering model, endpoint, and UI.
- Produces a reviewed production commit on `main`.

- [ ] **Step 1: Run the full project gate**

Run in order:

```bash
npm.cmd test
npm.cmd run lint
npx.cmd tsc --noEmit
npm.cmd run build
npm.cmd audit --omit=dev --audit-level=moderate
git diff --check
```

Expected: all commands exit 0, zero failed tests, and zero moderate-or-higher production vulnerabilities.

- [ ] **Step 2: Request focused code review**

Review exact-set API validation, cross-section protection, stable sorting, rollback behavior, accessibility controls, and preservation of ID-linked student records. Resolve every Critical or Important issue and rerun the affected focused tests.

- [ ] **Step 3: Commit final remediation if needed**

```bash
git add lib/lessons-config.ts lib/lessons-config.test.ts app/api/admin/lesson-order/route.ts app/api/admin/lesson-order/route.test.ts lib/lesson-order-client.ts lib/lesson-order-client.test.ts components/LessonOrderManager.tsx components/LessonOrderManager.test.tsx components/AdminPanel.tsx app/globals.css
git commit -m "fix: harden student lesson reordering"
```

- [ ] **Step 4: Push and verify deployment**

```bash
git push origin main
```

Wait for the linked Vercel deployment to report Ready, then smoke-test `/`, unauthenticated `/dashboard`, and the signed-in admin Videos tab.
