import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminOrResponse: vi.fn(),
  getAddedLessons: vi.fn(),
  saveAddedLessons: vi.fn(),
  getLessonOverrides: vi.fn(),
  saveLessonOverrides: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({ requireAdminOrResponse: mocks.requireAdminOrResponse }));
vi.mock("@/lib/mutation-security", () => ({ allowMutation: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/lesson-store", () => ({
  getAddedLessons: mocks.getAddedLessons,
  saveAddedLessons: mocks.saveAddedLessons,
  getLessonOverrides: mocks.getLessonOverrides,
  saveLessonOverrides: mocks.saveLessonOverrides,
}));

import { DELETE } from "./route";

function addedLesson(id: string, group = "PA BREAKDOWNS") {
  return {
    id,
    title: id,
    description: "",
    videoId: "",
    homeworkPrompt: "",
    group,
  };
}

function request(body: unknown): never {
  return new Request("http://localhost/api/admin/lesson", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

describe("DELETE /api/admin/lesson", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminOrResponse.mockResolvedValue({ discordId: "admin-1", isAdmin: true });
    mocks.getAddedLessons.mockResolvedValue([]);
    mocks.saveAddedLessons.mockResolvedValue(undefined);
    mocks.getLessonOverrides.mockResolvedValue({});
    mocks.saveLessonOverrides.mockResolvedValue(undefined);
  });

  it("passes through the non-admin response without saving", async () => {
    const denied = new Response(null, { status: 403 });
    mocks.requireAdminOrResponse.mockResolvedValue(denied);
    const response = await DELETE(request({ id: "lesson-1" }));
    expect(response.status).toBe(403);
    expect(mocks.saveLessonOverrides).not.toHaveBeenCalled();
    expect(mocks.saveAddedLessons).not.toHaveBeenCalled();
  });

  it("requires a lesson id", async () => {
    const response = await DELETE(request({ id: "  " }));
    expect(response.status).toBe(400);
    expect(mocks.saveLessonOverrides).not.toHaveBeenCalled();
    expect(mocks.saveAddedLessons).not.toHaveBeenCalled();
  });

  it("hides a built-in lesson instead of deleting it, keeping other overrides", async () => {
    mocks.getLessonOverrides.mockResolvedValue({
      "lesson-1": { title: "Renamed" },
      "lesson-2": { order: 1 },
    });

    const response = await DELETE(request({ id: "lesson-1" }));

    expect(response.status).toBe(200);
    expect(await (response as Response).json()).toEqual({ ok: true, hidden: true });
    expect(mocks.saveLessonOverrides).toHaveBeenCalledTimes(1);
    expect(mocks.saveLessonOverrides.mock.calls[0][0]).toEqual({
      "lesson-1": { title: "Renamed", hidden: true },
      "lesson-2": { order: 1 },
    });
    // The added-lessons blob has nothing to do with a built-in lesson.
    expect(mocks.saveAddedLessons).not.toHaveBeenCalled();
  });

  it("hides a built-in lesson that had no override yet", async () => {
    const response = await DELETE(request({ id: "lesson-3" }));
    expect(response.status).toBe(200);
    expect(mocks.saveLessonOverrides.mock.calls[0][0]).toEqual({
      "lesson-3": { hidden: true },
    });
  });

  it("removes an admin-added lesson from the added list", async () => {
    mocks.getAddedLessons.mockResolvedValue([
      addedLesson("extra-1"),
      addedLesson("extra-2"),
    ]);
    mocks.getLessonOverrides.mockResolvedValue({
      "extra-1": { title: "Extra one" },
      "lesson-1": { title: "Renamed" },
    });

    const response = await DELETE(request({ id: "extra-1" }));

    expect(response.status).toBe(200);
    expect(await (response as Response).json()).toEqual({ ok: true });
    expect(mocks.saveAddedLessons).toHaveBeenCalledTimes(1);
    expect(
      (mocks.saveAddedLessons.mock.calls[0][0] as Array<{ id: string }>).map((l) => l.id)
    ).toEqual(["extra-2"]);
    // Its override entry goes with it; unrelated overrides stay.
    expect(mocks.saveLessonOverrides).toHaveBeenCalledTimes(1);
    expect(mocks.saveLessonOverrides.mock.calls[0][0]).toEqual({
      "lesson-1": { title: "Renamed" },
    });
  });

  it("404s an unknown id without writing anything", async () => {
    mocks.getAddedLessons.mockResolvedValue([addedLesson("extra-1")]);

    const response = await DELETE(request({ id: "ghost-lesson" }));

    expect(response.status).toBe(404);
    expect(mocks.saveAddedLessons).not.toHaveBeenCalled();
    expect(mocks.saveLessonOverrides).not.toHaveBeenCalled();
  });
});
