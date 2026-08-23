/**
 * How play-chips are EARNED at The Table.
 *
 * Chips are never bought — they are granted for real progress in the course,
 * and every grant carries an idempotency key so the same achievement can only
 * ever pay once (enforced by UNIQUE (member_id, grant_key) in table_grants):
 *
 *   lesson:<lessonId>      250  — completing a lecture
 *   journal:<YYYY-MM-DD>   100  — a day on which the member wrote an entry
 *   daily:<YYYY-MM-DD>     100  — a daily stipend, so a broke player has action
 *
 * `computeGrants` is PURE (no db, no clock, no blob) so the whole earning
 * policy is unit-testable — see lib/table-earn.test.ts. The thin server
 * function below is the only part that touches real member progress.
 */

import type { GrantSpec } from "@/lib/table-chips-store";

export const LESSON_CHIPS = 250;
export const JOURNAL_DAY_CHIPS = 100;
export const DAILY_STIPEND_CHIPS = 100;

export interface ComputeGrantsInput {
  /** Lesson ids the member has completed. */
  completedLessonIds: readonly string[];
  /** ISO-ish timestamps (or YYYY-MM-DD) of journal entries — any granularity. */
  journalEntryDates: readonly string[];
  /** "YYYY-MM-DD" for the day the stipend is being computed for. */
  today: string;
}

/** UTC calendar day of an ISO timestamp, or null when unparseable. */
export function toDayKey(value: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/** Today's UTC day key — the only clock read in the earning path. */
export function todayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The FULL set of grants the member is entitled to, past and present. Claiming
 * is what makes it idempotent: table_grants drops any key already on file, so
 * handing the store the whole history every time is both correct and cheap.
 *
 * Journal days are capped by construction — only days that actually carry an
 * entry produce a key, and duplicate entries on one day collapse to one grant.
 */
export function computeGrants(input: ComputeGrantsInput): GrantSpec[] {
  const grants: GrantSpec[] = [];

  const lessonIds = Array.from(
    new Set(input.completedLessonIds.filter((id) => typeof id === "string" && id.trim() !== ""))
  );
  for (const lessonId of lessonIds) {
    grants.push({
      grantKey: `lesson:${lessonId.trim()}`,
      amount: LESSON_CHIPS,
      label: "Lecture completed",
    });
  }

  const journalDays = Array.from(
    new Set(
      input.journalEntryDates
        .map((value) => (typeof value === "string" ? toDayKey(value) : null))
        .filter((day): day is string => day !== null)
    )
  ).sort();
  for (const day of journalDays) {
    grants.push({
      grantKey: `journal:${day}`,
      amount: JOURNAL_DAY_CHIPS,
      label: "Journal entry",
    });
  }

  const today = toDayKey(input.today);
  if (today) {
    grants.push({
      grantKey: `daily:${today}`,
      amount: DAILY_STIPEND_CHIPS,
      label: "Daily stipend",
    });
  }

  return grants;
}

/**
 * Read the member's REAL progress — the same stores the dashboard renders from
 * — and turn it into grant specs. Defensive throughout: a blob hiccup must
 * never stop someone from sitting down at the table, it just means fewer chips
 * are claimable this round (and the grant keys are still there next time).
 */
export async function grantsForMember(discordId: string, now: Date = new Date()): Promise<GrantSpec[]> {
  const [{ getViewerProgress, getAddedLessons, getLessonOverrides }, { buildEffectiveLessons }, { autoPassedLessonIds }, { getJournal }] =
    await Promise.all([
      import("@/lib/lesson-store"),
      import("@/lib/lessons-config"),
      import("@/lib/progress-link"),
      import("@/lib/journal-store"),
    ]);

  const [progress, addedLessons, overrides, journal] = await Promise.all([
    getViewerProgress(discordId).catch(() => ({ completedLessons: [] as string[], submissions: {} })),
    getAddedLessons().catch(() => []),
    getLessonOverrides().catch(() => ({})),
    getJournal(discordId).catch(() => []),
  ]);

  const lessons = buildEffectiveLessons(addedLessons, overrides);
  const completedLessonIds = autoPassedLessonIds(
    discordId,
    progress.completedLessons ?? [],
    lessons.map((lesson) => lesson.id)
  );

  return computeGrants({
    completedLessonIds,
    journalEntryDates: journal.map((entry) => entry.createdAt),
    today: todayKey(now),
  });
}
