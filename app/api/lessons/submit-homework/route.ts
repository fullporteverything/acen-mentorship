import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireMemberOrResponse } from "@/lib/authz";
import {
  buildEffectiveLessons,
  computeCurriculumStates,
  getLesson,
} from "@/lib/lessons-config";
import {
  getAddedLessons,
  getLessonOverrides,
  getSettings,
  getUserProgress,
  saveUserProgress,
  uploadHomework,
} from "@/lib/lesson-store";
import { autoPassedLessonIds } from "@/lib/progress-link";
import { validatePdf } from "@/lib/upload-validation";
import { consumeRateLimit } from "@/lib/rate-limit";
import { recordAuditEvent, recordBlobAuditSafely } from "@/lib/audit";
import { scanUpload } from "@/lib/malware-scan";
import { recordOrphanedUpload, recordUploadMetadata } from "@/lib/upload-tracking";
import { archiveHomeworkSubmission } from "@/lib/homework-archive";

export const dynamic = "force-dynamic";

const MAX_BYTES = 20 * 1024 * 1024; // 20MB

/** Student submits (or resubmits) homework for a lesson. */
export async function POST(req: NextRequest) {
  const identity = await requireMemberOrResponse();
  if (identity instanceof Response) return identity;
  const discordId = identity.discordId;
  const rate = await consumeRateLimit(discordId, "homework.submit", { limit: 10, windowMs: 60 * 60 * 1000 });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many homework submissions. Try again later." }, {
      status: 429,
      headers: { "Retry-After": String(Math.max(1, Math.ceil((rate.resetAt.getTime() - Date.now()) / 1000))) },
    });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim();
  await recordAuditEvent({
    action: "homework.submit.requested", resourceType: "homework_submission",
    actorDiscordId: discordId, memberDiscordId: discordId, ip,
  });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const lessonId = form.get("lessonId");
  const file = form.get("file");

  if (typeof lessonId !== "string") {
    return NextResponse.json({ error: "Unknown lesson" }, { status: 400 });
  }

  const [addedLessons, overrides, progress] = await Promise.all([
    getAddedLessons(),
    getLessonOverrides(),
    getUserProgress(discordId),
  ]);
  const lessons = buildEffectiveLessons(addedLessons, overrides);
  const lesson = getLesson(lessonId, lessons);
  if (!lesson) {
    return NextResponse.json({ error: "Unknown lesson" }, { status: 400 });
  }

  const isAdmin = identity.isAdmin;
  const completedLessonIds = autoPassedLessonIds(
    discordId,
    progress.completedLessons,
    lessons.map((item) => item.id)
  );
  const unlocked =
    computeCurriculumStates(completedLessonIds, lessons, isAdmin).stateById.get(
      lessonId
    )?.unlocked ?? false;
  if (!unlocked) {
    return NextResponse.json(
      { error: "Complete the required CORE lessons before submitting here." },
      { status: 403 }
    );
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  if (file.type !== "application/pdf") {
    return NextResponse.json(
      { error: "Only PDF files are accepted" },
      { status: 400 }
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "File is too large. Max 20MB." },
      { status: 400 }
    );
  }

  const pdf = await validatePdf(file);
  if (!pdf.valid) {
    return NextResponse.json({ error: "Uploaded file is not a valid PDF" }, { status: 400 });
  }

  // Upload the PDF to (private) blob storage. Returns the pathname, which is
  // stored on the submission and rendered through the /api/blob proxy.
  const blobPathname = await uploadHomework(
    discordId,
    lessonId,
    file.name || "homework.pdf",
    file
  );
  const scan = await scanUpload(blobPathname);
  try {
    await recordUploadMetadata(discordId, blobPathname, file, scan);
  } catch {
    await recordOrphanedUpload(discordId, blobPathname, file, "upload_metadata_failed").catch(() => undefined);
    return NextResponse.json({ error: "Upload metadata could not be saved; the file was quarantined for review." }, { status: 503 });
  }
  const settings = await getSettings();
  const status = settings.autoApprove ? "approved" : "pending";
  try {
    await archiveHomeworkSubmission({
      discordId,
      displayName: identity.name ?? undefined,
      lessonId,
      lessonTitle: lesson.title,
      lessonPosition: lessons.findIndex((item) => item.id === lessonId) + 1,
      storageKey: blobPathname,
      fileName: file.name || "homework.pdf",
      initialDecision: settings.autoApprove ? "approved" : undefined,
      initialFeedback: settings.autoApprove ? "Automatically approved" : undefined,
    });
  } catch {
    await recordOrphanedUpload(discordId, blobPathname, file, "homework_archive_failed").catch(() => undefined);
    return NextResponse.json({ error: "Your homework could not be archived. Please retry." }, { status: 503 });
  }

  // Record the submission on the user's progress.
  progress.discordUsername = identity.name || progress.discordUsername;

  progress.submissions[lessonId] = {
    blobUrl: blobPathname,
    fileName: file.name || "homework.pdf",
    submittedAt: new Date().toISOString(),
    status,
    feedback: "",
  };

  if (settings.autoApprove) {
    if (!progress.completedLessons.includes(lessonId)) {
      progress.completedLessons.push(lessonId);
    }
  } else {
    // A fresh submission is no longer "completed" until re-approved.
    progress.completedLessons = progress.completedLessons.filter(
      (id) => id !== lessonId
    );
  }

  try {
    await saveUserProgress(discordId, progress);
  } catch {
    await recordOrphanedUpload(discordId, blobPathname, file, "submission_metadata_failed").catch(() => undefined);
    throw new Error("Submission metadata failed after upload");
  }
  await recordBlobAuditSafely({ action: "homework.submit", resourceType: "lesson", resourceId: lessonId, actorDiscordId: discordId, memberDiscordId: discordId, ip, details: { blobPathname } });

  return NextResponse.json({ ok: true, status }, { status: 200 });
}
