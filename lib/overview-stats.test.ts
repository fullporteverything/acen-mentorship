import { describe, expect, it } from "vitest";
import {
  buildCoreLearningSummary,
  buildOverviewStats,
  countCoreLessonProgress,
  countPendingHomework,
} from "./overview-stats";

describe("buildOverviewStats", () => {
  it("builds a core-only percentage and points to the next incomplete lecture", () => {
    expect(
      buildCoreLearningSummary(
        [
          { id: "core-1", title: "Foundations", group: "CORE CONTENT" },
          { id: "external-1", title: "Bonus", group: "EXTERNAL CONTENT" },
          { id: "core-2", title: "Execution", group: "CORE CONTENT" },
          { id: "core-3", title: "Risk", group: "CORE CONTENT" },
        ],
        ["core-1", "external-1"]
      )
    ).toEqual({
      totalLessons: 3,
      completedLessons: 1,
      percent: 33,
      nextLesson: { id: "core-2", title: "Execution" },
    });
  });

  it("reports 100 percent with no next lecture when all core content is complete", () => {
    expect(
      buildCoreLearningSummary(
        [{ id: "core-1", title: "Foundations", group: "CORE CONTENT" }],
        ["core-1"]
      )
    ).toEqual({
      totalLessons: 1,
      completedLessons: 1,
      percent: 100,
      nextLesson: undefined,
    });
  });

  it("counts only CORE CONTENT lectures and completions", () => {
    expect(
      countCoreLessonProgress(
        [
          { id: "core-1", group: "CORE CONTENT" },
          { id: "external-1", group: "EXTERNAL CONTENT" },
          { id: "core-2", group: "CORE CONTENT" },
        ],
        ["core-1", "external-1"]
      )
    ).toEqual({ totalLessons: 2, completedLessons: 1 });
  });

  it("uses the shared normalized CORE classifier", () => {
    expect(
      countCoreLessonProgress(
        [
          { id: "core-1", group: " core   content " },
          { id: "external-1", group: "EXTERNAL CONTENT" },
        ],
        ["core-1"]
      )
    ).toEqual({ totalLessons: 1, completedLessons: 1 });
  });

  it("reports real lecture totals, completed lectures, journal entries, and pending homework", () => {
    expect(
      buildOverviewStats({
        totalLessons: 12,
        completedLessons: 4,
        journalEntries: 3,
        pendingHomework: 2,
      })
    ).toEqual([
      { label: "Lectures", value: "12", sub: "4 completed", kanji: "修" },
      { label: "Journal", value: "3", sub: "entries", kanji: "念" },
      { label: "Homework", value: "2", sub: "awaiting review", kanji: "文" },
    ]);
  });

  it("uses singular journal copy and clamps invalid completed totals", () => {
    expect(
      buildOverviewStats({
        totalLessons: 2,
        completedLessons: 9,
        journalEntries: 1,
        pendingHomework: -3,
      })
    ).toEqual([
      { label: "Lectures", value: "2", sub: "2 completed", kanji: "修" },
      { label: "Journal", value: "1", sub: "entry", kanji: "念" },
      { label: "Homework", value: "0", sub: "all reviewed", kanji: "文" },
    ]);
  });

  it("reads the homework card as all reviewed when nothing is pending", () => {
    expect(
      buildOverviewStats({
        totalLessons: 1,
        completedLessons: 1,
        journalEntries: 0,
        pendingHomework: 0,
      }).at(-1)
    ).toEqual({ label: "Homework", value: "0", sub: "all reviewed", kanji: "文" });
  });
});

describe("countPendingHomework", () => {
  it("counts only submissions still awaiting a mentor decision", () => {
    expect(
      countPendingHomework({
        "lesson-1": { status: "approved" },
        "lesson-2": { status: "pending" },
        "lesson-3": { status: "rejected" },
        "lesson-4": { status: "pending" },
      })
    ).toBe(2);
  });

  it("returns zero for a member with no submissions", () => {
    expect(countPendingHomework({})).toBe(0);
  });
});
