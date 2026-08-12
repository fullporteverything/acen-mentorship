import { NextResponse } from "next/server";
import { requireMemberOrResponse } from "@/lib/authz";
import {
  buildEffectiveLessons,
  computeCurriculumStates,
  getLesson,
} from "@/lib/lessons-config";
import {
  getAddedLessons,
  getLessonOverrides,
  getUserProgress,
} from "@/lib/lesson-store";
import { autoPassedLessonIds } from "@/lib/progress-link";
import { normalizeWatchProgress } from "@/lib/watch-progress";
import {
  getWatchProgress,
  saveWatchProgress,
} from "@/lib/watch-progress-store";

export const dynamic = "force-dynamic";

async function authorizeLesson(discordId: string, lessonId: string, isAdmin: boolean) {
  const [addedLessons, overrides, progress] = await Promise.all([
    getAddedLessons(),
    getLessonOverrides(),
    getUserProgress(discordId),
  ]);
  const lessons = buildEffectiveLessons(addedLessons, overrides);
  if (!getLesson(lessonId, lessons)) return { exists: false, unlocked: false };
  const completedLessonIds = autoPassedLessonIds(
    discordId,
    progress.completedLessons,
    lessons.map((lesson) => lesson.id)
  );
  return {
    exists: true,
    unlocked:
      computeCurriculumStates(completedLessonIds, lessons, isAdmin).stateById.get(
        lessonId
      )?.unlocked ?? false,
  };
}

export async function GET(req: Request) {
  const identity = await requireMemberOrResponse();
  if (identity instanceof Response) return identity;
  const { discordId, isAdmin } = identity;
  const lessonId = new URL(req.url).searchParams.get("lessonId") || "";
  const access = await authorizeLesson(discordId, lessonId, isAdmin);
  if (!access.exists) {
    return NextResponse.json({ error: "Unknown lesson" }, { status: 400 });
  }
  if (!access.unlocked) {
    return NextResponse.json({ error: "Lesson locked" }, { status: 403 });
  }
  return NextResponse.json({
    progress: await getWatchProgress(discordId, lessonId),
  });
}

export async function POST(req: Request) {
  const identity = await requireMemberOrResponse();
  if (identity instanceof Response) return identity;
  const { discordId, isAdmin } = identity;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const lessonId = typeof body.lessonId === "string" ? body.lessonId : "";
  if (
    typeof body.currentTime !== "number" ||
    typeof body.duration !== "number" ||
    (body.ended !== undefined && typeof body.ended !== "boolean")
  ) {
    return NextResponse.json({ error: "Invalid progress" }, { status: 400 });
  }

  const access = await authorizeLesson(discordId, lessonId, isAdmin);
  if (!access.exists) {
    return NextResponse.json({ error: "Unknown lesson" }, { status: 400 });
  }
  if (!access.unlocked) {
    return NextResponse.json({ error: "Lesson locked" }, { status: 403 });
  }

  const progress = normalizeWatchProgress({
    currentTime: body.currentTime,
    duration: body.duration,
    ended: body.ended,
  });
  await saveWatchProgress(discordId, lessonId, progress);
  return NextResponse.json({ ok: true, progress });
}
