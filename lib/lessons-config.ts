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

/** Look up a single lesson by its id. */
export function getLesson(lessonId: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === lessonId);
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

export function computeLessonStates(completedLessons: string[]): LessonState[] {
  const completed = new Set(completedLessons);
  let currentAssigned = false;

  return LESSONS.map((lesson, index) => {
    const isCompleted = completed.has(lesson.id);
    const unlocked = index === 0 || completed.has(LESSONS[index - 1].id);

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
  completedLessons: string[]
): boolean {
  const idx = LESSONS.findIndex((l) => l.id === lessonId);
  if (idx <= 0) return idx === 0; // first lesson always unlocked; unknown => false
  return completedLessons.includes(LESSONS[idx - 1].id);
}

/** Lessons grouped by their `group` label, preserving curriculum order. */
export function getLessonGroups(): { group: string; lessons: Lesson[] }[] {
  const groups: { group: string; lessons: Lesson[] }[] = [];
  for (const lesson of LESSONS) {
    let bucket = groups.find((g) => g.group === lesson.group);
    if (!bucket) {
      bucket = { group: lesson.group, lessons: [] };
      groups.push(bucket);
    }
    bucket.lessons.push(lesson);
  }
  return groups;
}
