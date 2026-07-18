/**
 * Static lesson curriculum for the Dojo.
 *
 * This is the single source of truth for what lessons exist, their order,
 * their Cloudflare Stream video ids, and the homework each one requires.
 * User-specific state (which lessons are unlocked / completed) lives in blob
 * storage — see `lib/lesson-store.ts`. This file only describes the content.
 */

export interface Lesson {
  id: string; // "lesson-1", "lesson-2", etc.
  title: string; // Display title
  description: string; // Short description
  videoId: string; // Cloudflare Stream video ID (placeholder: "YOUR_VIDEO_ID_HERE")
  homeworkPrompt: string; // What the student needs to submit
  group: string; // e.g. "CORE CONTENT"
}

export const LESSONS: Lesson[] = [
  {
    id: "lesson-1",
    title: "Introduction to Dojo",
    description: "Welcome and overview.",
    videoId: "YOUR_VIDEO_ID_HERE",
    homeworkPrompt:
      "Submit a 1-page PDF introducing yourself and your trading goals.",
    group: "CORE CONTENT",
  },
  {
    id: "lesson-2",
    title: "Lesson 2",
    description: "Coming soon.",
    videoId: "YOUR_VIDEO_ID_HERE",
    homeworkPrompt: "Submit your homework for lesson 2.",
    group: "CORE CONTENT",
  },
  {
    id: "lesson-3",
    title: "Lesson 3",
    description: "Coming soon.",
    videoId: "YOUR_VIDEO_ID_HERE",
    homeworkPrompt: "Submit your homework for lesson 3.",
    group: "CORE CONTENT",
  },
];

// ---------------------------------------------------------------------------
// Admin overrides + admin-added lessons
//
// The static LESSONS array above is the base curriculum. Admins can, at
// runtime, (a) override a lesson's title/description/homework prompt and
// (b) append brand-new lessons. Both layers are persisted in Vercel Blob
// (see `lib/lesson-store.ts`) and merged over the base list for display and
// gating. Everything below operates on an "effective" lesson list, which
// defaults to LESSONS when no overrides/additions are supplied.
// ---------------------------------------------------------------------------

/** The subset of lesson fields an admin may override at runtime. */
export interface LessonOverride {
  title?: string;
  description?: string;
  homeworkPrompt?: string;
}

/** Map of lessonId -> override. */
export type LessonOverrides = Record<string, LessonOverride>;

/** Fields that inline editing / the overrides API accept. */
export const OVERRIDABLE_FIELDS = [
  "title",
  "description",
  "homeworkPrompt",
] as const;
export type OverridableField = (typeof OVERRIDABLE_FIELDS)[number];

/** Apply any override for `lesson` on top of its static values. */
export function applyOverrides(
  lesson: Lesson,
  overrides: LessonOverrides
): Lesson {
  const o = overrides[lesson.id];
  if (!o) return lesson;
  return {
    ...lesson,
    ...(typeof o.title === "string" ? { title: o.title } : {}),
    ...(typeof o.description === "string"
      ? { description: o.description }
      : {}),
    ...(typeof o.homeworkPrompt === "string"
      ? { homeworkPrompt: o.homeworkPrompt }
      : {}),
  };
}

/**
 * Build the effective curriculum: the static lessons plus any admin-added
 * lessons (appended in order), with per-lesson overrides applied.
 */
export function buildEffectiveLessons(
  added: Lesson[] = [],
  overrides: LessonOverrides = {}
): Lesson[] {
  return [...LESSONS, ...added].map((l) => applyOverrides(l, overrides));
}

/** Look up a single lesson by its id, within `lessons` (defaults to LESSONS). */
export function getLesson(
  lessonId: string,
  lessons: Lesson[] = LESSONS
): Lesson | undefined {
  return lessons.find((l) => l.id === lessonId);
}

/**
 * Derived per-lesson state, combining the static curriculum with a user's
 * `completedLessons` list. A lesson unlocks once the lesson before it has
 * been approved; `current` marks the first unlocked-but-not-completed lesson.
 */
export interface LessonState {
  lesson: Lesson;
  index: number;
  /** Homework approved. */
  completed: boolean;
  /** First lesson, or the previous lesson is completed. */
  unlocked: boolean;
  /** The single "up next" lesson the student should be working on. */
  current: boolean;
}

export function computeLessonStates(
  completedLessons: string[],
  lessons: Lesson[] = LESSONS
): LessonState[] {
  const completed = new Set(completedLessons);
  let currentAssigned = false;

  return lessons.map((lesson, index) => {
    const isCompleted = completed.has(lesson.id);
    const unlocked = index === 0 || completed.has(lessons[index - 1].id);

    let current = false;
    if (unlocked && !isCompleted && !currentAssigned) {
      current = true;
      currentAssigned = true;
    }

    return { lesson, index, completed: isCompleted, unlocked, current };
  });
}

/** Whether a specific lesson is unlocked for a given completed-lessons list. */
export function isLessonUnlocked(
  lessonId: string,
  completedLessons: string[],
  lessons: Lesson[] = LESSONS
): boolean {
  const idx = lessons.findIndex((l) => l.id === lessonId);
  if (idx <= 0) return idx === 0; // first lesson always unlocked; unknown => false
  return completedLessons.includes(lessons[idx - 1].id);
}

/** Lessons grouped by their `group` label, preserving curriculum order. */
export function getLessonGroups(
  lessons: Lesson[] = LESSONS
): { group: string; lessons: Lesson[] }[] {
  const groups: { group: string; lessons: Lesson[] }[] = [];
  for (const lesson of lessons) {
    let bucket = groups.find((g) => g.group === lesson.group);
    if (!bucket) {
      bucket = { group: lesson.group, lessons: [] };
      groups.push(bucket);
    }
    bucket.lessons.push(lesson);
  }
  return groups;
}
