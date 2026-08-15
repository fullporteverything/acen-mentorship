import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdminOrResponse, requireMemberOrResponse } from "@/lib/authz";
import { allowMutation } from "@/lib/mutation-security";
import {
  getAddedLessons,
  getLessonOverrides,
  saveLessonOverrides,
} from "@/lib/lesson-store";
import {
  buildEffectiveLessons,
  getLesson,
  OVERRIDABLE_FIELDS,
  type OverridableField,
} from "@/lib/lessons-config";
import { isKinescopeVideoId } from "@/lib/video-id";

export const dynamic = "force-dynamic";


/** GET: current content overrides. Anyone signed in can read them. */
export async function GET() {
  const member = await requireMemberOrResponse(); if (member instanceof Response) return member;

  return NextResponse.json(await getLessonOverrides());
}

/**
 * POST: set one overridable field for one lesson. Admin-only.
 * Body: { lessonId, field: "title"|"description"|"homeworkPrompt"|"videoId", value }
 *
 * For `videoId`, the value must either be blank or a Kinescope video UUID.
 */
export async function POST(req: NextRequest) {
  const admin = await requireAdminOrResponse(); if (admin instanceof Response) return admin;
  const denied = await allowMutation(admin, "admin.lesson.overrides", req); if (denied) return denied;

  let body: { lessonId?: string; field?: string; value?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const lessonId = (body.lessonId || "").trim();
  const field = body.field as OverridableField;
  let value = typeof body.value === "string" ? body.value : "";

  if (!lessonId) {
    return NextResponse.json({ error: "Missing lessonId" }, { status: 400 });
  }
  if (!OVERRIDABLE_FIELDS.includes(field)) {
    return NextResponse.json({ error: "Invalid field" }, { status: 400 });
  }

  if (field === "videoId") {
    value = value.trim();
    if (value && !isKinescopeVideoId(value)) {
      return NextResponse.json(
        {
          error:
            "That doesn't look like a Kinescope video UUID. Paste the video ID shown after upload, or leave it empty to remove the video.",
        },
        { status: 400 }
      );
    }
  }

  const [overrides, addedLessons] = await Promise.all([
    getLessonOverrides(),
    getAddedLessons(),
  ]);
  if (!getLesson(lessonId, buildEffectiveLessons(addedLessons, overrides))) {
    return NextResponse.json({ error: "Unknown lesson" }, { status: 400 });
  }
  overrides[lessonId] = { ...overrides[lessonId], [field]: value };
  await saveLessonOverrides(overrides);

  return NextResponse.json({ ok: true, lessonId, field, value });
}
