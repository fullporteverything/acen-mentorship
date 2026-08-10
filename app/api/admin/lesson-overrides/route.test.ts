import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getAddedLessons: vi.fn(),
  getLessonOverrides: vi.fn(),
  saveLessonOverrides: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/lesson-store", () => ({
  getAddedLessons: mocks.getAddedLessons,
  getLessonOverrides: mocks.getLessonOverrides,
  saveLessonOverrides: mocks.saveLessonOverrides,
}));

import { POST } from "./route";

describe("POST /api/admin/lesson-overrides", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_DISCORD_ID = "admin-1";
    mocks.auth.mockResolvedValue({ user: { discordId: "admin-1" } });
    mocks.getAddedLessons.mockResolvedValue([]);
    mocks.getLessonOverrides.mockResolvedValue({});
    mocks.saveLessonOverrides.mockResolvedValue(undefined);
  });

  it("rejects a forged unknown lesson without writing overrides", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/lesson-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lessonId: "forged-lesson",
          field: "videoId",
          value: "21c39a46-fda5-4222-bec6-6a6be8b1a461",
        }),
      }) as never
    );

    expect(response.status).toBe(400);
    expect(mocks.saveLessonOverrides).not.toHaveBeenCalled();
  });
});
