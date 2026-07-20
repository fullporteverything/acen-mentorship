import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { getLessonOverrides, saveLessonOverrides } from "@/lib/lesson-store";
import { OVERRIDABLE_FIELDS, type OverridableField } from "@/lib/lessons-config";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  return (
    !!process.env.ADMIN_DISCORD_ID &&
    session?.user?.discordId === process.env.ADMIN_DISCORD_ID
  );
}

/** GET: current content overrides. Anyone signed in can read them. */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await getLessonOverrides());
}

/**
 * POST: set one overridable field for one lesson. Admin-only.
 * Body: { lessonId, field: "title"|"description"|"homeworkPrompt", value }
 */
export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { lessonId?: string; field?: string; value?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const lessonId = (body.lessonId || "").trim();
  const field = body.field as OverridableField;
  const value = typeof body.value === "string" ? body.value : "";

  if (!lessonId) {
    return NextResponse.json({ error: "Missing lessonId" }, { status: 400 });
  }
  if (!OVERRIDABLE_FIELDS.includes(field)) {
    return NextResponse.json({ error: "Invalid field" }, { status: 400 });
  }

  const overrides = await getLessonOverrides();
  overrides[lessonId] = { ...overrides[lessonId], [field]: value };
  await saveLessonOverrides(overrides);

  return NextResponse.json({ ok: true, lessonId, field, value });
}
