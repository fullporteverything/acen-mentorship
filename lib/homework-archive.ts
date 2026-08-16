import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { get, list } from "@vercel/blob";

import { db, dbTransaction } from "@/lib/db/client";
import {
  curriculumSections,
  homeworkReviewCounters,
  homeworkRubricReviews,
  homeworkSubmissionCounters,
  homeworkSubmissions,
  lessons,
  members,
  uploads,
} from "@/lib/db/schema";
import { createHomeworkSubmission, reviewHomeworkSubmission } from "@/lib/db/transactions";
import {
  getAddedLessons,
  getLessonOverrides,
  type UserProgress,
} from "@/lib/lesson-store";
import { buildEffectiveLessons, getLesson, type Lesson } from "@/lib/lessons-config";

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

/**
 * Position for a legacy lesson in the "homework-archive" section. Lessons still
 * in the curriculum reuse their curriculum index (matching the submit route), so
 * a backfilled row and a live submission for the same lesson never collide on
 * (section, position). Lessons no longer in the curriculum get a stable,
 * high position derived from their id so distinct ids stay unique.
 */
function legacyLessonPosition(lessonId: string, effective: Lesson[]): number {
  const index = effective.findIndex((lesson) => lesson.id === lessonId);
  if (index >= 0) return index + 1;
  let hash = 0;
  for (let i = 0; i < lessonId.length; i += 1) hash = (hash * 31 + lessonId.charCodeAt(i)) % 1_000_000;
  return 1_000_000 + hash;
}

function toDateOrNull(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Idempotent migration of Blob-only homework (written before the Neon archive
 * existed) into `homework_submissions`. Scans `dojo/progress/{discordId}.json`
 * and, for each submission not already present (matched by storageKey), recreates
 * its member, lesson, archive version, review, and a clean `uploads` row so the
 * file is viewable. Preserves each submission's original `submittedAt`. Safe to
 * run repeatedly — already-imported rows are skipped without touching counters.
 */
export async function backfillLegacyArchive(): Promise<{
  members: number;
  imported: number;
  skipped: number;
  failed: number;
}> {
  const storeId = process.env.BLOB_READ_WRITE_TOKEN_STORE_ID;
  const effective = buildEffectiveLessons(await getAddedLessons(), await getLessonOverrides());

  const [section] = await db
    .insert(curriculumSections)
    .values({ slug: "homework-archive", title: "Homework Archive", position: 1_000_000 })
    .onConflictDoUpdate({ target: curriculumSections.slug, set: { title: "Homework Archive", updatedAt: new Date() } })
    .returning({ id: curriculumSections.id });

  const { blobs } = await list({ prefix: "dojo/progress/", storeId });
  let memberCount = 0;
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const blob of blobs) {
    if (!blob.pathname.endsWith(".json")) continue;
    const discordId = blob.pathname.replace("dojo/progress/", "").replace(/\.json$/, "");
    if (!discordId) continue;

    let progress: UserProgress;
    try {
      const result = await get(blob.pathname, { access: "private", storeId, useCache: false });
      if (!result || result.statusCode !== 200 || !result.stream) continue;
      const text = await new Response(result.stream).text();
      if (!text) continue;
      progress = JSON.parse(text) as UserProgress;
    } catch {
      // Skip unreadable/corrupt progress blobs rather than failing the whole run.
      continue;
    }
    const submissions = progress.submissions ?? {};
    if (!Object.keys(submissions).length) continue;
    memberCount += 1;

    const [member] = await db
      .insert(members)
      .values({ discordId, displayName: progress.discordUsername })
      .onConflictDoUpdate({ target: members.discordId, set: { displayName: progress.discordUsername, updatedAt: new Date(), deletedAt: null } })
      .returning({ id: members.id });

    for (const [lessonId, submission] of Object.entries(submissions)) {
      try {
        // Idempotency: an already-imported submission keeps its storageKey, so a
        // matching row means this one is done — skip without allocating a version.
        const [existing] = await db
          .select({ id: homeworkSubmissions.id })
          .from(homeworkSubmissions)
          .where(eq(homeworkSubmissions.storageKey, submission.blobUrl))
          .limit(1);
        if (existing) {
          skipped += 1;
          continue;
        }

        const submittedAt = toDateOrNull(submission.submittedAt) ?? new Date(0);
        const lessonTitle = getLesson(lessonId, effective)?.title ?? lessonId;
        await db
          .insert(lessons)
          .values({ id: lessonId, sectionId: section.id, title: lessonTitle, position: legacyLessonPosition(lessonId, effective), published: true })
          .onConflictDoUpdate({ target: lessons.id, set: { title: lessonTitle, updatedAt: new Date() } });

        const outcome = await dbTransaction(async (tx) => {
          const [counter] = await tx
            .insert(homeworkSubmissionCounters)
            .values({ memberId: member.id, lessonId, nextVersion: 2 })
            .onConflictDoUpdate({
              target: [homeworkSubmissionCounters.memberId, homeworkSubmissionCounters.lessonId],
              set: { nextVersion: sql<number>`${homeworkSubmissionCounters.nextVersion} + 1`, updatedAt: sql<Date>`now()` },
            })
            .returning({ nextVersion: homeworkSubmissionCounters.nextVersion });

          const [inserted] = await tx
            .insert(homeworkSubmissions)
            .values({
              memberId: member.id,
              lessonId,
              version: counter.nextVersion - 1,
              storageKey: submission.blobUrl,
              fileName: submission.fileName,
              contentType: "application/pdf",
              submittedAt,
            })
            .onConflictDoNothing({ target: homeworkSubmissions.storageKey })
            .returning({ id: homeworkSubmissions.id });
          // Lost the race to another importer — treat as already present.
          if (!inserted) return "skipped" as const;

          if (submission.status === "approved" || submission.status === "rejected") {
            await tx.insert(homeworkReviewCounters).values({ submissionId: inserted.id, nextVersion: 2 });
            await tx.insert(homeworkRubricReviews).values({
              submissionId: inserted.id,
              memberId: member.id,
              version: 1,
              decision: submission.status,
              feedback: submission.feedback ?? "",
              reviewedAt: toDateOrNull(submission.reviewedAt) ?? new Date(),
            });
          }

          await tx
            .insert(uploads)
            .values({ memberId: member.id, storageKey: submission.blobUrl, fileName: submission.fileName, contentType: "application/pdf", byteSize: 0, status: "clean" })
            .onConflictDoNothing({ target: uploads.storageKey });
          return "imported" as const;
        });

        if (outcome === "imported") imported += 1;
        else skipped += 1;
      } catch {
        // One bad row must not abort the whole migration.
        failed += 1;
      }
    }
  }

  return { members: memberCount, imported, skipped, failed };
}
