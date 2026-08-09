import { describe, expect, it } from "vitest";
import { buildOverviewStats, countCoreLessonProgress } from "./overview-stats";

describe("buildOverviewStats", () => {
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

  it("reports real lecture totals, completed lectures, and journal entries", () => {
    expect(
      buildOverviewStats({
        totalLessons: 12,
        completedLessons: 4,
        journalEntries: 3,
      })
    ).toEqual([
      { label: "Lectures", value: "12", sub: "4 completed", kanji: "修" },
      { label: "Journal", value: "3", sub: "entries", kanji: "念" },
      { label: "Access", value: "Active", sub: "Private member", kanji: "礼" },
    ]);
  });

  it("uses singular journal copy and clamps invalid completed totals", () => {
    expect(
      buildOverviewStats({
        totalLessons: 2,
        completedLessons: 9,
        journalEntries: 1,
      })
    ).toEqual([
      { label: "Lectures", value: "2", sub: "2 completed", kanji: "修" },
      { label: "Journal", value: "1", sub: "entry", kanji: "念" },
      { label: "Access", value: "Active", sub: "Private member", kanji: "礼" },
    ]);
  });
});
