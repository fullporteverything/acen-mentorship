import { isKinescopeVideoId } from "./video-id";

/**
 * Static lesson curriculum for the Dojo.
 *
 * This is the single source of truth for what lessons exist, their order,
 * their Kinescope video IDs, and the homework each one requires.
 * User-specific state (which lessons are unlocked / completed) lives in blob
 * storage — see `lib/lesson-store.ts`. This file only describes the content.
 */

export interface Lesson {
  id: string; // "lesson-1", "lesson-2", etc.
  title: string; // Display title
  description: string; // Short description
  videoId: string; // Kinescope video UUID; blank means unavailable
  homeworkPrompt: string; // What the student needs to submit
  group: string; // e.g. "CORE CONTENT"
}

export const LESSONS: Lesson[] = [
  {
    id: "lesson-1",
    title: "Introduction to Suite 7",
    description: "Welcome and overview.",
    videoId: "",
    homeworkPrompt:
      "Submit a 1-page PDF introducing yourself and your trading goals.",
    group: "CORE CONTENT",
  },
  {
    id: "lesson-2",
    title: "Lesson 2",
    description: "Coming soon.",
    videoId: "",
    homeworkPrompt: "Submit your homework for lesson 2.",
    group: "CORE CONTENT",
  },
  {
    id: "lesson-3",
    title: "Lesson 3",
    description: "Coming soon.",
    videoId: "",
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
  /**
   * Kinescope video ID attached from the admin UI. An empty string makes the
   * lesson unavailable until a replacement is assigned.
   */
  videoId?: string;
  /**
   * Position of the lesson WITHIN ITS SECTION (0-based; lower renders and
   * gates first). Written by the admin reorder endpoint for every lesson in
   * the section at once. Lessons without an order keep source order and sort
   * after ordered siblings (so a lesson added post-reorder lands at the end
   * of its section).
   */
  order?: number;
  /**
   * Removes a BUILT-IN lesson from the effective curriculum. Static lessons
   * live in code and can't be deleted from a blob, so "delete" for them means
   * hiding: the lesson vanishes from every student/admin surface but its id —
   * and all progress/homework attached to it — survives, so clearing the
   * flag restores it intact. Admin-added lessons are genuinely deleted
   * instead and never use this.
   */
  hidden?: boolean;
}

/** Map of lessonId -> override. */
export type LessonOverrides = Record<string, LessonOverride>;

/** Fields that inline editing / the overrides API accept. */
export const OVERRIDABLE_FIELDS = [
  "title",
  "description",
  "homeworkPrompt",
  "videoId",
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
    ...(typeof o.videoId === "string"
      ? {
          videoId: isKinescopeVideoId(o.videoId.trim())
            ? o.videoId.trim()
            : "",
        }
      : {}),
  };
}

/**
 * Reorder the merged curriculum by per-lesson `order` overrides, WITHIN each
 * section only. Groups keep their first-appearance order; inside a group,
 * ordered lessons sort by their override (source index breaks ties), and
 * unordered lessons follow in source order. Lesson objects are untouched —
 * only their positions change.
 */
function applyCurriculumOrder(
  lessons: Lesson[],
  overrides: LessonOverrides
): Lesson[] {
  const groupRank = new Map<string, number>();
  for (const lesson of lessons) {
    const key = normalizeGroupName(lesson.group);
    if (!groupRank.has(key)) groupRank.set(key, groupRank.size);
  }
  const orderOf = (lesson: Lesson): number | null => {
    const value = overrides[lesson.id]?.order;
    return typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : null;
  };
  return lessons
    .map((lesson, sourceIndex) => ({ lesson, sourceIndex }))
    .sort((a, b) => {
      const groupDelta =
        (groupRank.get(normalizeGroupName(a.lesson.group)) ?? 0) -
        (groupRank.get(normalizeGroupName(b.lesson.group)) ?? 0);
      if (groupDelta !== 0) return groupDelta;
      const orderA = orderOf(a.lesson);
      const orderB = orderOf(b.lesson);
      if (orderA !== null && orderB !== null && orderA !== orderB) {
        return orderA - orderB;
      }
      if (orderA !== null && orderB === null) return -1;
      if (orderA === null && orderB !== null) return 1;
      return a.sourceIndex - b.sourceIndex;
    })
    .map((entry) => entry.lesson);
}

/**
 * Build the effective curriculum: the static lessons plus any admin-added
 * lessons (appended in order), with per-lesson overrides applied and any
 * admin ordering overrides positioning lessons within their sections.
 */
export function buildEffectiveLessons(
  added: Lesson[] = [],
  overrides: LessonOverrides = {}
): Lesson[] {
  const merged = [...LESSONS, ...added]
    .filter((lesson) => overrides[lesson.id]?.hidden !== true)
    .map((lesson) =>
      applyOverrides(
        {
          ...lesson,
          videoId: isKinescopeVideoId(lesson.videoId?.trim())
            ? lesson.videoId.trim()
            : "",
        },
        overrides
      )
    );
  return applyCurriculumOrder(merged, overrides);
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

export const CORE_GROUP = "CORE CONTENT";
export const SUPPLEMENTAL_GATE_CORE_POSITION = 4;

export function normalizeGroupName(group: string): string {
  return group.trim().replace(/\s+/g, " ").toUpperCase();
}

/** A normalized group comparison keeps admin-entered casing/spacing harmless. */
export function isCoreLesson(lesson: { group: string }): boolean {
  return normalizeGroupName(lesson.group) === CORE_GROUP;
}

export function partitionCurriculum(lessons: Lesson[] = LESSONS): {
  coreLessons: Lesson[];
  supplementalLessons: Lesson[];
} {
  return lessons.reduce(
    (result, lesson) => {
      if (isCoreLesson(lesson)) result.coreLessons.push(lesson);
      else result.supplementalLessons.push(lesson);
      return result;
    },
    { coreLessons: [] as Lesson[], supplementalLessons: [] as Lesson[] }
  );
}

export interface CurriculumStates {
  coreStates: LessonState[];
  supplementalStates: LessonState[];
  /** CORE first, then supplemental content in its original relative order. */
  states: LessonState[];
  stateById: Map<string, LessonState>;
  supplementalGateLesson?: Lesson;
  supplementalUnlocked: boolean;
}

export interface LessonNavigation {
  previous?: Lesson;
  next?: Lesson;
  nextLocked?: Lesson;
}

/**
 * Derive the complete student curriculum without allowing supplemental items
 * to interrupt the sequential CORE path. All supplemental groups share the
 * fourth CORE lesson as one gate and fail closed when that lesson is absent.
 */
export function computeCurriculumStates(
  completedLessons: string[],
  lessons: Lesson[] = LESSONS,
  unlockAll = false
): CurriculumStates {
  const completed = new Set(completedLessons);
  const { coreLessons, supplementalLessons } = partitionCurriculum(lessons);
  const coreStates = computeLessonStates(completedLessons, coreLessons, unlockAll);
  const supplementalGateLesson =
    coreLessons[SUPPLEMENTAL_GATE_CORE_POSITION - 1];
  const supplementalUnlocked =
    unlockAll ||
    Boolean(
      supplementalGateLesson && completed.has(supplementalGateLesson.id)
    );
  const supplementalStates = supplementalLessons.map((lesson, index) => ({
    lesson,
    index,
    completed: completed.has(lesson.id),
    unlocked: supplementalUnlocked,
    current: false,
  }));
  const states = [...coreStates, ...supplementalStates];

  return {
    coreStates,
    supplementalStates,
    states,
    stateById: new Map(states.map((state) => [state.lesson.id, state])),
    supplementalGateLesson,
    supplementalUnlocked,
  };
}

/** Access-aware navigation that never crosses between CORE and supplemental. */
export function getLessonNavigation(
  lessonId: string,
  completedLessons: string[],
  lessons: Lesson[] = LESSONS,
  unlockAll = false
): LessonNavigation {
  const current = getLesson(lessonId, lessons);
  if (!current) return {};
  const curriculum = computeCurriculumStates(
    completedLessons,
    lessons,
    unlockAll
  );
  const sequence = isCoreLesson(current)
    ? partitionCurriculum(lessons).coreLessons
    : partitionCurriculum(lessons).supplementalLessons.filter(
        (lesson) =>
          normalizeGroupName(lesson.group) === normalizeGroupName(current.group)
      );
  const index = sequence.findIndex((lesson) => lesson.id === lessonId);
  const accessible = (lesson: Lesson | undefined) =>
    lesson && curriculum.stateById.get(lesson.id)?.unlocked ? lesson : undefined;

  const nextCandidate = index >= 0 ? sequence[index + 1] : undefined;
  const next = accessible(nextCandidate);
  return {
    previous: accessible(index > 0 ? sequence[index - 1] : undefined),
    next,
    nextLocked: nextCandidate && !next ? nextCandidate : undefined,
  };
}

/**
 * `unlockAll` bypasses sequential gating entirely — every lesson reports as
 * unlocked. Used for the admin, who is never locked out of their own
 * curriculum; student behaviour is unchanged when it is false (the default).
 */
export function computeLessonStates(
  completedLessons: string[],
  lessons: Lesson[] = LESSONS,
  unlockAll = false
): LessonState[] {
  const completed = new Set(completedLessons);
  let currentAssigned = false;

  return lessons.map((lesson, index) => {
    const isCompleted = completed.has(lesson.id);
    const unlocked =
      unlockAll || index === 0 || completed.has(lessons[index - 1].id);

    let current = false;
    if (unlocked && !isCompleted && !currentAssigned) {
      current = true;
      currentAssigned = true;
    }

    return { lesson, index, completed: isCompleted, unlocked, current };
  });
}

/**
 * Whether a specific lesson is unlocked for a given completed-lessons list.
 * `unlockAll` (the admin) unlocks any lesson that exists in `lessons`.
 */
/**
 * 1-based position of a lesson WITHIN ITS OWN SECTION. Numbering restarts at
 * 01 for each section — a lesson's number is its order among siblings sharing
 * its `group`, not its position in the whole curriculum.
 */
export function sectionLessonNumber(lessonId: string, lessons: Lesson[]): number {
  const lesson = lessons.find((l) => l.id === lessonId);
  if (!lesson) return 1;
  if (isCoreLesson(lesson)) {
    const idx = partitionCurriculum(lessons).coreLessons.findIndex(
      (candidate) => candidate.id === lessonId
    );
    return idx >= 0 ? idx + 1 : 1;
  }
  const siblings = lessons.filter((l) => l.group === lesson.group);
  const idx = siblings.findIndex((l) => l.id === lessonId);
  return idx >= 0 ? idx + 1 : 1;
}

export function isLessonUnlocked(
  lessonId: string,
  completedLessons: string[],
  lessons: Lesson[] = LESSONS,
  unlockAll = false
): boolean {
  return (
    computeCurriculumStates(completedLessons, lessons, unlockAll).stateById.get(
      lessonId
    )?.unlocked ?? false
  );
}

/**
 * Lessons grouped by their `group` label, preserving curriculum order.
 *
 * `extraSections` are admin-added empty section names: any that don't already
 * have lessons are appended as empty groups (ordered after the populated ones)
 * so a freshly-created section still renders before it holds any lesson.
 */
export function getLessonGroups(
  lessons: Lesson[] = LESSONS,
  extraSections: string[] = []
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
  for (const section of extraSections) {
    if (!groups.some((g) => g.group === section)) {
      groups.push({ group: section, lessons: [] });
    }
  }
  return groups;
}
