import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { closeDatabase, db } from "./client";
import {
  homeworkRubricReviews,
  homeworkSubmissions,
  journals,
  curriculumSections,
  lessons,
  members,
  notifications,
  notificationReceipts,
  securityMemberState,
} from "./schema";
import {
  createHomeworkSubmission,
  createJournalEntry,
  getLatestHomeworkState,
  incrementStrike,
  markNotificationReceived,
  reviewHomeworkSubmission,
} from "./transactions";

if (!process.env.DATABASE_URL_TEST && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}
process.env.DATABASE_USE_TEST_URL = "true";

const testId = randomUUID();
const primaryMemberId = randomUUID();
const secondaryMemberId = randomUUID();
const notificationId = `test-notification-${testId}`;
const sectionId = randomUUID();
const lessonId = `test-lesson-${testId}`;
const memberSuffix = testId.replaceAll("-", "").slice(0, 12);
const sectionPosition = (Number.parseInt(testId.slice(0, 8), 16) % 2_000_000_000) + 1;
let immutableSubmissionId = "";
let immutableReviewId = "";

describe.sequential("transaction services against the isolated verification database", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL_TEST) {
      throw new Error("DATABASE_URL_TEST is required for database integration tests");
    }

    await db.insert(members).values([
      { id: primaryMemberId, discordId: `test-primary-${memberSuffix}`, displayName: "Primary test member" },
      { id: secondaryMemberId, discordId: `test-secondary-${memberSuffix}`, displayName: "Secondary test member" },
    ]);
    await db.insert(curriculumSections).values({
      id: sectionId,
      slug: `test-section-${testId}`,
      title: "Test section",
      position: sectionPosition,
    });
    await db.insert(lessons).values({ id: lessonId, sectionId, title: "Test lesson", position: 999999 });
    await db.insert(notifications).values({ id: notificationId, notificationType: "test" });
  });

  afterAll(async () => {
    // Immutable homework records remain on the disposable verification branch.
    // Each run owns unique UUID/slug values, so teardown cannot weaken the append-only contract.
    await closeDatabase();
  });

  it("deduplicates concurrent notification receipts by member and notification", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => markNotificationReceived(primaryMemberId, notificationId))
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    const receipts = await db
      .select()
      .from(notificationReceipts)
      .where(
        and(
          eq(notificationReceipts.memberId, primaryMemberId),
          eq(notificationReceipts.notificationId, notificationId)
        )
      );
    expect(receipts).toHaveLength(1);
  });

  it("uses an atomic update for simultaneous strike increments and locks at the limit", async () => {
    const state = await Promise.all(
      Array.from({ length: 4 }, () => incrementStrike(primaryMemberId, { threshold: 3 }))
    );

    expect(state.map((entry) => entry.strikeCount).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    const [stored] = await db
      .select()
      .from(securityMemberState)
      .where(eq(securityMemberState.memberId, primaryMemberId));
    expect(stored.strikeCount).toBe(4);
    expect(stored.lockedAt).not.toBeNull();
  });

  it("keeps simultaneous journal writes isolated and durable", async () => {
    await Promise.all([
      createJournalEntry({ memberId: primaryMemberId, title: "One", body: "First concurrent entry" }),
      createJournalEntry({ memberId: primaryMemberId, title: "Two", body: "Second concurrent entry" }),
      createJournalEntry({ memberId: secondaryMemberId, title: "Private", body: "Other member entry" }),
    ]);

    const primaryEntries = await db.select().from(journals).where(eq(journals.memberId, primaryMemberId));
    const secondaryEntries = await db.select().from(journals).where(eq(journals.memberId, secondaryMemberId));
    expect(primaryEntries.map((entry) => entry.title).sort()).toEqual(["One", "Two"]);
    expect(secondaryEntries.map((entry) => entry.title)).toEqual(["Private"]);
  });

  it("keeps concurrent reviews attached to the original submission while resubmissions remain gap-free", async () => {
    const first = await createHomeworkSubmission({
      memberId: primaryMemberId,
      lessonId,
      storageKey: `test/${testId}/one.pdf`,
      fileName: "one.pdf",
    });
    const [originalReview, ...resubmissions] = await Promise.all([
      reviewHomeworkSubmission({
        memberId: primaryMemberId,
        submissionId: first.id,
        decision: "approved",
        feedback: "Meets the rubric",
      }),
      ...Array.from({ length: 4 }, (_, index) =>
        createHomeworkSubmission({
          memberId: primaryMemberId,
          lessonId: first.lessonId,
          storageKey: `test/${testId}/resubmission-${index + 2}.pdf`,
          fileName: `resubmission-${index + 2}.pdf`,
        })
      ),
    ]);

    expect(resubmissions.map((submission) => submission.version).sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
    const submissions = await db
      .select()
      .from(homeworkSubmissions)
      .where(and(eq(homeworkSubmissions.memberId, primaryMemberId), eq(homeworkSubmissions.lessonId, lessonId)))
      .orderBy(asc(homeworkSubmissions.version));
    expect(submissions.map((submission) => submission.version)).toEqual([1, 2, 3, 4, 5]);
    immutableSubmissionId = first.id;
    immutableReviewId = originalReview.id;
    const current = await getLatestHomeworkState(primaryMemberId, first.lessonId);
    expect(current?.submission.version).toBe(5);
    expect(current?.review).toBeNull();
    const [review] = await db
      .select()
      .from(homeworkRubricReviews)
      .where(eq(homeworkRubricReviews.submissionId, first.id));
    expect(review).toMatchObject({ id: originalReview.id, memberId: primaryMemberId, decision: "approved" });
  });

  it("rejects a review that names another member for an existing submission", async () => {
    await expect(
      reviewHomeworkSubmission({
        memberId: secondaryMemberId,
        submissionId: immutableSubmissionId,
        decision: "rejected",
        feedback: "Forged cross-member review",
      })
    ).rejects.toBeDefined();
  });

  it("rejects direct update and delete of stored homework submission and review versions", async () => {
    await expect(
      db
        .update(homeworkSubmissions)
        .set({ fileName: "mutated.pdf" })
        .where(eq(homeworkSubmissions.id, immutableSubmissionId))
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringMatching(/immutable/i) }),
    });
    await expect(
      db
        .update(homeworkRubricReviews)
        .set({ feedback: "mutated" })
        .where(eq(homeworkRubricReviews.id, immutableReviewId))
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringMatching(/immutable/i) }),
    });
    await expect(db.delete(homeworkRubricReviews).where(eq(homeworkRubricReviews.id, immutableReviewId))).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringMatching(/immutable/i) }),
    });
    await expect(db.delete(homeworkSubmissions).where(eq(homeworkSubmissions.id, immutableSubmissionId))).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringMatching(/immutable/i) }),
    });
  });
});
