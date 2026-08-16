import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireMemberOrResponse: vi.fn(),
  getAnnouncements: vi.fn(),
  getSeenNotifications: vi.fn(),
  getViewerProgress: vi.fn(),
  markNotificationsSeen: vi.fn(),
  getJournal: vi.fn(),
  getSecurityMember: vi.fn(),
  getAddedLessons: vi.fn(),
  getLessonOverrides: vi.fn(),
  consumeRateLimit: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({ requireMemberOrResponse: mocks.requireMemberOrResponse }));
vi.mock("@/lib/mutation-security", () => ({ allowMutation: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/rate-limit", () => ({ consumeRateLimit: mocks.consumeRateLimit }));
vi.mock("@/lib/lesson-store", () => ({
  getAnnouncements: mocks.getAnnouncements,
  getSeenNotifications: mocks.getSeenNotifications,
  getViewerProgress: mocks.getViewerProgress,
  markNotificationsSeen: mocks.markNotificationsSeen,
  getAddedLessons: mocks.getAddedLessons,
  getLessonOverrides: mocks.getLessonOverrides,
}));
vi.mock("@/lib/journal-store", () => ({ getJournal: mocks.getJournal }));
vi.mock("@/lib/security-store", () => ({
  getSecurityMember: mocks.getSecurityMember,
}));

import { GET, POST } from "./route";

/** A zero-strike record — getSecurityMember always resolves to the caller's own. */
const noStrikes = { discordId: "student-1", strikes: 0, locked: false, updatedAt: "2026-01-01" };

describe("GET /api/notifications privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireMemberOrResponse.mockResolvedValue({ discordId: "student-1" });
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true, remaining: 1, resetAt: new Date() });
    mocks.getSecurityMember.mockResolvedValue(noStrikes);
    mocks.getAnnouncements.mockResolvedValue([]);
    mocks.getSeenNotifications.mockResolvedValue([]);
    mocks.getViewerProgress.mockResolvedValue({
      completedLessons: [],
      submissions: {},
    });
    mocks.getJournal.mockResolvedValue([]);
    mocks.getAddedLessons.mockResolvedValue([
      {
        id: "core-01",
        title: "Risk First",
        description: "",
        videoId: "",
        homeworkPrompt: "",
        group: "CORE CONTENT",
      },
    ]);
    mocks.getLessonOverrides.mockResolvedValue({});
  });

  it("loads only the authenticated member and hides zero-strike notices", async () => {
    mocks.getSecurityMember.mockResolvedValue({
      discordId: "student-1",
      strikes: 0,
      locked: false,
      updatedAt: "2026-01-01",
    });

    const response = await GET();
    const data = await response.json();

    expect(mocks.getSecurityMember).toHaveBeenCalledWith("student-1");
    expect(mocks.getViewerProgress).toHaveBeenCalledWith("student-1");
    expect(mocks.getJournal).toHaveBeenCalledWith("student-1");
    expect(data.items).toEqual([]);
  });

  it("shows a strike only after the authenticated member has one", async () => {
    mocks.getSecurityMember.mockResolvedValue({
      discordId: "student-1",
      strikes: 1,
      locked: false,
      updatedAt: "2026-01-03",
    });

    const data = await (await GET()).json();

    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({ type: "security", unread: true });
  });

  it("uses reviewedAt to create a fresh homework notification", async () => {
    mocks.getSecurityMember.mockResolvedValue(noStrikes);
    mocks.getViewerProgress.mockResolvedValue({
      completedLessons: [],
      submissions: {
        "core-01": {
          status: "approved",
          submittedAt: "2026-01-01T00:00:00.000Z",
          reviewedAt: "2026-01-03T00:00:00.000Z",
          feedback: "Nice work.",
        },
      },
    });

    const data = await (await GET()).json();

    expect(data.items[0]).toMatchObject({
      id: "homework:core-01:2026-01-03T00:00:00.000Z:approved",
      createdAt: "2026-01-03T00:00:00.000Z",
      title: "Homework approved",
    });
  });

  it("names the lesson and says 'needs revision' instead of 'rejected'", async () => {
    mocks.getSecurityMember.mockResolvedValue(noStrikes);
    mocks.getViewerProgress.mockResolvedValue({
      completedLessons: [],
      submissions: {
        "core-01": {
          status: "rejected",
          submittedAt: "2026-01-01T00:00:00.000Z",
          reviewedAt: "2026-01-04T00:00:00.000Z",
          feedback: "",
        },
      },
    });

    const data = await (await GET()).json();

    expect(data.items[0]).toMatchObject({
      title: "Homework needs revision",
      body: "Risk First needs revision.",
    });
  });

  it("marks receipts only for the authenticated Discord account", async () => {
    mocks.markNotificationsSeen.mockResolvedValue(undefined);

    const response = await POST(
      new Request("http://localhost/api/notifications", {
        method: "POST",
        body: JSON.stringify({
          discordId: "other-user",
          ids: ["announcement:a", "homework:b"],
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.markNotificationsSeen).toHaveBeenCalledWith("student-1", [
      "announcement:a",
      "homework:b",
    ]);
  });

  it("preserves temporary Discord verification failures as 503 responses", async () => {
    mocks.requireMemberOrResponse.mockResolvedValue(
      new Response(JSON.stringify({ error: "Membership verification is temporarily unavailable" }), { status: 503 })
    );

    expect((await GET()).status).toBe(503);
  });

  it("throttles reads per member and never fans out to blob reads when tripped", async () => {
    mocks.consumeRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: new Date() });

    const response = await GET();

    expect(response.status).toBe(429);
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      "student-1",
      "notifications.read",
      { limit: 60, windowMs: 60 * 1000 }
    );
    expect(mocks.getSecurityMember).not.toHaveBeenCalled();
  });

  it("rejects oversized receipt payloads with a 413", async () => {
    const response = await POST(
      new Request("http://localhost/api/notifications", {
        method: "POST",
        headers: { "content-length": String(4 * 1024 + 1) },
        body: JSON.stringify({ ids: ["announcement:a"] }),
      })
    );

    expect(response.status).toBe(413);
    expect(mocks.markNotificationsSeen).not.toHaveBeenCalled();
  });
});
