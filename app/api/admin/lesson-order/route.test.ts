import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminOrResponse: vi.fn(),
  getAddedLessons: vi.fn(),
  getLessonOverrides: vi.fn(),
  saveLessonOverrides: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({ requireAdminOrResponse: mocks.requireAdminOrResponse }));
vi.mock("@/lib/mutation-security", () => ({ allowMutation: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/lesson-store", () => ({
  getAddedLessons: mocks.getAddedLessons,
  getLessonOverrides: mocks.getLessonOverrides,
  saveLessonOverrides: mocks.saveLessonOverrides,
}));

import { POST } from "./route";

// Static curriculum ships lesson-1..lesson-3 in CORE CONTENT.
const CORE_IDS = ["lesson-1", "lesson-2", "lesson-3"];

function request(body: unknown): never {
  return new Request("http://localhost/api/admin/lesson-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

describe("POST /api/admin/lesson-order", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminOrResponse.mockResolvedValue({ discordId: "admin-1", isAdmin: true });
    mocks.getAddedLessons.mockResolvedValue([]);
    mocks.getLessonOverrides.mockResolvedValue({});
    mocks.saveLessonOverrides.mockResolvedValue(undefined);
  });

  it("passes through the non-admin response without saving", async () => {
    const denied = new Response(null, { status: 403 });
    mocks.requireAdminOrResponse.mockResolvedValue(denied);
    const response = await POST(request({ group: "CORE CONTENT", lessonIds: CORE_IDS }));
    expect(response.status).toBe(403);
    expect(mocks.saveLessonOverrides).not.toHaveBeenCalled();
  });

  it("rejects duplicate ids", async () => {
    const response = await POST(
      request({ group: "CORE CONTENT", lessonIds: ["lesson-1", "lesson-1", "lesson-3"] })
    );
    expect(response.status).toBe(400);
    expect(mocks.saveLessonOverrides).not.toHaveBeenCalled();
  });

  it("rejects an incomplete section list", async () => {
    const response = await POST(
      request({ group: "CORE CONTENT", lessonIds: ["lesson-2", "lesson-1"] })
    );
    expect(response.status).toBe(400);
    expect(mocks.saveLessonOverrides).not.toHaveBeenCalled();
  });

  it("rejects ids from another section", async () => {
    mocks.getAddedLessons.mockResolvedValue([
      { id: "extra-1", title: "Extra", description: "", videoId: "", homeworkPrompt: "", group: "PA BREAKDOWNS" },
    ]);
    const response = await POST(
      request({ group: "CORE CONTENT", lessonIds: ["lesson-1", "lesson-2", "extra-1"] })
    );
    expect(response.status).toBe(400);
    expect(mocks.saveLessonOverrides).not.toHaveBeenCalled();
  });

  it("rejects an unknown section", async () => {
    const response = await POST(request({ group: "NOPE", lessonIds: ["x"] }));
    expect(response.status).toBe(400);
    expect(mocks.saveLessonOverrides).not.toHaveBeenCalled();
  });

  it("persists the order once and returns the server-authoritative list", async () => {
    const existing = { "lesson-1": { title: "Renamed" } };
    mocks.getLessonOverrides.mockResolvedValue(existing);
    const response = await POST(
      request({ group: " core   content ", lessonIds: ["lesson-3", "lesson-1", "lesson-2"] })
    );
    expect(response.status).toBe(200);
    expect(mocks.saveLessonOverrides).toHaveBeenCalledTimes(1);
    const saved = mocks.saveLessonOverrides.mock.calls[0][0];
    expect(saved["lesson-3"].order).toBe(0);
    expect(saved["lesson-1"]).toMatchObject({ title: "Renamed", order: 1 });
    expect(saved["lesson-2"].order).toBe(2);
    const data = (await (response as Response).json()) as {
      lessons: Array<{ id: string }>;
    };
    expect(data.lessons.slice(0, 3).map((l) => l.id)).toEqual([
      "lesson-3",
      "lesson-1",
      "lesson-2",
    ]);
  });
});
