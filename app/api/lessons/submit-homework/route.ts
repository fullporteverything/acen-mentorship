import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
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

export const dynamic = "force-dynamic";

const MAX_BYTES = 20 * 1024 * 1024; // 20MB

/** Student submits (or resubmits) homework for a lesson. */
export async function POST(req: NextRequest) {
  const session = await auth();
  const discordId = session?.user?.discordId;

  if (!session?.user || !discordId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const isAdmin =
    !!process.env.ADMIN_DISCORD_ID &&
    discordId === process.env.ADMIN_DISCORD_ID;
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

  // Upload the PDF to (private) blob storage. Returns the pathname, which is
  // stored on the submission and rendered through the /api/blob proxy.
  const blobPathname = await uploadHomework(
    discordId,
    lessonId,
    file.name || "homework.pdf",
    file
  );

  // Record the submission on the user's progress.
  progress.discordUsername = session.user.name || progress.discordUsername;

  const settings = await getSettings();
  const status = settings.autoApprove ? "approved" : "pending";

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

  await saveUserProgress(discordId, progress);

  return NextResponse.json({ ok: true, status }, { status: 200 });
}
