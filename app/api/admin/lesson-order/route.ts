import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdminOrResponse } from "@/lib/authz";
import { allowMutation } from "@/lib/mutation-security";
import {
  getAddedLessons,
  getLessonOverrides,
  saveLessonOverrides,
} from "@/lib/lesson-store";
import {
  buildEffectiveLessons,
  normalizeGroupName,
} from "@/lib/lessons-config";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/lesson-order — persist the student-facing order of one
 * section. Admin-only. Body: { group: string, lessonIds: string[] }.
 *
 * `lessonIds` must be the COMPLETE ordered id list for that section — every
 * current member exactly once, no foreign ids — so a reorder can never move
 * a lesson between sections or drop one. The order is stored as a numeric
 * `order` override per lesson (one logical save), and the response returns
 * the full rebuilt curriculum so the client reconciles with server state.
 */
export async function POST(req: NextRequest) {
  const admin = await requireAdminOrResponse();
  if (admin instanceof Response) return admin;
  const denied = await allowMutation(admin, "admin.lesson.order", req);
  if (denied) return denied;

  let body: { group?: unknown; lessonIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const group = typeof body.group === "string" ? body.group.trim() : "";
  if (!group) {
    return NextResponse.json({ error: "Section is required" }, { status: 400 });
  }
  if (
    !Array.isArray(body.lessonIds) ||
    body.lessonIds.some((id) => typeof id !== "string")
  ) {
    return NextResponse.json(
      { error: "lessonIds must be a list of lesson ids" },
      { status: 400 }
    );
  }
  const lessonIds = body.lessonIds as string[];

  const [added, overrides] = await Promise.all([
    getAddedLessons(),
    getLessonOverrides(),
  ]);
  const normalized = normalizeGroupName(group);
  const sectionIds = buildEffectiveLessons(added, overrides)
    .filter((lesson) => normalizeGroupName(lesson.group) === normalized)
    .map((lesson) => lesson.id);

  if (sectionIds.length === 0) {
    return NextResponse.json({ error: "Unknown section" }, { status: 400 });
  }

  // Exact-set check: same length, no duplicates, no foreign/missing ids.
  const submitted = new Set(lessonIds);
  if (
    submitted.size !== lessonIds.length ||
    lessonIds.length !== sectionIds.length ||
    !sectionIds.every((id) => submitted.has(id))
  ) {
    return NextResponse.json(
      {
        error:
          "lessonIds must contain every lesson in the section exactly once",
      },
      { status: 400 }
    );
  }

  for (const [index, id] of lessonIds.entries()) {
    overrides[id] = { ...overrides[id], order: index };
  }
  await saveLessonOverrides(overrides);

  const lessons = buildEffectiveLessons(added, overrides).map(
    ({ id, title, group: lessonGroup, videoId }) => ({
      id,
      title,
      group: lessonGroup,
      videoId,
    })
  );
  return NextResponse.json({ ok: true, lessons });
}
