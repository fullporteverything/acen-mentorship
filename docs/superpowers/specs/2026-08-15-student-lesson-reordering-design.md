# Student Lesson Reordering Design

## Goal

Let an administrator reorder the lessons/videos students see without recreating lessons or losing student progress, homework, video assignments, captions, or completion history.

## Admin experience

- Add a dedicated ordering panel to the existing admin lesson controls.
- Render lessons grouped by their current curriculum section.
- Each row shows its drag handle, current position, lesson title, and assigned-video state.
- Dragging a row changes its position within that section. Moving a lesson to another section remains a separate category-editing action so an accidental drag cannot change CORE/supplemental rules.
- Provide Move up and Move down buttons for keyboard use and precise adjustments.
- Save the complete ordered list for the affected section immediately after a drop or button move.
- While saving, disable further moves. On failure, restore the previous order and show an inline retryable error.

## Student behavior

- The persisted order is the authoritative order on the student Lessons page, curriculum cards, sidebar navigation, overview progress, previous/next navigation, and CORE prerequisite calculation.
- Reordering CORE lessons therefore changes their learning sequence intentionally.
- Supplemental content remains gated behind completion of CORE Lecture 04, using the existing gate rule.
- Stored progress, watch history, homework submissions, reviews, captions, and video assignments remain linked by stable lesson ID and are not rewritten or deleted.

## Data and API design

- Store an integer ordering override for each reordered lesson in the existing lesson override record.
- Add one admin-only reorder endpoint that accepts a section name and the full ordered lesson-ID list for that section.
- Validate that the list contains every current lesson in the section exactly once, contains no foreign lesson IDs, and cannot change lesson categories.
- Persist the section reorder as one logical operation. Readers apply ordering overrides after combining static and admin-added lessons.
- The endpoint returns the complete effective lesson list so the admin UI reconciles with server state rather than assuming its optimistic order was accepted.
- Record the mutation through the existing admin rate-limit and audit boundary.

## Compatibility and failure handling

- Lessons without an ordering override retain their existing source order.
- Existing overrides remain valid; adding order does not alter title, description, video ID, homework prompt, visibility, or category.
- Invalid, duplicate, incomplete, or cross-section reorder requests return `400` without mutation.
- Authorization outages preserve the existing `503` response contract.
- Persistence failures return a retryable error and the client restores the last server-confirmed order.

## Verification

- Unit tests cover deterministic effective ordering and unchanged lesson IDs/data.
- Route tests cover authorization, duplicate/missing/foreign IDs, successful persistence, and audit coverage.
- Component tests cover drag reorder, button fallback, disabled saving state, rollback on error, and server reconciliation.
- Regression tests confirm CORE gating follows the new order and prior completed/homework lesson IDs remain unchanged.
- Run the complete test, lint, typecheck, production build, and audit gates before pushing.
