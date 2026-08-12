import { and, desc, eq, sql } from "drizzle-orm";

import { db, dbTransaction } from "./client";
import {
  homeworkReviewCounters,
  homeworkRubricReviews,
  homeworkSubmissionCounters,
  homeworkSubmissions,
  journals,
  notificationReceipts,
  securityMemberState,
} from "./schema";

export async function markNotificationReceived(memberId: string, notificationId: string): Promise<boolean> {
  return dbTransaction(async (tx) => {
    const inserted = await tx
      .insert(notificationReceipts)
      .values({ memberId, notificationId })
      .onConflictDoNothing({
        target: [notificationReceipts.memberId, notificationReceipts.notificationId],
      })
      .returning({ id: notificationReceipts.id });
    return inserted.length === 1;
  });
}

export async function incrementStrike(
  memberId: string,
  options: { threshold?: number; lockReason?: string } = {}
): Promise<{ strikeCount: number; strikeLimit: number; lockedAt: Date | null }> {
  const threshold = options.threshold ?? 3;
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new Error("Strike threshold must be a positive integer");
  }

  return dbTransaction(async (tx) => {
    await tx
      .insert(securityMemberState)
      .values({ memberId, strikeLimit: threshold })
      .onConflictDoNothing({ target: securityMemberState.memberId });

    const [state] = await tx
      .update(securityMemberState)
      .set({
        strikeCount: sql<number>`${securityMemberState.strikeCount} + 1`,
        lockedAt: sql<Date | null>`CASE
          WHEN ${securityMemberState.strikeCount} + 1 >= ${securityMemberState.strikeLimit}
          THEN COALESCE(${securityMemberState.lockedAt}, now())
          ELSE ${securityMemberState.lockedAt}
        END`,
        lockReason: options.lockReason,
        updatedAt: sql<Date>`now()`,
      })
      .where(eq(securityMemberState.memberId, memberId))
      .returning({
        strikeCount: securityMemberState.strikeCount,
        strikeLimit: securityMemberState.strikeLimit,
        lockedAt: securityMemberState.lockedAt,
      });

    if (!state) throw new Error("Unable to increment member strike count");
    return state;
  });
}

export async function createJournalEntry(input: {
  memberId: string;
  title: string;
  body: string;
  mood?: string;
  tags?: string[];
}) {
  const [entry] = await db
    .insert(journals)
    .values({
      ...input,
      tags: input.tags ?? [],
    })
    .returning();
  return entry;
}

export async function createHomeworkSubmission(input: {
  memberId: string;
  lessonId: string;
  storageKey: string;
  fileName: string;
  contentType?: string;
}) {
  return dbTransaction(async (tx) => {
    const [counter] = await tx
      .insert(homeworkSubmissionCounters)
      .values({ memberId: input.memberId, lessonId: input.lessonId, nextVersion: 2 })
      .onConflictDoUpdate({
        target: [homeworkSubmissionCounters.memberId, homeworkSubmissionCounters.lessonId],
        set: {
          nextVersion: sql<number>`${homeworkSubmissionCounters.nextVersion} + 1`,
          updatedAt: sql<Date>`now()`,
        },
      })
      .returning({ nextVersion: homeworkSubmissionCounters.nextVersion });

    const [submission] = await tx
      .insert(homeworkSubmissions)
      .values({
        ...input,
        version: counter.nextVersion - 1,
        contentType: input.contentType ?? "application/pdf",
      })
      .returning();
    return submission;
  });
}

export async function reviewHomeworkSubmission(input: {
  memberId: string;
  submissionId: string;
  reviewerMemberId?: string;
  decision: "approved" | "rejected" | "revision_requested";
  feedback: string;
  rubric?: Record<string, unknown>;
}) {
  return dbTransaction(async (tx) => {
    const [counter] = await tx
      .insert(homeworkReviewCounters)
      .values({ submissionId: input.submissionId, nextVersion: 2 })
      .onConflictDoUpdate({
        target: homeworkReviewCounters.submissionId,
        set: {
          nextVersion: sql<number>`${homeworkReviewCounters.nextVersion} + 1`,
          updatedAt: sql<Date>`now()`,
        },
      })
      .returning({ nextVersion: homeworkReviewCounters.nextVersion });

    const [review] = await tx
      .insert(homeworkRubricReviews)
      .values({
        ...input,
        version: counter.nextVersion - 1,
        rubric: input.rubric ?? {},
      })
      .returning();
    return review;
  });
}

export async function getLatestHomeworkState(memberId: string, lessonId: string) {
  const [submission] = await db
    .select()
    .from(homeworkSubmissions)
    .where(and(eq(homeworkSubmissions.memberId, memberId), eq(homeworkSubmissions.lessonId, lessonId)))
    .orderBy(desc(homeworkSubmissions.version))
    .limit(1);

  if (!submission) return null;
  const [review] = await db
    .select()
    .from(homeworkRubricReviews)
    .where(eq(homeworkRubricReviews.submissionId, submission.id))
    .orderBy(desc(homeworkRubricReviews.version))
    .limit(1);

  return { submission, review: review ?? null };
}
