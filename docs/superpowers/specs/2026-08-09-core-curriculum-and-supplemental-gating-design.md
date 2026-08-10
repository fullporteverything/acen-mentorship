# CORE Curriculum and Supplemental Gating Design

## Goal

Prevent supplemental lessons such as PA Breakdown or Free Weekly Breakdown from ever blocking the sequential CORE CONTENT path, while keeping supplemental categories visible and gated behind completion of the fourth CORE lecture.

## Student curriculum model

The effective lesson list is partitioned into two ordered collections:

- **CORE curriculum:** lessons whose trimmed, case-insensitive group name is exactly `CORE CONTENT`.
- **Supplemental curriculum:** every lesson in every other group.

Only the CORE collection participates in sequential progression. A CORE lesson unlocks when the immediately preceding CORE lesson is completed. Interleaved or newly added supplemental lessons never become CORE prerequisites.

The Lessons page presents CORE CONTENT first as the student's primary path. Supplemental categories remain visible beneath it. Before the gate is satisfied, their lessons render as locked and explain that CORE Lecture 04 must be completed. After the gate is satisfied, every supplemental lesson becomes accessible; supplemental categories do not introduce their own sequential prerequisites.

## Supplemental unlock gate

The gate is the fourth lesson in the ordered CORE collection, currently “Inducements × POI.” The implementation identifies it by its position in the CORE collection rather than by a fragile title or lesson ID.

- If the fourth CORE lesson is completed, all supplemental lessons are unlocked.
- If it is not completed, all supplemental lessons are locked.
- If fewer than four CORE lessons exist, supplemental lessons remain locked.
- Administrators bypass the gate so they can manage all lesson content.

New supplemental groups and lessons automatically inherit this rule because the partition is derived from the effective curriculum on every request.

## Navigation and direct URLs

- Overview counts and percentage continue to use CORE lessons only.
- “Continue Learning” selects the first incomplete CORE lesson only.
- The Lessons page's primary current/continue action selects from CORE lessons only.
- CORE numbering and sequential state use the filtered CORE collection.
- Supplemental lessons remain visible in their own sections with their own section numbering.
- Opening a supplemental lesson URL before the gate is satisfied shows the normal themed locked state and the CORE Lecture 04 requirement; it cannot affect or block CORE navigation.
- Previous/next navigation added in the later UX batch will traverse CORE lessons only when the viewer is in the CORE path.

## Data safety

No stored progress, homework submissions, journals, lesson overrides, added lessons, or video IDs are deleted or rewritten. The fix changes only how effective lessons are partitioned and how unlock state is derived at render time.

Existing completion records for supplemental lessons remain stored and become visible again after the CORE Lecture 04 gate is satisfied.

## Admin behavior

Admins continue to see and manage CORE and supplemental categories. Admin bypass applies only to viewing/unlock state and does not mutate student completion records.

## Error and edge behavior

- Group comparison trims whitespace and ignores letter case.
- A missing fourth CORE lesson fails closed: supplemental content stays locked.
- An unknown lesson ID remains a not-found response.
- Empty supplemental sections remain visible to admins for management and do not appear as CORE progression steps.

## Verification

Automated tests must prove:

1. Interleaving a supplemental lesson between CORE lessons does not block the next CORE lesson.
2. The CORE current lesson ignores incomplete supplemental lessons.
3. Supplemental lessons are locked before the fourth CORE completion.
4. All supplemental lessons unlock after the fourth CORE completion.
5. Fewer than four CORE lessons keeps supplemental content locked.
6. Admin bypass unlocks supplemental content without modifying progress.
7. Group matching is trimmed and case-insensitive.
8. Existing overview CORE-only counting remains correct.

The focused tests, full test suite, TypeScript check, and production build must pass before deployment.

## Follow-on work

After this blocker is deployed independently, the previously approved ten-item desktop-first improvement program proceeds as separate design and implementation batches: watch progress, previous/next navigation, faster internal navigation, notification center, desktop admin organization, caption retry, direct video assignment, readability, retry/error states, and login/support access.
