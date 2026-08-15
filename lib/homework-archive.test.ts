import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildHomeworkArchive, decodeArchiveCursor, encodeArchiveCursor } from "@/lib/homework-archive";

describe("homework archive", () => {
  const submissions = [
    { id: "s1", memberId: "m1", lessonId: "core-1", lessonTitle: "Introduction", version: 1, storageKey: "dojo/homework/111/old.pdf", fileName: "old.pdf", submittedAt: new Date("2026-01-01T00:00:00Z") },
    { id: "s2", memberId: "m1", lessonId: "core-1", lessonTitle: "Introduction", version: 2, storageKey: "dojo/homework/111/new.pdf", fileName: "new.pdf", submittedAt: new Date("2026-02-01T00:00:00Z") },
    { id: "other", memberId: "m2", lessonId: "core-2", lessonTitle: "Other", version: 1, storageKey: "dojo/homework/222/private.pdf", fileName: "private.pdf", submittedAt: new Date("2026-03-01T00:00:00Z") },
  ];
  const reviews = [
    { submissionId: "s1", version: 1, decision: "revision_requested", feedback: "Add labels.", reviewedAt: new Date("2026-01-02T00:00:00Z") },
    { submissionId: "s1", version: 2, decision: "approved", feedback: "Good revision.", reviewedAt: new Date("2026-01-03T00:00:00Z") },
  ];

  it("returns only linked-member work newest first and keeps every immutable version", () => {
    const result = buildHomeworkArchive({ submissions, reviews, allowedMemberIds: new Set(["m1"]), availableStorageKeys: new Set(["dojo/homework/111/new.pdf"]) });
    expect(result.map((item) => [item.id, item.version])).toEqual([["s2", 2], ["s1", 1]]);
    expect(result.some((item) => item.id === "other")).toBe(false);
  });

  it("uses the latest review and exposes only authenticated proxy paths", () => {
    const [item] = buildHomeworkArchive({ submissions: [submissions[0]], reviews, allowedMemberIds: new Set(["m1"]), availableStorageKeys: new Set([submissions[0].storageKey]) });
    expect(item).toMatchObject({ status: "approved", feedback: "Good revision.", available: true });
    expect(item.previewUrl).toBe("/api/blob/dojo/homework/111/old.pdf?disposition=inline");
    expect(item.downloadUrl).toBe("/api/blob/dojo/homework/111/old.pdf?disposition=attachment");
    expect(JSON.stringify(item)).not.toContain("https://");
  });

  it("marks untracked or quarantined work unavailable", () => {
    const [item] = buildHomeworkArchive({ submissions: [submissions[0]], reviews: [], allowedMemberIds: new Set(["m1"]), availableStorageKeys: new Set() });
    expect(item).toMatchObject({ status: "pending", available: false, previewUrl: null, downloadUrl: null });
  });

  it("round-trips an opaque cursor and rejects tampering", () => {
    const cursor = encodeArchiveCursor({ submittedAt: "2026-01-01T00:00:00.000Z", id: "s1" });
    expect(cursor).not.toContain("2026-01-01");
    expect(decodeArchiveCursor(cursor)).toEqual({ submittedAt: "2026-01-01T00:00:00.000Z", id: "s1" });
    expect(() => decodeArchiveCursor("not-a-cursor")).toThrow("Invalid archive cursor");
  });
});
