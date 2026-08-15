import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Lesson } from "@/lib/lessons-config";
import { minimalPdf } from "@/test/fixtures/pdf";

const mocks = vi.hoisted(() => ({
  requireMemberOrResponse: vi.fn(),
  getAddedLessons: vi.fn(),
  getLessonOverrides: vi.fn(),
  getSettings: vi.fn(),
  getUserProgress: vi.fn(),
  saveUserProgress: vi.fn(),
  uploadHomework: vi.fn(),
  consumeRateLimit: vi.fn(),
  recordAuditEvent: vi.fn(),
  recordAuditIntent: vi.fn(),
  scanUpload: vi.fn(),
  recordUploadMetadata: vi.fn(),
  recordOrphanedUpload: vi.fn(),
  archiveHomeworkSubmission: vi.fn(),
  reviewArchivedHomework: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({ requireMemberOrResponse: mocks.requireMemberOrResponse }));
vi.mock("@/lib/lesson-store", () => ({
  getAddedLessons: mocks.getAddedLessons,
  getLessonOverrides: mocks.getLessonOverrides,
  getSettings: mocks.getSettings,
  getUserProgress: mocks.getUserProgress,
  saveUserProgress: mocks.saveUserProgress,
  uploadHomework: mocks.uploadHomework,
}));
vi.mock("@/lib/rate-limit", () => ({ consumeRateLimit: mocks.consumeRateLimit }));
vi.mock("@/lib/audit", () => ({
  recordBlobAuditSafely: mocks.recordAuditEvent,
  recordAuditEvent: mocks.recordAuditIntent,
}));
vi.mock("@/lib/malware-scan", () => ({ scanUpload: mocks.scanUpload }));
vi.mock("@/lib/upload-tracking", () => ({ recordUploadMetadata: mocks.recordUploadMetadata, recordOrphanedUpload: mocks.recordOrphanedUpload }));
vi.mock("@/lib/homework-archive", () => ({ archiveHomeworkSubmission: mocks.archiveHomeworkSubmission, reviewArchivedHomework: mocks.reviewArchivedHomework }));

import { POST } from "./route";

const addedLessons: Lesson[] = [
  {
    id: "lesson-4",
    title: "Inducements × POI",
    description: "CORE gate",
    homeworkPrompt: "Submit CORE homework.",
    videoId: "",
    group: "CORE CONTENT",
  },
  {
    id: "weekly-1",
    title: "Weekly Breakdown",
    description: "Supplemental lesson",
    homeworkPrompt: "Submit supplemental homework.",
    videoId: "",
    group: "PA BREAKDOWNS",
  },
];

function progress(completedLessons: string[] = []) {
  return {
    discordId: "student-1",
    discordUsername: "Student",
    completedLessons: [...completedLessons],
    submissions: {},
  };
}

function requestFor(lessonId: string): NextRequest {
  const form = new FormData();
  form.set("lessonId", lessonId);
  form.set(
    "file",
    new File([minimalPdf()], "homework.pdf", { type: "application/pdf" })
  );
  return new NextRequest("http://localhost/api/lessons/submit-homework", {
    method: "POST",
    body: form,
  });
}

describe("POST /api/lessons/submit-homework curriculum authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_DISCORD_ID;
    mocks.requireMemberOrResponse.mockResolvedValue({
      discordId: "student-1", isAdmin: false, name: "Student",
    });
    mocks.getAddedLessons.mockResolvedValue(addedLessons);
    mocks.getLessonOverrides.mockResolvedValue({});
    mocks.getSettings.mockResolvedValue({ autoApprove: false });
    mocks.uploadHomework.mockResolvedValue("homework/student-1/file.pdf");
    mocks.saveUserProgress.mockResolvedValue(undefined);
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: new Date(Date.now() + 60_000) });
    mocks.recordAuditEvent.mockResolvedValue(undefined);
    mocks.recordAuditIntent.mockResolvedValue(undefined);
    mocks.scanUpload.mockResolvedValue({ state: "unconfigured" });
    mocks.recordUploadMetadata.mockResolvedValue(undefined);
    mocks.recordOrphanedUpload.mockResolvedValue(undefined);
    mocks.archiveHomeworkSubmission.mockResolvedValue({ id: "archive-1", version: 1 });
    mocks.reviewArchivedHomework.mockResolvedValue(true);
  });

  it("rejects a locked CORE lesson before upload or progress mutation", async () => {
    mocks.getUserProgress.mockResolvedValue(progress());

    const response = await POST(requestFor("lesson-2"));

    expect(response.status).toBe(403);
    expect(mocks.uploadHomework).not.toHaveBeenCalled();
    expect(mocks.saveUserProgress).not.toHaveBeenCalled();
  });

  it("rejects a locked added supplemental lesson before mutation", async () => {
    mocks.getUserProgress.mockResolvedValue(
      progress(["lesson-1", "lesson-2", "lesson-3"])
    );

    const response = await POST(requestFor("weekly-1"));

    expect(response.status).toBe(403);
    expect(mocks.uploadHomework).not.toHaveBeenCalled();
    expect(mocks.saveUserProgress).not.toHaveBeenCalled();
  });

  it("accepts an added supplemental lesson after CORE Lecture 04", async () => {
    mocks.getUserProgress.mockResolvedValue(
      progress(["lesson-1", "lesson-2", "lesson-3", "lesson-4"])
    );

    const response = await POST(requestFor("weekly-1"));

    expect(response.status).toBe(200);
    expect(mocks.uploadHomework).toHaveBeenCalledOnce();
    expect(mocks.archiveHomeworkSubmission).toHaveBeenCalledWith(expect.objectContaining({
      discordId: "student-1",
      lessonId: "weekly-1",
      lessonTitle: "Weekly Breakdown",
      storageKey: "homework/student-1/file.pdf",
      fileName: "homework.pdf",
    }));
    expect(mocks.saveUserProgress).toHaveBeenCalledOnce();
  });

  it("preserves the admin bypass at the mutation boundary", async () => {
    mocks.requireMemberOrResponse.mockResolvedValue({
      discordId: "student-1", isAdmin: true, name: "Student",
    });
    mocks.getUserProgress.mockResolvedValue(progress());

    const response = await POST(requestFor("weekly-1"));

    expect(response.status).toBe(200);
    expect(mocks.uploadHomework).toHaveBeenCalledOnce();
    expect(mocks.saveUserProgress).toHaveBeenCalledOnce();
  });

  it("creates an auto-approved submission and its initial review in one archive operation", async () => {
    mocks.getUserProgress.mockResolvedValue(progress(["lesson-1", "lesson-2", "lesson-3", "lesson-4"]));
    mocks.getSettings.mockResolvedValue({ autoApprove: true });
    const response = await POST(requestFor("weekly-1"));
    expect(response.status).toBe(200);
    expect(mocks.archiveHomeworkSubmission).toHaveBeenCalledWith(expect.objectContaining({
      initialDecision: "approved",
      initialFeedback: "Automatically approved",
    }));
    expect(mocks.reviewArchivedHomework).not.toHaveBeenCalled();
  });

  it("records a durable intent before uploading homework", async () => {
    mocks.getUserProgress.mockResolvedValue(progress(["lesson-1", "lesson-2", "lesson-3", "lesson-4"]));
    await POST(requestFor("weekly-1"));
    expect(mocks.recordAuditIntent).toHaveBeenCalledWith(expect.objectContaining({ action: "homework.submit.requested" }));
    expect(mocks.recordAuditIntent.mock.invocationCallOrder[0]).toBeLessThan(mocks.uploadHomework.mock.invocationCallOrder[0]);
  });

  it("rejects a rate-limited submission before it reads or uploads content", async () => {
    mocks.consumeRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: new Date(Date.now() + 60_000) });
    const response = await POST(requestFor("weekly-1"));
    expect(response.status).toBe(429);
    expect(mocks.uploadHomework).not.toHaveBeenCalled();
  });
});
