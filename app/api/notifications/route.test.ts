import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireMemberOrResponse: vi.fn(),
  getAnnouncements: vi.fn(),
  getSeenNotifications: vi.fn(),
  getViewerProgress: vi.fn(),
  markNotificationsSeen: vi.fn(),
  getJournal: vi.fn(),
  getSecurityMembers: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({ requireMemberOrResponse: mocks.requireMemberOrResponse }));
vi.mock("@/lib/lesson-store", () => ({
  getAnnouncements: mocks.getAnnouncements,
  getSeenNotifications: mocks.getSeenNotifications,
  getViewerProgress: mocks.getViewerProgress,
  markNotificationsSeen: mocks.markNotificationsSeen,
}));
vi.mock("@/lib/journal-store", () => ({ getJournal: mocks.getJournal }));
vi.mock("@/lib/security-store", () => ({
  getSecurityMembers: mocks.getSecurityMembers,
}));

import { GET, POST } from "./route";

describe("GET /api/notifications privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireMemberOrResponse.mockResolvedValue({ discordId: "student-1" });
    mocks.getAnnouncements.mockResolvedValue([]);
    mocks.getSeenNotifications.mockResolvedValue([]);
    mocks.getViewerProgress.mockResolvedValue({
      completedLessons: [],
      submissions: {},
    });
    mocks.getJournal.mockResolvedValue([]);
  });

  it("loads only the authenticated member and hides zero-strike notices", async () => {
    mocks.getSecurityMembers.mockResolvedValue([
      { discordId: "student-1", strikes: 0, locked: false, updatedAt: "2026-01-01" },
      { discordId: "other", strikes: 2, locked: false, updatedAt: "2026-01-02" },
    ]);

    const response = await GET();
    const data = await response.json();

    expect(mocks.getViewerProgress).toHaveBeenCalledWith("student-1");
    expect(mocks.getJournal).toHaveBeenCalledWith("student-1");
    expect(data.items).toEqual([]);
  });

  it("shows a strike only after the authenticated member has one", async () => {
    mocks.getSecurityMembers.mockResolvedValue([
      { discordId: "student-1", strikes: 1, locked: false, updatedAt: "2026-01-03" },
    ]);

    const data = await (await GET()).json();

    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({ type: "security", unread: true });
  });

  it("uses reviewedAt to create a fresh homework notification", async () => {
    mocks.getSecurityMembers.mockResolvedValue([]);
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
});
