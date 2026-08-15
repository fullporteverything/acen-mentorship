import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  curriculumSections,
  homeworkRubricReviews,
  homeworkSubmissions,
  lessons,
  members,
  uploads,
} from "@/lib/db/schema";
import { createHomeworkSubmission, reviewHomeworkSubmission } from "@/lib/db/transactions";

type SubmissionSource = {
  id: string;
  memberId: string;
  lessonId: string;
  lessonTitle: string;
  version: number;
  storageKey: string;
  fileName: string;
  submittedAt: Date;
};

type ReviewSource = {
  submissionId: string;
  version: number;
  decision: string;
  feedback: string;
  reviewedAt: Date;
};

export type HomeworkArchiveStatus = "pending" | "approved" | "rejected" | "revision_requested";

export type HomeworkArchiveItem = {
  id: string;
  lessonId: string;
  lessonTitle: string;
  version: number;
  fileName: string;
  submittedAt: string;
  status: HomeworkArchiveStatus;
  feedback: string;
  available: boolean;
  previewUrl: string | null;
  downloadUrl: string | null;
};

export type HomeworkArchivePage = {
  items: HomeworkArchiveItem[];
  nextCursor: string | null;
  total: number;
  lessons: Array<{ id: string; title: string }>;
};

type ArchiveCursor = { submittedAt: string; id: string };

export function encodeArchiveCursor(cursor: ArchiveCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeArchiveCursor(cursor: string): ArchiveCursor {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<ArchiveCursor>;
    if (!value.id || !value.submittedAt || Number.isNaN(Date.parse(value.submittedAt))) throw new Error();
    return { id: value.id, submittedAt: new Date(value.submittedAt).toISOString() };
  } catch {
    throw new Error("Invalid archive cursor");
  }
}

function proxyPath(storageKey: string, disposition: "inline" | "attachment"): string {
  const safePath = storageKey.split("/").map(encodeURIComponent).join("/");
  return `/api/blob/${safePath}?disposition=${disposition}`;
}

export function buildHomeworkArchive(input: {
  submissions: SubmissionSource[];
  reviews: ReviewSource[];
  allowedMemberIds: Set<string>;
  availableStorageKeys: Set<string>;
}): HomeworkArchiveItem[] {
  const latestReview = new Map<string, ReviewSource>();
  for (const review of input.reviews) {
    const current = latestReview.get(review.submissionId);
    if (!current || review.version > current.version) latestReview.set(review.submissionId, review);
  }

  return input.submissions
    .filter((submission) => input.allowedMemberIds.has(submission.memberId))
    .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime() || b.id.localeCompare(a.id))
    .map((submission) => {
      const review = latestReview.get(submission.id);
      const available = input.availableStorageKeys.has(submission.storageKey);
      return {
        id: submission.id,
        lessonId: submission.lessonId,
        lessonTitle: submission.lessonTitle,
        version: submission.version,
        fileName: submission.fileName,
        submittedAt: submission.submittedAt.toISOString(),
        status: (review?.decision ?? "pending") as HomeworkArchiveStatus,
        feedback: review?.feedback ?? "",
        available,
        previewUrl: available ? proxyPath(submission.storageKey, "inline") : null,
        downloadUrl: available ? proxyPath(submission.storageKey, "attachment") : null,
      };
    });
}

export async function listHomeworkArchive(input: {
  discordIds: string[];
  cursor?: string;
  limit?: number;
  lessonId?: string;
  status?: HomeworkArchiveStatus;
}): Promise<HomeworkArchivePage> {
  const limit = Math.max(1, Math.min(input.limit ?? 25, 100));
  const memberRows = input.discordIds.length
    ? await db.select({ id: members.id }).from(members).where(and(inArray(members.discordId, input.discordIds), isNull(members.deletedAt)))
    : [];
  const memberIds = memberRows.map((member) => member.id);
  if (!memberIds.length) return { items: [], nextCursor: null, total: 0, lessons: [] };

  const cursor = input.cursor ? decodeArchiveCursor(input.cursor) : undefined;
  const cursorDate = cursor ? new Date(cursor.submittedAt) : undefined;
  const latestReviewVersion = sql<number>`(
    select max(hr2.version) from homework_rubric_reviews hr2
    where hr2.submission_id = ${homeworkSubmissions.id}
  )`;
  const reviewStatus = input.status === "pending"
    ? isNull(homeworkRubricReviews.id)
    : input.status
      ? eq(homeworkRubricReviews.decision, input.status)
      : undefined;

  const submissionRows = await db
    .select({
      id: homeworkSubmissions.id,
      memberId: homeworkSubmissions.memberId,
      lessonId: homeworkSubmissions.lessonId,
      lessonTitle: lessons.title,
      version: homeworkSubmissions.version,
      storageKey: homeworkSubmissions.storageKey,
      fileName: homeworkSubmissions.fileName,
      submittedAt: homeworkSubmissions.submittedAt,
      reviewVersion: homeworkRubricReviews.version,
      decision: homeworkRubricReviews.decision,
      feedback: homeworkRubricReviews.feedback,
      reviewedAt: homeworkRubricReviews.reviewedAt,
      availableUploadId: uploads.id,
    })
    .from(homeworkSubmissions)
    .innerJoin(lessons, eq(homeworkSubmissions.lessonId, lessons.id))
    .leftJoin(homeworkRubricReviews, and(
      eq(homeworkRubricReviews.submissionId, homeworkSubmissions.id),
      eq(homeworkRubricReviews.version, latestReviewVersion)
    ))
    .leftJoin(uploads, and(
      eq(uploads.storageKey, homeworkSubmissions.storageKey),
      eq(uploads.memberId, homeworkSubmissions.memberId),
      eq(uploads.status, "clean")
    ))
    .where(and(
      inArray(homeworkSubmissions.memberId, memberIds),
      input.lessonId ? eq(homeworkSubmissions.lessonId, input.lessonId) : undefined,
      reviewStatus,
      cursor && cursorDate ? or(
        lt(homeworkSubmissions.submittedAt, cursorDate),
        and(eq(homeworkSubmissions.submittedAt, cursorDate), lt(homeworkSubmissions.id, cursor.id))
      ) : undefined
    ))
    .orderBy(desc(homeworkSubmissions.submittedAt), desc(homeworkSubmissions.id))
    .limit(limit + 1);
  const lessonRows = await db
    .selectDistinct({ id: lessons.id, title: lessons.title })
    .from(homeworkSubmissions)
    .innerJoin(lessons, eq(homeworkSubmissions.lessonId, lessons.id))
    .where(inArray(homeworkSubmissions.memberId, memberIds))
    .orderBy(lessons.title);
  const items = buildHomeworkArchive({
    submissions: submissionRows,
    reviews: submissionRows.flatMap((row) => row.reviewVersion ? [{
      submissionId: row.id,
      version: row.reviewVersion,
      decision: row.decision!,
      feedback: row.feedback ?? "",
      reviewedAt: row.reviewedAt!,
    }] : []),
    allowedMemberIds: new Set(memberIds),
    availableStorageKeys: new Set(submissionRows.filter((row) => row.availableUploadId).map((row) => row.storageKey)),
  });
  const pageItems = items.slice(0, limit);
  const last = pageItems.at(-1);
  return {
    items: pageItems,
    total: pageItems.length,
    lessons: lessonRows,
    nextCursor: items.length > limit && last ? encodeArchiveCursor({ submittedAt: last.submittedAt, id: last.id }) : null,
  };
}

/** Ensures every successful new submission receives an immutable archive version. */
export async function archiveHomeworkSubmission(input: {
  discordId: string;
  displayName?: string;
  lessonId: string;
  lessonTitle: string;
  lessonPosition: number;
  storageKey: string;
  fileName: string;
  initialDecision?: "approved" | "rejected" | "revision_requested";
  initialFeedback?: string;
}): Promise<{ id: string; version: number }> {
  const [section] = await db
    .insert(curriculumSections)
    .values({ slug: "homework-archive", title: "Homework Archive", position: 1_000_000 })
    .onConflictDoUpdate({ target: curriculumSections.slug, set: { title: "Homework Archive", updatedAt: new Date() } })
    .returning({ id: curriculumSections.id });
  const [member] = await db
    .insert(members)
    .values({ discordId: input.discordId, displayName: input.displayName })
    .onConflictDoUpdate({ target: members.discordId, set: { displayName: input.displayName, updatedAt: new Date(), deletedAt: null } })
    .returning({ id: members.id });
  await db
    .insert(lessons)
    .values({ id: input.lessonId, sectionId: section.id, title: input.lessonTitle, position: input.lessonPosition, published: true })
    .onConflictDoUpdate({ target: lessons.id, set: { title: input.lessonTitle, updatedAt: new Date() } });
  const submission = await createHomeworkSubmission({
    memberId: member.id,
    lessonId: input.lessonId,
    storageKey: input.storageKey,
    fileName: input.fileName,
    contentType: "application/pdf",
    initialReview: input.initialDecision ? {
      reviewerMemberId: member.id,
      decision: input.initialDecision,
      feedback: input.initialFeedback ?? "",
    } : undefined,
  });
  return { id: submission.id, version: submission.version };
}

export async function reviewArchivedHomework(input: {
  storageKey: string;
  targetDiscordIds: string[];
  reviewerDiscordId: string;
  reviewerName?: string;
  decision: "approved" | "rejected" | "revision_requested";
  feedback: string;
}): Promise<boolean> {
  const targetMembers = await db.select({ id: members.id }).from(members).where(inArray(members.discordId, input.targetDiscordIds));
  const targetIds = targetMembers.map((member) => member.id);
  if (!targetIds.length) return false;
  const [submission] = await db
    .select({ id: homeworkSubmissions.id, memberId: homeworkSubmissions.memberId })
    .from(homeworkSubmissions)
    .where(and(eq(homeworkSubmissions.storageKey, input.storageKey), inArray(homeworkSubmissions.memberId, targetIds)))
    .limit(1);
  if (!submission) return false;
  const [latest] = await db
    .select({ decision: homeworkRubricReviews.decision, feedback: homeworkRubricReviews.feedback })
    .from(homeworkRubricReviews)
    .where(eq(homeworkRubricReviews.submissionId, submission.id))
    .orderBy(desc(homeworkRubricReviews.version))
    .limit(1);
  if (latest?.decision === input.decision && latest.feedback === input.feedback) return true;
  const [reviewer] = await db
    .insert(members)
    .values({ discordId: input.reviewerDiscordId, displayName: input.reviewerName })
    .onConflictDoUpdate({ target: members.discordId, set: { displayName: input.reviewerName, updatedAt: new Date(), deletedAt: null } })
    .returning({ id: members.id });
  await reviewHomeworkSubmission({
    submissionId: submission.id,
    memberId: submission.memberId,
    reviewerMemberId: reviewer.id,
    decision: input.decision,
    feedback: input.feedback,
    rubric: {},
  });
  return true;
}
