import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdminOrResponse } from "@/lib/authz";
import { buildEffectiveLessons } from "@/lib/lessons-config";
import {
  getAddedLessons,
  getAllProgress,
  getLessonOverrides,
  getUserProgress,
  saveUserProgress,
} from "@/lib/lesson-store";

export const dynamic = "force-dynamic";


/** The effective curriculum (static + admin-added, overrides applied). */
async function effectiveLessons() {
  const [added, overrides] = await Promise.all([
    getAddedLessons(),
    getLessonOverrides(),
  ]);
  return buildEffectiveLessons(added, overrides);
}

/**
 * GET: every student with a progress record, plus the ordered lesson list the
 * admin can advance them through.
 */
export async function GET() {
  const admin = await requireAdminOrResponse(); if (admin instanceof Response) return admin;

  const [progressRows, lessons] = await Promise.all([
    getAllProgress(),
    effectiveLessons(),
  ]);

  const students = progressRows.map((row) => ({
    discordId: row.discordId,
    discordUsername: row.discordUsername,
    completedCount: row.completedLessons.length,
  }));

  return NextResponse.json({
    students,
    lessons: lessons.map((lesson, index) => ({
      id: lesson.id,
      title: lesson.title,
      order: index + 1,
    })),
  });
}

/**
 * POST: manually move a student's completions.
 *
 *   { discordId, throughLessonId } — mark every lesson from the first up to and
 *     INCLUDING `throughLessonId` complete, unioned with whatever they already
 *     had (so nothing is ever taken away).
 *   { discordId, reset: true }     — clear completedLessons entirely.
 *
 * Submissions are never touched either way.
 */
export async function POST(req: NextRequest) {
  const admin = await requireAdminOrResponse(); if (admin instanceof Response) return admin;

  let body: {
    discordId?: string;
    throughLessonId?: string;
    reset?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const discordId =
    typeof body.discordId === "string" ? body.discordId.trim() : "";
  if (!discordId) {
    return NextResponse.json(
      { error: "discordId must be a non-empty string" },
      { status: 400 }
    );
  }

  const progress = await getUserProgress(discordId);

  if (body.reset === true) {
    progress.completedLessons = [];
    await saveUserProgress(discordId, progress);
    return NextResponse.json({ ok: true, completedLessons: [] });
  }

  const throughLessonId =
    typeof body.throughLessonId === "string" ? body.throughLessonId.trim() : "";
  if (!throughLessonId) {
    return NextResponse.json(
      { error: "throughLessonId must be a non-empty string" },
      { status: 400 }
    );
  }

  const lessons = await effectiveLessons();
  const throughIndex = lessons.findIndex((l) => l.id === throughLessonId);
  if (throughIndex < 0) {
    return NextResponse.json(
      { error: "Unknown lesson: " + throughLessonId },
      { status: 400 }
    );
  }

  // Union: everything up to the chosen lesson, plus any completions they had.
  const completed = new Set(progress.completedLessons);
  for (const lesson of lessons.slice(0, throughIndex + 1)) {
    completed.add(lesson.id);
  }
  // Keep curriculum order, then append any ids no longer in the curriculum.
  const ordered = lessons.filter((l) => completed.has(l.id)).map((l) => l.id);
  const orphans = Array.from(completed).filter(
    (id) => !lessons.some((l) => l.id === id)
  );
  progress.completedLessons = [...ordered, ...orphans];

  await saveUserProgress(discordId, progress);

  return NextResponse.json({
    ok: true,
    completedLessons: progress.completedLessons,
  });
}
