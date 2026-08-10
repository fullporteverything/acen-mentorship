import { describe, expect, it } from "vitest";
import {
  normalizeWatchProgress,
  shouldResumeWatchProgress,
} from "./watch-progress";

describe("watch progress", () => {
  it("clamps invalid time values and derives percentage from duration", () => {
    expect(
      normalizeWatchProgress({ currentTime: 150, duration: 100 })
    ).toMatchObject({ currentTime: 100, duration: 100, percent: 100 });
    expect(
      normalizeWatchProgress({ currentTime: -4, duration: -1 })
    ).toMatchObject({ currentTime: 0, duration: 0, percent: 0 });
  });

  it("marks ended or effectively finished videos complete", () => {
    expect(
      normalizeWatchProgress({ currentTime: 95, duration: 100 }).completed
    ).toBe(true);
    expect(
      normalizeWatchProgress({ currentTime: 10, duration: 100, ended: true })
    ).toMatchObject({ currentTime: 100, percent: 100, completed: true });
  });

  it("resumes only meaningful unfinished positions", () => {
    expect(shouldResumeWatchProgress({ currentTime: 4, percent: 4 })).toBe(false);
    expect(shouldResumeWatchProgress({ currentTime: 42, percent: 42 })).toBe(true);
    expect(shouldResumeWatchProgress({ currentTime: 95, percent: 95 })).toBe(false);
  });
});
