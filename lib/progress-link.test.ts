import { describe, expect, it } from "vitest";
import {
  autoPassedLessonIds,
  OWNER_MAIN_DISCORD_ID,
  progressViewerIds,
} from "./progress-link";

describe("progressViewerIds", () => {
  it("uses the confirmed owner account as the main by default", () => {
    expect(OWNER_MAIN_DISCORD_ID).toBe("353994234983874570");
    expect(progressViewerIds(OWNER_MAIN_DISCORD_ID)).toEqual([
      OWNER_MAIN_DISCORD_ID,
      "1417619259252801546",
    ]);
  });
  it("links the configured main account and preview alt in both directions", () => {
    expect(progressViewerIds("main-id", "main-id")).toEqual([
      "main-id",
      "1417619259252801546",
    ]);
    expect(progressViewerIds("1417619259252801546", "main-id")).toEqual([
      "1417619259252801546",
      "main-id",
    ]);
  });

  it("leaves every student account isolated", () => {
    expect(progressViewerIds("student-id", "main-id")).toEqual(["student-id"]);
  });

  it("automatically passes all current and future lessons for both test accounts", () => {
    const lessons = ["lesson-1", "lesson-2", "new-lesson"];
    expect(autoPassedLessonIds("main-id", ["lesson-1"], lessons, "main-id"))
      .toEqual(lessons);
    expect(autoPassedLessonIds("1417619259252801546", [], lessons, "main-id"))
      .toEqual(lessons);
    expect(autoPassedLessonIds("student-id", ["lesson-1"], lessons, "main-id"))
      .toEqual(["lesson-1"]);
  });
});
