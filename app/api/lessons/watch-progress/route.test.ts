import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lesson } from "@/lib/lessons-config";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getAddedLessons: vi.fn(),
  getLessonOverrides: vi.fn(),
  getUserProgress: vi.fn(),
  getWatchProgress: vi.fn(),
  saveWatchProgress: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/lesson-store", () => ({
  getAddedLessons: mocks.getAddedLessons,
  getLessonOverrides: mocks.getLessonOverrides,
  getUserProgress: mocks.getUserProgress,
}));
vi.mock("@/lib/watch-progress-store", () => ({
  getWatchProgress: mocks.getWatchProgress,
  saveWatchProgress: mocks.saveWatchProgress,
}));

import { POST } from "./route";

const additions: Lesson[] = [
  {
    id: "lesson-4",
    title: "Inducements × POI",
    description: "CORE gate",
    homeworkPrompt: "CORE homework",
    videoId: "",
    group: "CORE CONTENT",
  },
  {
    id: "weekly-1",
    title: "Weekly Breakdown",
    description: "Supplemental",
    homeworkPrompt: "Supplemental homework",
    videoId: "",
    group: "PA BREAKDOWNS",
  },
];

function requestFor(lessonId: string) {
  return new Request("http://localhost/api/lessons/watch-progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lessonId, currentTime: 50, duration: 100 }),
  });
}

describe("POST /api/lessons/watch-progress authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_DISCORD_ID;
    mocks.auth.mockResolvedValue({
      user: { discordId: "student-1", name: "Student" },
    });
    mocks.getAddedLessons.mockResolvedValue(additions);
    mocks.getLessonOverrides.mockResolvedValue({});
    mocks.getWatchProgress.mockResolvedValue(null);
    mocks.saveWatchProgress.mockResolvedValue(undefined);
  });

  it("does not save progress for a locked supplemental lesson", async () => {
    mocks.getUserProgress.mockResolvedValue({
      completedLessons: ["lesson-1", "lesson-2", "lesson-3"],
      submissions: {},
    });

    const response = await POST(requestFor("weekly-1"));

    expect(response.status).toBe(403);
    expect(mocks.saveWatchProgress).not.toHaveBeenCalled();
  });

  it("saves normalized progress after CORE Lecture 04", async () => {
    mocks.getUserProgress.mockResolvedValue({
      completedLessons: ["lesson-1", "lesson-2", "lesson-3", "lesson-4"],
      submissions: {},
    });

    const response = await POST(requestFor("weekly-1"));

    expect(response.status).toBe(200);
    expect(mocks.saveWatchProgress).toHaveBeenCalledWith(
      "student-1",
      "weekly-1",
      expect.objectContaining({ currentTime: 50, duration: 100, percent: 50 })
    );
  });

  it("preserves the admin bypass", async () => {
    process.env.ADMIN_DISCORD_ID = "student-1";
    mocks.getUserProgress.mockResolvedValue({
      completedLessons: [],
      submissions: {},
    });

    const response = await POST(requestFor("weekly-1"));

    expect(response.status).toBe(200);
    expect(mocks.saveWatchProgress).toHaveBeenCalledOnce();
  });
});
