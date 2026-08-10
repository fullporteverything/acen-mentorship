export interface OverviewStatsInput {
  totalLessons: number;
  completedLessons: number;
  journalEntries: number;
}

export interface OverviewStatCard {
  label: string;
  value: string;
  sub: string;
  kanji: string;
}

interface OverviewLesson {
  id: string;
  group: string;
}

interface TitledOverviewLesson extends OverviewLesson {
  title: string;
}

export interface CoreLearningSummary {
  totalLessons: number;
  completedLessons: number;
  percent: number;
  nextLesson?: { id: string; title: string };
}

export function buildCoreLearningSummary(
  lessons: TitledOverviewLesson[],
  completedLessonIds: string[]
): CoreLearningSummary {
  const completed = new Set(completedLessonIds);
  const coreLessons = lessons.filter(isCoreLesson);
  const completedLessons = coreLessons.filter((lesson) =>
    completed.has(lesson.id)
  ).length;
  const next = coreLessons.find((lesson) => !completed.has(lesson.id));

  return {
    totalLessons: coreLessons.length,
    completedLessons,
    percent:
      coreLessons.length === 0
        ? 0
        : Math.round((completedLessons / coreLessons.length) * 100),
    nextLesson: next ? { id: next.id, title: next.title } : undefined,
  };
}

export function countCoreLessonProgress(
  lessons: OverviewLesson[],
  completedLessonIds: string[]
): Pick<OverviewStatsInput, "totalLessons" | "completedLessons"> {
  const completed = new Set(completedLessonIds);
  const coreLessons = lessons.filter(isCoreLesson);

  return {
    totalLessons: coreLessons.length,
    completedLessons: coreLessons.filter((lesson) => completed.has(lesson.id))
      .length,
  };
}

export function buildOverviewStats({
  totalLessons,
  completedLessons,
  journalEntries,
}: OverviewStatsInput): OverviewStatCard[] {
  const total = Math.max(0, totalLessons);
  const completed = Math.min(total, Math.max(0, completedLessons));
  const entries = Math.max(0, journalEntries);

  return [
    {
      label: "Lectures",
      value: String(total),
      sub: `${completed} completed`,
      kanji: "修",
    },
    {
      label: "Journal",
      value: String(entries),
      sub: entries === 1 ? "entry" : "entries",
      kanji: "念",
    },
    {
      label: "Access",
      value: "Active",
      sub: "Private member",
      kanji: "礼",
    },
  ];
}
import { isCoreLesson } from "./lessons-config";
