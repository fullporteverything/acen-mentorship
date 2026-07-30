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
 * Same "is this a real Cloudflare Stream UID?" heuristic as
 * components/CloudflarePlayer.tsx — anything that can't plausibly be one is
 * rejected so a typo never silently blacks out a lesson's player.
 */
function isPlausibleVideoId(value: string): boolean {
  if (value.length < 16) return false;
  if (/\s/.test(value)) return false;
  if (value.includes("_")) return false;
  if (/YOUR_VIDEO/i.test(value)) return false;
  return true;
}

/**
 * POST: set one overridable field for one lesson. Admin-only.
 * Body: { lessonId, field: "title"|"description"|"homeworkPrompt"|"videoId", value }
 *
 * For `videoId`, the value must either be "" (clears the override, reverting to
 * the curriculum's own video) or a plausible Cloudflare Stream UID.
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
  let value = typeof body.value === "string" ? body.value : "";

  if (!lessonId) {
    return NextResponse.json({ error: "Missing lessonId" }, { status: 400 });
  }
  if (!OVERRIDABLE_FIELDS.includes(field)) {
    return NextResponse.json({ error: "Invalid field" }, { status: 400 });
  }

  if (field === "videoId") {
    value = value.trim();
    if (value && !isPlausibleVideoId(value)) {
      return NextResponse.json(
        {
          error:
            "That doesn't look like a Cloudflare Stream video UID. Paste the UID shown after upload (at least 16 characters, no spaces or underscores), or leave it empty to remove the video.",
        },
        { status: 400 }
      );
    }
  }

  const overrides = await getLessonOverrides();
  overrides[lessonId] = { ...overrides[lessonId], [field]: value };
  await saveLessonOverrides(overrides);

  return NextResponse.json({ ok: true, lessonId, field, value });
}
