import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAdminOrResponse: vi.fn(), allowMutation: vi.fn(), getUserProgress: vi.fn(),
  saveUserProgress: vi.fn(), reviewArchivedHomework: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({ requireAdminOrResponse: mocks.requireAdminOrResponse }));
vi.mock("@/lib/mutation-security", () => ({ allowMutation: mocks.allowMutation }));
vi.mock("@/lib/lesson-store", () => ({
  getAllSubmissions: vi.fn(), getUserProgress: mocks.getUserProgress, saveUserProgress: mocks.saveUserProgress,
}));
vi.mock("@/lib/homework-archive", () => ({ reviewArchivedHomework: mocks.reviewArchivedHomework }));
vi.mock("@/lib/progress-link", () => ({ progressViewerIds: (id: string) => [id] }));

import { POST } from "./route";

function request() {
  return new NextRequest("http://localhost/api/admin/homework", {
    method: "POST",
    body: JSON.stringify({ discordId: "student-1", lessonId: "lesson-1", action: "approve", feedback: "Good" }),
  });
}

describe("POST /api/admin/homework", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminOrResponse.mockResolvedValue({ discordId: "admin-1", isAdmin: true, name: "Admin" });
    mocks.allowMutation.mockResolvedValue(null);
    mocks.getUserProgress.mockResolvedValue({
      discordId: "student-1", completedLessons: [],
      submissions: { "lesson-1": { blobUrl: "dojo/homework/student-1/a.pdf", status: "pending", feedback: "" } },
    });
    mocks.saveUserProgress.mockResolvedValue(undefined);
  });

  it("allows a legacy-only submission while preserving the applied review", async () => {
    mocks.reviewArchivedHomework.mockResolvedValue(false);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.saveUserProgress).toHaveBeenCalledOnce();
  });

  it("fails before changing legacy progress when archive synchronization is temporarily unavailable", async () => {
    mocks.reviewArchivedHomework.mockRejectedValue(new Error("database unavailable"));
    await expect(POST(request())).rejects.toThrow("database unavailable");
    expect(mocks.saveUserProgress).not.toHaveBeenCalled();
  });
});
