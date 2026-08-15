import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminOrResponse: vi.fn(),
  getAddedLessons: vi.fn(),
  saveAddedLessons: vi.fn(),
  getAddedSections: vi.fn(),
  saveAddedSections: vi.fn(),
  getLessonOverrides: vi.fn(),
  saveLessonOverrides: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({ requireAdminOrResponse: mocks.requireAdminOrResponse }));
vi.mock("@/lib/mutation-security", () => ({ allowMutation: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/lesson-store", () => ({
  getAddedLessons: mocks.getAddedLessons,
  saveAddedLessons: mocks.saveAddedLessons,
  getAddedSections: mocks.getAddedSections,
  saveAddedSections: mocks.saveAddedSections,
  getLessonOverrides: mocks.getLessonOverrides,
  saveLessonOverrides: mocks.saveLessonOverrides,
}));

import { DELETE } from "./route";

// Static curriculum ships lesson-1..lesson-3 in CORE CONTENT.
const CORE_IDS = ["lesson-1", "lesson-2", "lesson-3"];

function addedLesson(id: string, group: string) {
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
  return new Request("http://localhost/api/admin/section", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

function noSaves() {
  expect(mocks.saveLessonOverrides).not.toHaveBeenCalled();
  expect(mocks.saveAddedLessons).not.toHaveBeenCalled();
  expect(mocks.saveAddedSections).not.toHaveBeenCalled();
}

describe("DELETE /api/admin/section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminOrResponse.mockResolvedValue({ discordId: "admin-1", isAdmin: true });
    mocks.getAddedLessons.mockResolvedValue([]);
    mocks.saveAddedLessons.mockResolvedValue(undefined);
    mocks.getAddedSections.mockResolvedValue([]);
    mocks.saveAddedSections.mockResolvedValue(undefined);
    mocks.getLessonOverrides.mockResolvedValue({});
    mocks.saveLessonOverrides.mockResolvedValue(undefined);
  });

  it("passes through the non-admin response without saving", async () => {
    mocks.requireAdminOrResponse.mockResolvedValue(new Response(null, { status: 403 }));
    const response = await DELETE(request({ section: "CORE CONTENT", force: true }));
    expect(response.status).toBe(403);
    noSaves();
  });

  it("requires a section name", async () => {
    const response = await DELETE(request({ section: "   " }));
    expect(response.status).toBe(400);
    noSaves();
  });

  it("refuses a populated section without force and writes nothing", async () => {
    mocks.getAddedLessons.mockResolvedValue([addedLesson("extra-1", "CORE CONTENT")]);

    const response = await DELETE(request({ section: "CORE CONTENT" }));

    expect(response.status).toBe(409);
    // Three static CORE lessons + one admin-added lesson.
    expect(await (response as Response).json()).toEqual({
      error: "Section has 4 lessons — confirm deletion.",
      requiresForce: true,
      lessonCount: 4,
    });
    noSaves();
  });

  it("does not count already-hidden built-ins toward the force prompt", async () => {
    mocks.getLessonOverrides.mockResolvedValue({
      "lesson-1": { hidden: true },
      "lesson-2": { hidden: true },
    });

    const response = await DELETE(request({ section: "CORE CONTENT" }));

    expect(response.status).toBe(409);
    expect(await (response as Response).json()).toMatchObject({
      error: "Section has 1 lesson — confirm deletion.",
      lessonCount: 1,
    });
    noSaves();
  });

  it("force-deletes CORE CONTENT by hiding every static lesson in one write", async () => {
    mocks.getLessonOverrides.mockResolvedValue({ "lesson-2": { title: "Renamed" } });

    const response = await DELETE(request({ section: "CORE CONTENT", force: true }));

    expect(response.status).toBe(200);
    expect(await (response as Response).json()).toEqual({ ok: true });
    expect(mocks.saveLessonOverrides).toHaveBeenCalledTimes(1);
    const saved = mocks.saveLessonOverrides.mock.calls[0][0] as Record<
      string,
      { hidden?: boolean; title?: string }
    >;
    for (const id of CORE_IDS) {
      expect(saved[id]?.hidden).toBe(true);
    }
    // Existing override fields survive the hide.
    expect(saved["lesson-2"].title).toBe("Renamed");
    // No admin-added lessons in the section, and no added-section entry.
    expect(mocks.saveAddedLessons).not.toHaveBeenCalled();
    expect(mocks.saveAddedSections).not.toHaveBeenCalled();
  });

  it("matches section membership on a normalized group name", async () => {
    mocks.getAddedLessons.mockResolvedValue([addedLesson("extra-1", "core content")]);

    const response = await DELETE(request({ section: " core   content ", force: true }));

    expect(response.status).toBe(200);
    const saved = mocks.saveLessonOverrides.mock.calls[0][0] as Record<
      string,
      { hidden?: boolean }
    >;
    for (const id of CORE_IDS) {
      expect(saved[id]?.hidden).toBe(true);
    }
    expect(mocks.saveAddedLessons).toHaveBeenCalledTimes(1);
    expect(mocks.saveAddedLessons.mock.calls[0][0]).toEqual([]);
  });

  it("force-deletes a purely admin-added section: lessons, overrides and the entry", async () => {
    mocks.getAddedLessons.mockResolvedValue([
      addedLesson("extra-1", "PA BREAKDOWNS"),
      addedLesson("extra-2", "PA BREAKDOWNS"),
      addedLesson("bonus-1", "BONUS"),
    ]);
    mocks.getAddedSections.mockResolvedValue(["PA BREAKDOWNS", "BONUS"]);
    mocks.getLessonOverrides.mockResolvedValue({
      "extra-1": { title: "Extra one" },
      "lesson-1": { title: "Renamed" },
    });

    const response = await DELETE(request({ section: "PA BREAKDOWNS", force: true }));

    expect(response.status).toBe(200);
    expect(mocks.saveAddedLessons).toHaveBeenCalledTimes(1);
    expect(
      (mocks.saveAddedLessons.mock.calls[0][0] as Array<{ id: string }>).map((l) => l.id)
    ).toEqual(["bonus-1"]);
    // The deleted lessons' overrides go with them; nothing static is hidden.
    expect(mocks.saveLessonOverrides).toHaveBeenCalledTimes(1);
    expect(mocks.saveLessonOverrides.mock.calls[0][0]).toEqual({
      "lesson-1": { title: "Renamed" },
    });
    expect(mocks.saveAddedSections).toHaveBeenCalledTimes(1);
    expect(mocks.saveAddedSections.mock.calls[0][0]).toEqual(["BONUS"]);
  });

  it("deletes an empty admin section without force and without touching lessons", async () => {
    mocks.getAddedSections.mockResolvedValue(["EMPTY SECTION"]);

    const response = await DELETE(request({ section: "EMPTY SECTION" }));

    expect(response.status).toBe(200);
    expect(mocks.saveAddedSections).toHaveBeenCalledWith([]);
    expect(mocks.saveAddedLessons).not.toHaveBeenCalled();
    expect(mocks.saveLessonOverrides).not.toHaveBeenCalled();
  });
});
